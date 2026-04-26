// ==UserScript==
// @name         Torn RW Auction Advisor
// @namespace    estradarpm-rw-auction-advisor
// @version      1.6.0
// @description  Auction house advisor for Riot and Assault armor — evaluates listings for flip potential
// @author       Built for EstradaRPM
// @match        https://www.torn.com/amarket.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.6.0';
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
    CACHE_ITEM_ID     : 'rw_cacheItemId',
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

  // ── API key helper ──────────────────────────────────────────────────────────

  // Prefer PDA-injected key; fall back to manually stored key
  function getApiKey() {
    if (API_KEY !== '###PDA-APIKEY###') return API_KEY;
    return Store.get('rw_apikey') ?? '';
  }

  // ── Network helpers ─────────────────────────────────────────────────────────

  // GM_xmlhttpRequest wrapper — bypasses CORS for cross-origin API calls.
  // Resolves with raw response text; caller must JSON.parse.
  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method   : 'GET',
        url,
        onload   : r  => resolve(r.responseText),
        onerror  : () => reject(new Error('GM_xmlhttpRequest network error')),
        ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout')),
      });
    });
  }

  // Tries native fetch first (works in some environments); falls back to
  // GM_xmlhttpRequest when CORS or a network error is thrown.
  async function apiFetch(url) {
    try {
      const r    = await fetch(url);
      const text = await r.text();
      return JSON.parse(text);
    } catch {
      const text = await gmFetch(url);
      return JSON.parse(text);
    }
  }

  // Centralised API error handler. Clears persisted state on fatal key errors.
  function handleApiError(err) {
    MEM.fetchError = `API error [${err.code}]: ${err.error}`;
    if (err.code === 2 || err.code === 13) {
      // Incorrect key (2) or key owner banned (13) — stop using it
      Store.remove(KEYS.BB_RATE);
      Store.remove(KEYS.CACHE_ITEM_ID);
    }
  }

  // ── Torn API fetch functions ────────────────────────────────────────────────

  /**
   * Fetches item market listings for a specific Torn item ID.
   * Uses GET /v2/market/{id}/itemmarket — globally cached by Torn; poll on
   * user action only, not on a timer.
   *
   * Stores result in MEM.itemMarketComps[itemId].
   * @param {number} itemId
   * @returns {Promise<{itemId, lowestPrice, listings, cacheTimestamp, fetchedAt}|null>}
   */
  async function fetchItemMarketComp(itemId) {
    const key = getApiKey();
    if (!key) { MEM.fetchError = 'No API key — enter one in Settings'; return null; }

    try {
      const url  = `https://api.torn.com/v2/market/${itemId}/itemmarket?limit=10&key=${key}&comment=rw-advisor`;
      const data = await apiFetch(url);
      console.log(`[RW Advisor] fetchItemMarketComp(${itemId}) raw:`, data);

      if (data.error) { handleApiError(data.error); return null; }

      const im = data.itemmarket;
      if (!im?.listings?.length) {
        MEM.itemMarketComps[itemId] = null;
        return null;
      }

      const lowestPrice = Math.min(...im.listings.map(l => l.price));
      const comp = {
        itemId,
        lowestPrice,
        listings      : im.listings,
        cacheTimestamp: im.cache_timestamp,
        fetchedAt     : Date.now(),
      };

      MEM.itemMarketComps[itemId] = comp;
      return comp;
    } catch (err) {
      MEM.fetchError = `fetchItemMarketComp error: ${err.message}`;
      return null;
    }
  }

  /**
   * Fetches the current $/BB rate by looking up the cheapest Small Arms Cache
   * listing on the item market. Resolves the cache item ID at runtime via the
   * Torn v1 items catalog and caches it in localStorage to avoid repeat lookups.
   *
   * Stores result in MEM.bbRate and persists to localStorage.
   * @returns {Promise<{rate, cachePrice, fetchedAt}|null>}
   */
  async function fetchBBRate() {
    const key = getApiKey();
    if (!key) { MEM.fetchError = 'No API key — enter one in Settings'; return null; }

    try {
      // Resolve Small Arms Cache item ID (cached after first lookup)
      let cacheItemId = parseInt(Store.get(KEYS.CACHE_ITEM_ID), 10) || null;

      if (!cacheItemId) {
        const catalogUrl  = `https://api.torn.com/torn/?selections=items&key=${key}&comment=rw-advisor`;
        const catalogData = await apiFetch(catalogUrl);
        console.log('[RW Advisor] fetchBBRate items catalog raw:', catalogData);

        if (catalogData.error) { handleApiError(catalogData.error); return null; }

        const entry = Object.entries(catalogData.items || {}).find(
          ([, item]) => item.name?.toLowerCase() === 'small arms cache'
        );
        if (!entry) {
          MEM.fetchError = 'Small Arms Cache not found in item catalog';
          return null;
        }

        cacheItemId = parseInt(entry[0], 10);
        Store.set(KEYS.CACHE_ITEM_ID, String(cacheItemId));
      }

      // Fetch the cheapest listing for the cache item
      const marketUrl  = `https://api.torn.com/v2/market/${cacheItemId}/itemmarket?limit=1&key=${key}&comment=rw-advisor`;
      const marketData = await apiFetch(marketUrl);
      console.log('[RW Advisor] fetchBBRate market raw:', marketData);

      if (marketData.error) { handleApiError(marketData.error); return null; }

      const listings = marketData.itemmarket?.listings;
      if (!listings?.length) {
        MEM.fetchError = 'No listings found for Small Arms Cache';
        return null;
      }

      const cachePrice = listings[0].price;
      const bbRateData = { rate: cachePrice / 20, cachePrice, fetchedAt: Date.now() };
      MEM.bbRate = bbRateData;
      Store.set(KEYS.BB_RATE, JSON.stringify(bbRateData));
      return bbRateData;
    } catch (err) {
      MEM.fetchError = `fetchBBRate error: ${err.message}`;
      return null;
    }
  }

  // ── DOM parsing ─────────────────────────────────────────────────────────────

  const ARMOR_PIECES  = ['Helmet', 'Body', 'Pants', 'Gloves', 'Boots'];
  const RARITY_GLOWS  = ['red', 'orange', 'yellow'];

  // Regexes against each listing's full text content
  const RE_QUALITY    = /[Qq]uality[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/;
  const RE_BONUS_VAL  = /(?:Impregnable|Impenetrable)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/i;
  const RE_PRICE      = /\$\s*([0-9,]+)/;
  const RE_TIME       = /\b(\d+d\s*)?\s*(\d+h\s*)?\s*(\d+m)?\b/;

  /**
   * Parses all Riot and Assault armor listings from the current amarket.php DOM.
   * Populates MEM.listings with one object per qualifying listing.
   *
   * Fields extracted:
   *   name, armorSet, pieceType, rarity  — from name text and glow class
   *   bonusType, bonusPct, qualityPct    — from tooltip spans and text regex
   *   currentBid, timeRemaining          — from price/time elements and text
   */
  function parseAuctionListings() {
    const listItems = document.querySelectorAll('ul.items-list li');
    const results   = [];

    for (const li of listItems) {
      // Skip structural spacers
      if (li.classList.contains('last') || li.classList.contains('clear')) continue;

      // ── Item name ────────────────────────────────────────────────────────
      const nameEl = li.querySelector('span.title');
      if (!nameEl) continue;
      const name = nameEl.textContent.trim();

      // ── Filter: Riot and Assault only ────────────────────────────────────
      const armorSet = name.startsWith('Riot')    ? 'Riot'
                     : name.startsWith('Assault') ? 'Assault'
                     : null;
      if (!armorSet) continue;

      const pieceType = ARMOR_PIECES.find(p => name.includes(p)) ?? null;

      // ── Rarity from glow class (li itself, or first descendant match) ────
      let rarity = null;
      const glowTarget = li.matches('[class*="glow-"]') ? li
                       : li.querySelector('[class*="glow-"]');
      if (glowTarget) {
        rarity = RARITY_GLOWS.find(r => glowTarget.classList.contains(`glow-${r}`)) ?? null;
      }

      // ── Bonus info from icon tooltip spans ───────────────────────────────
      const bonusSpans = li.querySelectorAll('.iconsbonuses span');
      let bonusType = null;
      if (bonusSpans.length) {
        // Prefer the title attribute (full tooltip text); fall back to visible text
        bonusType = (bonusSpans[0].getAttribute('title') ?? bonusSpans[0].textContent).trim() || null;
      }

      // ── Quality % and bonus % via full-text regex ────────────────────────
      // Torn renders these in stat/tooltip text within the listing element.
      // Null when not visible in DOM — to be filled from API in Step 10.
      const liText   = li.textContent;
      const qualM    = liText.match(RE_QUALITY);
      const bonusM   = liText.match(RE_BONUS_VAL);
      const qualityPct = qualM  ? parseFloat(qualM[1])  : null;
      const bonusPct   = bonusM ? parseFloat(bonusM[1]) : null;

      // ── Current bid ──────────────────────────────────────────────────────
      // Try a dedicated price element first; fall back to first $ amount in text
      let currentBid = null;
      const priceEl  = li.querySelector('.price, [class*="price"]');
      if (priceEl) {
        const raw = priceEl.textContent.replace(/[^0-9]/g, '');
        if (raw) currentBid = parseInt(raw, 10);
      }
      if (currentBid === null) {
        const priceM = liText.match(RE_PRICE);
        if (priceM) currentBid = parseInt(priceM[1].replace(/,/g, ''), 10);
      }

      // ── Time remaining ───────────────────────────────────────────────────
      let timeRemaining = null;
      const timeEl = li.querySelector('.time, [class*="time-left"], [class*="timer"]');
      if (timeEl) {
        timeRemaining = timeEl.textContent.trim() || null;
      }
      if (!timeRemaining) {
        const timeM = liText.match(/\d+\s*(?:day|hour|hr|min|d\b|h\b|m\b)/i);
        if (timeM) timeRemaining = timeM[0].trim();
      }

      results.push({ name, armorSet, pieceType, rarity, bonusType, bonusPct, qualityPct, currentBid, timeRemaining });
    }

    MEM.listings = results;
    console.log(
      `[RW Advisor] parseAuctionListings: found ${results.length} Riot/Assault listing(s)`,
      results
    );
    return results;
  }

})();
