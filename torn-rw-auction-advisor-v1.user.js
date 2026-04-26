// ==UserScript==
// @name         Torn RW Auction Advisor
// @namespace    estradarpm-rw-auction-advisor
// @version      1.0.0
// @description  Auction house advisor for Riot and Assault armor — evaluates listings for flip potential
// @author       Built for EstradaRPM
// @match        https://www.torn.com/amarket.php*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.0.0';
  const API_KEY = '###PDA-APIKEY###';

  // ── Persistence ────────────────────────────────────────────────────────────

  const Store = {
    get(k)    { try { return localStorage.getItem(k); }         catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); }             catch {} },
    remove(k) { try { localStorage.removeItem(k); }             catch {} },
  };

  const KEYS = {
    TARGET_PROFIT_PCT : 'rw_targetProfitPct',
    MUG_BUFFER_PCT    : 'rw_mugBufferPct',
    SELL_VIA_TRADE    : 'rw_sellViaTrade',
    BB_RATE           : 'rw_bbRate',
    COLLAPSED         : 'rw_collapsed',
    POSITION          : 'rw_position',
  };

  // ── Runtime state ───────────────────────────────────────────────────────────

  const MEM = {
    // User-configurable settings (loaded from localStorage, safe fallbacks)
    settings: {
      targetProfitPct : parseFloat(Store.get(KEYS.TARGET_PROFIT_PCT)) || 15,
      mugBufferPct    : parseFloat(Store.get(KEYS.MUG_BUFFER_PCT))    || 10,
      sellViaTrade    : Store.get(KEYS.SELL_VIA_TRADE) === 'true',
    },

    // Current parsed auction house listings (Riot and Assault only)
    listings: [],

    // Cached item market comp prices keyed by Torn item ID
    // { [itemId]: { lowestPrice, listings, cacheTimestamp } }
    itemMarketComps: {},

    // Current $/BB rate derived from small arm cache price
    // { rate, cachePrice, fetchedAt }
    bbRate: (() => {
      try { return JSON.parse(Store.get(KEYS.BB_RATE)) || null; } catch { return null; }
    })(),

    // Panel UI state
    collapsed : Store.get(KEYS.COLLAPSED) === 'true',
    position  : (() => {
      try { return JSON.parse(Store.get(KEYS.POSITION)) || { top: 80, right: 20 }; }
      catch { return { top: 80, right: 20 }; }
    })(),

    // Last fetch error message, surfaced in UI
    fetchError: null,
  };

  // ── BB floor calculation ────────────────────────────────────────────────────

  // BB multipliers per piece by rarity — same for all armor sets
  const BB_MULTIPLIERS = { yellow: 12, orange: 26, red: 108 };

  /**
   * Returns the BB floor price in Torn dollars for a single armor piece.
   *
   * @param {string} armorType - e.g. 'Riot', 'Assault' (unused in formula;
   *                             multipliers are rarity-only per the pricing doc)
   * @param {string} rarity    - 'yellow' | 'orange' | 'red'
   * @param {number} bbRate    - dollar value per BB = cache_price / 20
   * @returns {number|null}    - floor price in $, or null if inputs are invalid
   */
  function calculateBBFloor(armorType, rarity, bbRate) {
    const multiplier = BB_MULTIPLIERS[rarity.toLowerCase()];
    if (!multiplier || !bbRate || bbRate <= 0) return null;
    return multiplier * bbRate;
  }

  // Self-test — visible in browser console when the script loads
  (() => {
    const cacheAt120m = 120_000_000;
    const rate120m    = cacheAt120m / 20; // 6,000,000 per BB

    const cases = [
      { armorType: 'Riot',    rarity: 'yellow', bbRate: rate120m, expect: 72_000_000  },
      { armorType: 'Assault', rarity: 'yellow', bbRate: rate120m, expect: 72_000_000  },
      { armorType: 'Riot',    rarity: 'orange', bbRate: rate120m, expect: 156_000_000 },
      { armorType: 'Riot',    rarity: 'red',    bbRate: rate120m, expect: 648_000_000 },
      { armorType: 'Riot',    rarity: 'yellow', bbRate: 0,        expect: null        },
    ];

    cases.forEach(({ armorType, rarity, bbRate, expect }) => {
      const result = calculateBBFloor(armorType, rarity, bbRate);
      const pass   = result === expect;
      console.log(
        `[RW Advisor] calculateBBFloor(${armorType}, ${rarity}, ${bbRate}) =`,
        result,
        pass ? '✓' : `✗ expected ${expect}`
      );
    });
  })();

  // ── Armor quality scoring (King's method) ──────────────────────────────────

  // Base bonus % and high-tier threshold by armor set
  const ARMOR_SCORING = {
    Riot    : { baseBonusPct: 20, highTierThreshold: 26 },
    Assault : { baseBonusPct: 20, highTierThreshold: 26 },
    Dune    : { baseBonusPct: 30, highTierThreshold: 37 },
  };

  /**
   * Returns King's quality score for a single armor piece.
   *
   * score = quality_pct + (bonus_pct - base_bonus_pct) × 5
   *       + 5 if bonus_pct >= high_tier_threshold
   *
   * @param {number} qualityPct       - armor quality percentage
   * @param {number} bonusPct         - armor bonus percentage
   * @param {number} [baseBonusPct=20]       - base bonus for the set (Riot/Assault=20, Dune=30)
   * @param {number} [highTierThreshold=26]  - threshold for the +5 tier premium
   * @returns {number}
   */
  function scoreArmorPiece(qualityPct, bonusPct, baseBonusPct = 20, highTierThreshold = 26) {
    let score = qualityPct + (bonusPct - baseBonusPct) * 5;
    if (bonusPct >= highTierThreshold) score += 5;
    return score;
  }

  // Self-test
  (() => {
    // Doc examples (rw-pricing-logic.md §5)
    // Riot Body A: quality 46.95%, bonus 25% → 46.95 + (25-20)×5 = 71.95  (25 < 26 so no +5)
    // Riot Body B: quality 60.98%, bonus 21% → 60.98 + (21-20)×5 = 65.98
    const cases = [
      { q: 46.95, b: 25, base: 20, thr: 26, expect: 71.95, label: 'doc Body A' },
      { q: 60.98, b: 21, base: 20, thr: 26, expect: 65.98, label: 'doc Body B' },
      { q: 50,    b: 26, base: 20, thr: 26, expect: 85,    label: 'at threshold (+5)' },
      { q: 50,    b: 27, base: 20, thr: 26, expect: 90,    label: 'above threshold (+5)' },
      { q: 50,    b: 20, base: 20, thr: 26, expect: 50,    label: 'base bonus, no premium' },
    ];

    cases.forEach(({ q, b, base, thr, expect, label }) => {
      const result = scoreArmorPiece(q, b, base, thr);
      const pass   = Math.abs(result - expect) < 0.0001;
      console.log(
        `[RW Advisor] scoreArmorPiece(${q}, ${b}) [${label}] =`,
        result,
        pass ? '✓' : `✗ expected ${expect}`
      );
    });
  })();

  // ── Max offer calculation ───────────────────────────────────────────────────

  /**
   * Calculates the recommended max offer price for an auction listing.
   *
   * Formula (rw-pricing-logic.md §7):
   *   max_offer = ref_price × (1 - market_fee) × (1 - mug_buffer) × (1 - target_margin)
   *
   * For Riot armor: max_offer is floored at bbFloor (pass null for Assault).
   *
   * @param {object} params
   * @param {number}       params.itemMarketComp  - cheapest comparable item market listing ($)
   * @param {number|null}  params.bbFloor         - BB floor price; null skips the floor guard
   * @param {number}       params.targetProfitPct - user-defined profit margin target (e.g. 15)
   * @param {number}       params.mugBufferPct    - mug loss buffer (e.g. 10)
   * @param {boolean}      params.sellViaTrade    - true = no market fee; false = 5% fee applies
   * @returns {{ maxOffer: number, projectedNetProfit: number, projectedROI: number }}
   */
  function calcMaxOffer({ itemMarketComp, bbFloor, targetProfitPct, mugBufferPct, sellViaTrade }) {
    const marketFee    = sellViaTrade ? 0 : 0.05;
    const mugBuffer    = mugBufferPct  / 100;
    const targetMargin = targetProfitPct / 100;

    // Net received per dollar listed, after sell fee and mug loss
    const sellSideFactor = (1 - marketFee) * (1 - mugBuffer);

    // Core formula result
    const formulaResult = itemMarketComp * sellSideFactor * (1 - targetMargin);

    // Riot/Dune: floor at bbFloor if provided; Assault: pass null to skip
    const maxOffer = (bbFloor != null)
      ? Math.max(formulaResult, bbFloor)
      : formulaResult;

    // Projected outcome if bought at maxOffer and sold at itemMarketComp
    const projectedNetProfit = (itemMarketComp * sellSideFactor) - maxOffer;
    const projectedROI       = maxOffer > 0 ? (projectedNetProfit / maxOffer) * 100 : 0;

    return { maxOffer, projectedNetProfit, projectedROI };
  }

  // Self-test
  (() => {
    const m = 100_000_000; // 100m reference price

    const cases = [
      {
        label  : 'standard (10% mug, 15% margin, market sell)',
        params : { itemMarketComp: m, bbFloor: null, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // sellSideFactor = 0.95 × 0.90 = 0.855; formulaResult = 100m × 0.855 × 0.85 = 72,675,000
        expectMaxOffer : 72_675_000,
        // netProfit = 100m × 0.855 - 72,675,000 = 85,500,000 - 72,675,000 = 12,825,000
        expectProfit   : 12_825_000,
      },
      {
        label  : 'sell via trade (no market fee)',
        params : { itemMarketComp: m, bbFloor: null, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: true },
        // sellSideFactor = 1.00 × 0.90 = 0.90; formulaResult = 100m × 0.90 × 0.85 = 76,500,000
        expectMaxOffer : 76_500_000,
        expectProfit   : 13_500_000,
      },
      {
        label  : 'BB floor guard kicks in (Riot)',
        params : { itemMarketComp: m, bbFloor: 80_000_000, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // formulaResult = 72,675,000 < bbFloor 80m → maxOffer = 80m
        expectMaxOffer : 80_000_000,
        expectProfit   : 5_500_000,
      },
      {
        label  : 'BB floor guard does not kick in (formula above floor)',
        params : { itemMarketComp: m, bbFloor: 60_000_000, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // formulaResult = 72,675,000 > bbFloor 60m → maxOffer = 72,675,000
        expectMaxOffer : 72_675_000,
        expectProfit   : 12_825_000,
      },
    ];

    cases.forEach(({ label, params, expectMaxOffer, expectProfit }) => {
      const { maxOffer, projectedNetProfit, projectedROI } = calcMaxOffer(params);
      const passOffer  = Math.abs(maxOffer          - expectMaxOffer) < 1;
      const passProfit = Math.abs(projectedNetProfit - expectProfit)  < 1;
      console.log(
        `[RW Advisor] calcMaxOffer [${label}]`,
        `maxOffer=${maxOffer}`, passOffer  ? '✓' : `✗ expected ${expectMaxOffer}`,
        `profit=${projectedNetProfit}`,     passProfit ? '✓' : `✗ expected ${expectProfit}`,
        `ROI=${projectedROI.toFixed(2)}%`
      );
    });
  })();

})();
