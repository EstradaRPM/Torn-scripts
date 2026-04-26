// ==UserScript==
// @name         Torn RW Auction Advisor
// @namespace    estradarpm-rw-auction-advisor
// @version      1.15.9
// @description  Auction house advisor for Riot and Assault armor — evaluates listings for flip potential
// @author       Built for EstradaRPM
// @match        https://www.torn.com/amarket.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      weav3r.dev
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-rw-auction-advisor-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.15.9';
  const API_KEY = '###PDA-APIKEY###';

  // ── Persistence ────────────────────────────────────────────────────────────

  const Store = {
    get(k)    { try { return localStorage.getItem(k); }         catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); }             catch {} },
    remove(k) { try { localStorage.removeItem(k); }             catch {} },
  };

  const KEYS = {
    TARGET_PROFIT_PCT  : 'rw_targetProfitPct',
    MUG_BUFFER_PCT     : 'rw_mugBufferPct',
    SELL_VIA_TRADE     : 'rw_sellViaTrade',
    BB_RATE            : 'rw_bbRate',
    CACHE_ITEM_ID      : 'rw_cacheItemId',
    ARMOR_ITEM_IDS     : 'rw_armorItemIds',
    COLLAPSED          : 'rw_collapsed',
    POSITION           : 'rw_position',
    QUALITY_MATCH_RANGE: 'rw_qualityMatchRange',
    BONUS_MATCH_RANGE  : 'rw_bonusMatchRange',
  };

  // ── Runtime state ───────────────────────────────────────────────────────────

  const MEM = {
    // User-configurable settings (loaded from localStorage, safe fallbacks)
    settings: {
      targetProfitPct  : parseFloat(Store.get(KEYS.TARGET_PROFIT_PCT))   || 15,
      mugBufferPct     : parseFloat(Store.get(KEYS.MUG_BUFFER_PCT))      || 10,
      sellViaTrade     : Store.get(KEYS.SELL_VIA_TRADE) === 'true',
      qualityMatchRange: parseFloat(Store.get(KEYS.QUALITY_MATCH_RANGE)) || 10,
      bonusMatchRange  : parseFloat(Store.get(KEYS.BONUS_MATCH_RANGE))   || 2,
    },

    // Current parsed auction house listings (supported RW armor sets)
    listings: [],

    // Cached item market comp prices keyed by Torn item ID
    // { [itemId]: { lowestPrice, avgQuality, listings, cacheTimestamp } }
    itemMarketComps: {},

    // TornW3B bazaar listings keyed by "ArmorSet_PieceType_Rarity"
    // { [key]: weapons[] } where weapons[] is the full TornW3B response array
    tornw3bComps: {},

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

    // Historical auction sale stats keyed by composite listing search key.
    // { [key]: { count, median, spread, daysOld } | null }
    historicalSales: {},

    // Last fetch error message, surfaced in UI
    fetchError: null,
  };

  // Armor name → Torn item ID map. Resolved at runtime from the items catalog
  // and persisted so only one catalog call is needed after first run.
  let armorItemIds = (() => {
    try { return JSON.parse(Store.get(KEYS.ARMOR_ITEM_IDS)) || {}; } catch { return {}; }
  })();

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

  // Base bonus % and high-tier threshold by armor set.
  // This object is the single source of truth for which sets are actively supported.
  // To add a new set, append an entry here with verified values — the filter,
  // scoring, and TornW3B queries all derive their set list from these keys.
  const ARMOR_SCORING = {
    Riot    : { baseBonusPct: 20, highTierThreshold: 26 },
    Assault : { baseBonusPct: 20, highTierThreshold: 26 },
    Dune    : { baseBonusPct: 30, highTierThreshold: 37 },
    // Delta, Marauder, Vanguard, Sentinel, EOD — add entries here when
    // base bonus % and high-tier threshold values are confirmed.
  };

  // Sets that trade at or near BB floor; all others (Assault and above) trade
  // significantly above BB and use the formula result without a floor guard.
  const BB_FLOOR_SETS = new Set(['Riot', 'Dune']);

  // ── Historical sale data (Supabase) ────────────────────────────────────────

  // Endpoint and anon key from WinterValor's TORN Auction Price Checker (MIT license).
  // The anon key is intentionally public — it is designed for client-side use with
  // Supabase row-level security and is embedded in a publicly distributed script.
  const SUPABASE_URL      = 'https://btrmmuuoofbonmuwrkzg.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cm1tdXVvb2Zib25tdXdya3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTEzMTgsImV4cCI6MjA4NDQyNzMxOH0.E-s0k46BORXLICAvxtEpqoM3Qmh4-TRLaJAwXO6wJTY';
  const HIST_WINDOW_DAYS  = 90;

  // Armor bonus name → Supabase integer ID map.
  // IDs sourced from WinterValor's TORN Auction Price Checker (MIT license).
  // Lookup is done by scanning for the normalized keyword in the bonusType string,
  // so partial or variant spellings still resolve correctly.
  const ARMOR_BONUS_ID_MAP = {
    impregnable    : 15,   // Riot
    impenetrable   : 17,   // Assault
    impassable     : 26,
    imperviable    : 22,
    insurmountable : 92,
    invulnerable   : 91,
    irrepressible  : 121,
    kinetokinesis  : 112,
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
    const bonusAboveBase = Math.max(0, bonusPct - baseBonusPct);
    let score = qualityPct + bonusAboveBase * 5;
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
      { q: 50,    b: 20, base: 20, thr: 26, expect: 50,    label: 'at base bonus, no premium' },
      { q: 50,    b: 18, base: 20, thr: 26, expect: 50,    label: 'below base bonus — clamped to 0' },
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

  // ── Quality interpolation ──────────────────────────────────────────────────

  /**
   * From a pool of { quality, price } points (bonus-matched comp listings),
   * finds the single closest point strictly below targetQuality (lower bound)
   * and the single closest point strictly above it (upper bound).
   *
   * @param {Array<{quality:number,price:number}>} points
   * @param {number} targetQuality
   * @returns {{ lower:{quality,price}|null, upper:{quality,price}|null }}
   */
  function findQualityBracket(points, targetQuality) {
    let lower = null;
    let upper = null;
    for (const pt of points) {
      if (pt.quality < targetQuality) {
        if (lower === null || pt.quality > lower.quality) lower = pt;
      } else if (pt.quality > targetQuality) {
        if (upper === null || pt.quality < upper.quality) upper = pt;
      }
    }
    return { lower, upper };
  }

  /**
   * Linear interpolation between quality brackets.
   * Weight is proportional to proximity: a target 60% of the way from lower to
   * upper quality maps to 60% of the way from lower to upper price.
   * Falls back to the single bound when only one side exists.
   *
   * @param {number}               targetQuality
   * @param {{quality,price}|null} lower
   * @param {{quality,price}|null} upper
   * @returns {number|null}
   */
  function interpolateQualityPrice(targetQuality, lower, upper) {
    if (lower && upper) {
      const range  = upper.quality - lower.quality;
      if (range === 0) return Math.min(lower.price, upper.price);
      const weight = (targetQuality - lower.quality) / range;
      return Math.round(lower.price + weight * (upper.price - lower.price));
    }
    if (lower) return lower.price;
    // upper-only: all comps have higher quality than the target.
    // Returning upper.price would overvalue a lower-quality piece — return null
    // so the caller can fall back to base-stat comp instead.
    return null;
  }

  // ── Armor tier classification (King's RW Guide) ────────────────────────────

  // King's guide defines three distinct pricing regimes:
  //
  //   base       — quality <25% AND bonus not meaningfully elevated above base
  //                Riot/Dune: buy at/near BB floor
  //                Assault:   bid 10–20% below item market value
  //
  //   hq         — quality ≥25% OR bonus meaningfully above base tier
  //                Any set: bid no more than 2× the cheapest base-stat listing
  //
  //   exceptional — quality ≥40% AND bonus ≥ highTierThreshold (e.g. ≥26% Assault/Riot)
  //                Any set: bid no more than 2.5× the cheapest base-stat listing
  //
  // "Base-stat listing" = cheapest item market / bazaar listing near baseBonusPct (±bonusMatchRange),
  // quality-agnostic. This is the price floor — what the piece costs with no special stats.
  // The cap is a hard ceiling only; refPrice still comes from quality-aware comps for all tiers.
  // "NEVER BUY DIRECTLY FROM ITEM MARKET" for hq/exceptional — market prices
  // run 3–4× base for quality pieces. The cap guards against the formula
  // recommending bids that track those inflated listings.

  const HQ_MULTIPLIER          = 2.0;
  const EXCEPTIONAL_MULTIPLIER = 2.5;

  function classifyArmorTier(qualityPct, bonusPct, baseBonusPct, highTierThreshold) {
    const isBaseQual = qualityPct == null || qualityPct < 25;
    // Bonus must exceed base by more than 1/3 of the range to exceptional
    // to count as "elevated". The old +1 tolerance made 31% Dune = "HQ",
    // which is wrong — one point above base is not meaningfully high quality.
    const bonusGap      = Math.ceil((highTierThreshold - baseBonusPct) / 3);
    const isBaseBonus   = bonusPct == null || bonusPct <= baseBonusPct + bonusGap;
    if (isBaseQual && isBaseBonus) return 'base';

    const isExcepQual  = qualityPct != null && qualityPct >= 40;
    const isHighBonus  = bonusPct   != null && bonusPct  >= highTierThreshold;
    if (isExcepQual && isHighBonus) return 'exceptional';

    return 'hq';
  }


  /**
   * Calculates the recommended max offer price for an auction listing.
   *
   * Formula (rw-pricing-logic.md §7):
   *   max_offer = ref_price × (1 - market_fee) × (1 - mug_buffer) × (1 - target_margin)
   *
   * For Riot armor: max_offer is floored at bbFloor (pass null for Assault).
   *
   * @param {object} params
   * @param {number}       params.refPrice        - cheapest comparable market/bazaar price ($)
   * @param {number|null}  params.bbFloor         - BB floor price; null skips the floor guard
   * @param {number}       params.targetProfitPct - user-defined profit margin target (e.g. 15)
   * @param {number}       params.mugBufferPct    - mug loss buffer (e.g. 10)
   * @param {boolean}      params.sellViaTrade    - true = no market fee; false = 5% fee applies
   * @returns {number}
   */
  function calcMaxOffer({ refPrice, bbFloor, targetProfitPct, mugBufferPct, sellViaTrade }) {
    const marketFee    = sellViaTrade ? 0 : 0.05;
    const mugBuffer    = mugBufferPct  / 100;
    const targetMargin = targetProfitPct / 100;

    const sellSideFactor = (1 - marketFee) * (1 - mugBuffer);
    const formulaResult  = refPrice * sellSideFactor * (1 - targetMargin);

    return (bbFloor != null) ? Math.max(formulaResult, bbFloor) : formulaResult;
  }

  // Self-test
  (() => {
    const m = 100_000_000; // 100m reference price

    const cases = [
      {
        label  : 'standard (10% mug, 15% margin, market sell)',
        params : { refPrice: m, bbFloor: null, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // sellSideFactor = 0.95 × 0.90 = 0.855; formulaResult = 100m × 0.855 × 0.85 = 72,675,000
        expectMaxOffer : 72_675_000,
      },
      {
        label  : 'sell via trade (no market fee)',
        params : { refPrice: m, bbFloor: null, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: true },
        // sellSideFactor = 1.00 × 0.90 = 0.90; formulaResult = 100m × 0.90 × 0.85 = 76,500,000
        expectMaxOffer : 76_500_000,
      },
      {
        label  : 'BB floor guard kicks in (Riot)',
        params : { refPrice: m, bbFloor: 80_000_000, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // formulaResult = 72,675,000 < bbFloor 80m → maxOffer = 80m
        expectMaxOffer : 80_000_000,
      },
      {
        label  : 'BB floor guard does not kick in (formula above floor)',
        params : { refPrice: m, bbFloor: 60_000_000, targetProfitPct: 15, mugBufferPct: 10, sellViaTrade: false },
        // formulaResult = 72,675,000 > bbFloor 60m → maxOffer = 72,675,000
        expectMaxOffer : 72_675_000,
      },
    ];

    cases.forEach(({ label, params, expectMaxOffer }) => {
      const result = calcMaxOffer(params);
      const pass   = Math.abs(result - expectMaxOffer) < 1;
      console.log(
        `[RW Advisor] calcMaxOffer [${label}]`,
        result,
        pass ? '✓' : `✗ expected ${expectMaxOffer}`
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

  // POST variant of gmFetch for JSON APIs that require a request body.
  function gmPost(url, body, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method   : 'POST',
        url,
        headers  : headers || {},
        data     : typeof body === 'string' ? body : JSON.stringify(body),
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

  // ── Historical sale helpers ─────────────────────────────────────────────────

  // Resolves an armor bonusType string to a Supabase integer bonus ID.
  // Normalises the string to lowercase alpha then scans ARMOR_BONUS_ID_MAP keys.
  function resolveBonusId(bonusType) {
    if (!bonusType) return null;
    const norm = bonusType.toLowerCase().replace(/[^a-z]/g, '');
    for (const [name, id] of Object.entries(ARMOR_BONUS_ID_MAP)) {
      if (norm.includes(name)) return id;
    }
    return null;
  }

  // Derives median, spread, count, and age from a raw array of sale records.
  // Filters to the last HIST_WINDOW_DAYS days before computing statistics.
  function computeHistoricalStats(records) {
    const cutoff = Date.now() / 1000 - HIST_WINDOW_DAYS * 86400;
    const recent = records.filter(r => r.timestamp >= cutoff && r.price > 0);
    if (!recent.length) return { count: 0, median: null, spread: null, daysOld: null };

    const prices  = recent.map(r => r.price).sort((a, b) => a - b);
    const mid     = Math.floor(prices.length / 2);
    const median  = prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid];
    const spread  = prices[prices.length - 1] - prices[0];
    const daysOld = Math.floor((Date.now() / 1000 - Math.max(...recent.map(r => r.timestamp))) / 86400);

    return { count: recent.length, median, spread, daysOld };
  }

  /**
   * Queries the Supabase historical auction sale database for completed sales
   * matching this listing's item name, bonus (within bonusMatchRange), and
   * quality (within qualityMatchRange). Computes and caches summary stats.
   * Sets listing.hist directly so enrichListingsFromMarketData() can read it.
   *
   * No Torn API key required. Uses WinterValor's public anon key (MIT license).
   *
   * @param {object} listing - a MEM.listings entry
   */
  async function fetchHistoricalSales(listing) {
    if (!listing.name) return;

    // Cache key bucketed by match ranges to allow shared cache across similar listings
    const bonusId  = resolveBonusId(listing.bonusType);
    const bonusBkt = listing.bonusPct   != null ? Math.round(listing.bonusPct   / MEM.settings.bonusMatchRange)   : 'x';
    const qualBkt  = listing.qualityPct != null ? Math.round(listing.qualityPct / MEM.settings.qualityMatchRange) : 'x';
    const cacheKey = `hist_${listing.name}_${bonusBkt}_${qualBkt}`;

    if (cacheKey in MEM.historicalSales) {
      listing.hist = MEM.historicalSales[cacheKey];
      return;
    }

    const body = {
      item_name  : listing.name,
      limit      : 20,
      offset     : 0,
      sort_by    : 'timestamp',
      sort_order : 'desc',
    };

    if (bonusId != null && listing.bonusPct != null) {
      body.bonus1_id        = bonusId;
      body.bonus1_value_min = Math.max(0, listing.bonusPct - MEM.settings.bonusMatchRange);
      body.bonus1_value_max = listing.bonusPct + MEM.settings.bonusMatchRange;
    }

    if (listing.qualityPct != null) {
      body.quality_min = Math.max(0, listing.qualityPct - MEM.settings.qualityMatchRange);
      body.quality_max = listing.qualityPct + MEM.settings.qualityMatchRange;
    }

    try {
      const text = await gmPost(
        `${SUPABASE_URL}/functions/v1/search-auctions`,
        body,
        {
          'Content-Type' : 'application/json',
          'apikey'       : SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        }
      );
      const data   = JSON.parse(text);
      const result = computeHistoricalStats(data.auctions || []);
      MEM.historicalSales[cacheKey] = result;
      listing.hist = result;
    } catch {
      MEM.historicalSales[cacheKey] = null;
      listing.hist = null;
    }
  }

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
      const url  = `https://api.torn.com/v2/market/${itemId}/itemmarket?limit=50&key=${key}&comment=rw-advisor`;
      const data = await apiFetch(url);

      if (data.error) { handleApiError(data.error); return null; }

      const im = data.itemmarket;
      if (!im?.listings?.length) {
        MEM.itemMarketComps[itemId] = null;
        return null;
      }

      const lowestPrice = Math.min(...im.listings.map(l => l.price));

      // stats.quality is already a percentage (e.g. 24.59), not a 0-1 decimal.
      // Average across fetched listings as a proxy for auction listing quality.
      const qs         = im.listings.map(l => l.item_details?.stats?.quality).filter(q => q != null);
      const avgQuality = qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : null;

      const comp = {
        itemId,
        lowestPrice,
        avgQuality,
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
   * Returns the lowest item market price for listings matching both bonus and
   * quality proximity. Falls back to bonus-only match if no quality match exists.
   * Returns a `qualityMatched` flag so the caller can decide whether a premium
   * multiplier is still needed.
   *
   * @param {number}      itemId
   * @param {number}      bonusPct
   * @param {number|null} qualityPct  - auction listing quality; null = skip quality filter
   * @returns {{ price: number, avgQuality: number|null, qualityMatched: boolean } | null}
   */
  // strict=true: return null if no bonus-matched listings exist (no fallback to all listings).
  // Used when computing King's cap anchor — we must find a true base-stat price, not any price.
  function getItemMarketComp(itemId, bonusPct, qualityPct = null, { strict = false } = {}) {
    const comp = itemId ? MEM.itemMarketComps[itemId] : null;
    if (!comp) return null;

    const bonusMatched = comp.listings.filter(l => {
      const bv = l.item_details?.bonuses?.[0]?.value ?? null;
      return bv != null && Math.abs(bv - bonusPct) <= MEM.settings.bonusMatchRange;
    });
    if (strict && !bonusMatched.length) return null;
    const bonusSrc = bonusMatched.length ? bonusMatched : comp.listings;

    // All bonus-matched quality+price pairs — used by caller for interpolation
    const bonusMatchedPoints = bonusSrc
      .map(l => ({ quality: l.item_details?.stats?.quality ?? null, price: l.price }))
      .filter(p => p.quality != null);

    // Refine by quality proximity when the listing quality is known
    let src = bonusSrc;
    let qualityMatched = false;
    if (qualityPct != null) {
      const qualFiltered = bonusSrc.filter(l => {
        const q = l.item_details?.stats?.quality ?? null;
        return q != null && Math.abs(q - qualityPct) <= MEM.settings.qualityMatchRange;
      });
      if (qualFiltered.length) { src = qualFiltered; qualityMatched = true; }
    }

    const price      = Math.min(...src.map(l => l.price));
    const qs         = src.map(l => l.item_details?.stats?.quality).filter(q => q != null);
    const avgQuality = qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : comp.avgQuality;
    return { price, avgQuality, qualityMatched, bonusMatchedPoints };
  }

  /**
   * Fetches all TornW3B bazaar listings for an armor set + rarity.
   * Returns all piece types mixed; filter in-client by itemId.
   * No API key required. Torn page CSP blocks fetch() — use gmFetch directly.
   * Results stored in MEM.tornw3bComps keyed by "ArmorSet_rarity".
   *
   * @param {string} armorSet - 'Riot' | 'Assault'
   * @param {string} rarity   - 'yellow' | 'orange' | 'red'
   * @returns {Promise<Array|null>}
   */
  async function fetchTornW3BComp(armorSet, rarity) {
    const cacheKey = `${armorSet}_${rarity}`;
    try {
      const url  = `https://weav3r.dev/api/ranked-weapons?tab=armor&armorSet=${armorSet}&rarity=${rarity}&sortField=price&sortDirection=asc`;
      const text = await gmFetch(url);
      const data = JSON.parse(text);
      const weapons = data?.weapons ?? null;
      MEM.tornw3bComps[cacheKey] = weapons;
      return weapons;
    } catch (err) {
      MEM.tornw3bComps[cacheKey] = null;
      return null;
    }
  }

  // BONUS_MATCH_RANGE and QUALITY_MATCH_RANGE are user-configurable.
  // Read from MEM.settings.bonusMatchRange / MEM.settings.qualityMatchRange.

  /**
   * Returns the lowest TornW3B bazaar price for an armor piece matching bonus
   * and, when possible, quality proximity. Falls back to bonus-only match.
   * Returns a `qualityMatched` flag so the caller knows whether a multiplier
   * is still needed.
   *
   * @param {string}      armorName
   * @param {string}      armorSet
   * @param {string}      rarity
   * @param {number}      bonusPct
   * @param {number|null} qualityPct  - auction listing quality; null = skip quality filter
   * @returns {{ price: number, avgQuality: number|null, qualityMatched: boolean } | null}
   */
  // strict=true: return null if no bonus-matched listings exist (no fallback).
  // Used when computing King's cap anchor — we must find a true base-stat price.
  function getTornW3BComp(armorName, armorSet, rarity, bonusPct, qualityPct = null, { strict = false } = {}) {
    const cacheKey = `${armorSet}_${rarity}`;
    const all      = MEM.tornw3bComps[cacheKey];
    if (!all?.length) return null;

    const itemId = armorItemIds[armorName];
    const bonusMatched = all.filter(w =>
      w.itemId === itemId &&
      Math.abs((Object.values(w.bonuses ?? {})[0]?.value ?? 0) - bonusPct) <= MEM.settings.bonusMatchRange
    );
    if (!bonusMatched.length) return null;

    // All bonus-matched quality+price pairs — used by caller for interpolation
    const bonusMatchedPoints = bonusMatched
      .map(w => ({ quality: parseFloat(w.quality), price: w.price }))
      .filter(p => !isNaN(p.quality));

    // Refine by quality proximity when the listing quality is known
    let src = bonusMatched;
    let qualityMatched = false;
    if (qualityPct != null) {
      const qualFiltered = bonusMatched.filter(w => {
        const q = parseFloat(w.quality);
        return !isNaN(q) && Math.abs(q - qualityPct) <= MEM.settings.qualityMatchRange;
      });
      if (qualFiltered.length) { src = qualFiltered; qualityMatched = true; }
    }

    const price      = Math.min(...src.map(w => w.price));
    const qs         = src.map(w => parseFloat(w.quality)).filter(q => !isNaN(q));
    const avgQuality = qs.length ? qs.reduce((s, q) => s + q, 0) / qs.length : null;
    return { price, avgQuality, qualityMatched, bonusMatchedPoints };
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

  // Piece type names across all RW armor sets.
  // 'Vest' covers Dune Vest; 'Mask' covers Delta Gas Mask.
  const ARMOR_PIECES  = ['Helmet', 'Body', 'Vest', 'Mask', 'Pants', 'Gloves', 'Boots'];
  const RARITY_GLOWS  = ['red', 'orange', 'yellow'];

  const RE_QUALITY = /[Qq]uality[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/;
  const RE_PRICE   = /\$\s*([0-9,]+)/;

  /**
   * Parses all supported RW armor listings from the current amarket.php DOM.
   * Supported sets are defined by ARMOR_SCORING keys; add a set there to enable it.
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

      // ── Item name and per-instance UID ───────────────────────────────────
      const nameEl  = li.querySelector('span.title');
      if (!nameEl) continue;
      const rawTitle = nameEl.textContent;
      const name     = rawTitle.trim().split('\n')[0].trim();

      // UID appears as "(Common XXXX)" in the title text; matches item_details.uid in the API
      const uidM = rawTitle.match(/\(\w+\s+(\d+)\)/);
      const uid  = uidM ? parseInt(uidM[1], 10) : null;

      // ── Filter: supported sets only (derived from ARMOR_SCORING keys) ───
      const armorSet = Object.keys(ARMOR_SCORING).find(s => name.startsWith(s)) ?? null;
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
        // title attribute often contains HTML markup (<b>, <br>) — strip it to plain text
        const rawBonus = (bonusSpans[0].getAttribute('title') ?? bonusSpans[0].textContent).trim();
        bonusType = rawBonus
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim() || null;
      }

      // ── Quality % and bonus % ────────────────────────────────────────────
      // qualityPct: from full listing text via regex.
      // bonusPct: extracted from the already-parsed bonusType tooltip string —
      //   works for any armor set without naming specific bonus types.
      const liText     = li.textContent;
      const qualM      = liText.match(RE_QUALITY);
      const qualityPct = qualM ? parseFloat(qualM[1]) : null;
      const bonusPctM  = bonusType?.match(/(\d+(?:\.\d+)?)\s*%/);
      const bonusPct   = bonusPctM ? parseFloat(bonusPctM[1]) : null;

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

      results.push({ name, armorSet, pieceType, rarity, bonusType, bonusPct, qualityPct, uid, currentBid, timeRemaining });
    }

    MEM.listings = results;
    return results;
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────

  function fmtM(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'b';
    if (Math.abs(n) >= 1_000_000)     return (n / 1_000_000).toFixed(1) + 'm';
    return n.toLocaleString();
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Panel UI ────────────────────────────────────────────────────────────────

  // Guard against double-injection (e.g. Tampermonkey re-runs on AJAX nav)
  if (document.getElementById('rw-panel')) return;

  // ── Styles ──────────────────────────────────────────────────────────────────

  const rwStyle = document.createElement('style');
  rwStyle.textContent = `
    #rw-panel {
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 999999;
      width: 740px;
      max-width: calc(100vw - 24px);
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      background: #080e18;
      border: 1px solid #1a2a3a;
      border-radius: 8px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.7);
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      color: #c0d0c8;
      user-select: none;
    }

    /* ── Header ── */
    #rw-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0c1622;
      border-radius: 8px 8px 0 0;
      cursor: grab;
      border-bottom: 1px solid #1a2a3a;
      flex-shrink: 0;
    }
    #rw-header:active { cursor: grabbing; }

    #rw-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #00ff88;
      text-transform: uppercase;
      text-shadow: 0 0 12px rgba(0,255,136,0.5);
    }

    #rw-collapse-btn {
      background: none;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #c0d0c8;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 8px;
      transition: border-color 0.15s, color 0.15s;
    }
    #rw-collapse-btn:hover { border-color: #00ff88; color: #00ff88; }

    #rw-refresh-btn {
      background: none;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #c0d0c8;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 2px 7px;
      margin-right: 6px;
      transition: border-color 0.15s, color 0.15s;
    }
    #rw-refresh-btn:hover { border-color: #00ff88; color: #00ff88; }
    #rw-refresh-btn.rw-spinning { animation: rwSpin 0.6s linear infinite; }
    @keyframes rwSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* ── Body ── */
    #rw-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      flex: 1;
    }
    #rw-panel.rw-collapsed #rw-body  { display: none; }
    #rw-panel.rw-collapsed            { border-radius: 8px; }
    #rw-panel.rw-collapsed #rw-header { border-bottom: none; border-radius: 8px; }

    /* ── Tabs ── */
    #rw-tabs {
      display: flex;
      border-bottom: 1px solid #1a2a3a;
      flex-shrink: 0;
    }
    .rw-tab {
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      color: #4a7060;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .rw-tab:hover        { color: #c0d0c8; }
    .rw-tab.rw-active    { color: #00ff88; border-bottom-color: #00ff88; }

    /* ── Panes ── */
    .rw-pane          { display: none; overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; }
    .rw-pane.rw-active { display: flex; flex-direction: column; }

    /* ── Listings table ── */
    .rw-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .rw-table th {
      text-align: left;
      padding: 6px 8px;
      background: #0c1622;
      color: #4a7060;
      font-weight: 600;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #1a2a3a;
      white-space: nowrap;
      position: sticky;
      top: 0;
    }
    .rw-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #0f1e2e;
      vertical-align: middle;
      color: #c0d0c8;
    }
    .rw-table tr:hover td      { background: #0a1520; }
    .rw-table tr:last-child td { border-bottom: none; }

    .rw-empty {
      text-align: center;
      color: #4a7060;
      padding: 28px 0;
      font-size: 12px;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Settings pane ── */
    .rw-settings-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #4a7060;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .rw-field       { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .rw-field label { font-size: 12px; color: #8aa898; }
    .rw-input {
      background: #0a1220;
      border: 1px solid #1a2a3a;
      border-radius: 4px;
      color: #c0d0c8;
      font-size: 13px;
      padding: 5px 8px;
      width: 110px;
      outline: none;
      transition: border-color 0.15s;
    }
    .rw-input:focus { border-color: #00ff88; }

    /* Toggle switch */
    .rw-toggle-row { display: flex; align-items: center; gap: 10px; }
    .rw-toggle {
      width: 36px; height: 20px;
      background: #1a2a3a;
      border-radius: 10px;
      position: relative;
      cursor: pointer;
      border: none;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    .rw-toggle.rw-on { background: #00aa66; }
    .rw-toggle::after {
      content: '';
      width: 14px; height: 14px;
      background: #c0d0c8;
      border-radius: 50%;
      position: absolute;
      top: 3px; left: 3px;
      transition: left 0.2s;
    }
    .rw-toggle.rw-on::after { left: 19px; }
    .rw-toggle-label { font-size: 12px; color: #8aa898; }

    /* ── Footer ── */
    #rw-footer {
      padding: 5px 14px;
      font-size: 11px;
      color: #4a6070;
      border-top: 1px solid #1a2a3a;
      text-align: right;
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(rwStyle);

  // ── Panel HTML ───────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.id = 'rw-panel';
  panel.innerHTML = `
    <div id="rw-header">
      <span id="rw-title">RW Auction Advisor v${SCRIPT_VERSION}</span>
      <div style="display:flex;align-items:center;gap:4px">
        <button id="rw-refresh-btn" title="Re-scan page">↻</button>
        <button id="rw-collapse-btn" title="Toggle panel">&minus;</button>
      </div>
    </div>

    <div id="rw-body">
      <div id="rw-tabs">
        <div class="rw-tab rw-active" data-tab="listings">Listings</div>
        <div class="rw-tab"           data-tab="settings">Settings</div>
      </div>

      <!-- Listings pane -->
      <div id="rw-pane-listings" class="rw-pane rw-active">
        <div id="rw-listings-content" style="overflow-y:auto;flex:1">
          <div class="rw-empty">Scanning page…</div>
        </div>
      </div>

      <!-- Settings pane -->
      <div id="rw-pane-settings" class="rw-pane">
        <div class="rw-settings-label">API</div>

        <div class="rw-field">
          <label for="rw-input-apikey">API Key <span style="font-weight:400;color:#4a6070">(only needed if not auto-injected by Torn PDA)</span></label>
          <input id="rw-input-apikey" class="rw-input" type="password" placeholder="paste key here" style="width:240px">
        </div>

        <div class="rw-settings-label">Pricing</div>

        <div class="rw-field">
          <label for="rw-input-profit">Target profit %</label>
          <input id="rw-input-profit" class="rw-input" type="number" min="1" max="99" step="1">
        </div>

        <div class="rw-field">
          <label for="rw-input-mug">Mug buffer %</label>
          <input id="rw-input-mug" class="rw-input" type="number" min="0" max="30" step="1">
        </div>

        <div class="rw-field">
          <label>Sell via trade <span style="font-weight:400;color:#4a6070">(skips 5% market fee)</span></label>
          <div class="rw-toggle-row">
            <button id="rw-toggle-trade" class="rw-toggle" aria-label="Sell via trade"></button>
            <span id="rw-toggle-trade-label" class="rw-toggle-label">Off</span>
          </div>
        </div>

        <div class="rw-settings-label">Comp Tolerances</div>

        <div class="rw-field">
          <label for="rw-input-quality-range">Quality match range ±&thinsp;%</label>
          <input id="rw-input-quality-range" class="rw-input" type="number" min="1" max="30" step="1">
        </div>

        <div class="rw-field">
          <label for="rw-input-bonus-range">Bonus match range ±&thinsp;%</label>
          <input id="rw-input-bonus-range" class="rw-input" type="number" min="1" max="10" step="1">
        </div>
      </div>
    </div>

    <div id="rw-footer">RW Auction Advisor v${SCRIPT_VERSION}</div>
  `;
  document.body.appendChild(panel);

  // ── Element refs ─────────────────────────────────────────────────────────────

  const collapseBtn      = panel.querySelector('#rw-collapse-btn');
  const refreshBtn       = panel.querySelector('#rw-refresh-btn');
  const rwHeader         = panel.querySelector('#rw-header');
  const listingsContent  = panel.querySelector('#rw-listings-content');
  const profitInput      = panel.querySelector('#rw-input-profit');
  const mugInput         = panel.querySelector('#rw-input-mug');
  const tradeToggle      = panel.querySelector('#rw-toggle-trade');
  const tradeLabel       = panel.querySelector('#rw-toggle-trade-label');
  const apikeyInput      = panel.querySelector('#rw-input-apikey');
  const qualRangeInput   = panel.querySelector('#rw-input-quality-range');
  const bonusRangeInput  = panel.querySelector('#rw-input-bonus-range');

  // ── render() ─────────────────────────────────────────────────────────────────

  function render() {
    if (!MEM.listings.length) {
      listingsContent.innerHTML = '<div class="rw-empty">No supported RW armor found on this page.</div>';
      return;
    }

    const bbRate = MEM.bbRate?.rate ?? null;

    const rows = MEM.listings.map(l => {
      const { baseBonusPct, highTierThreshold } = ARMOR_SCORING[l.armorSet] ?? ARMOR_SCORING.Riot;

      // Quality score (null when DOM couldn't extract quality or bonus %)
      const qualityScore = (l.qualityPct != null && l.bonusPct != null)
        ? scoreArmorPiece(l.qualityPct, l.bonusPct, baseBonusPct, highTierThreshold)
        : null;

      // BB floor — applies to sets that trade near BB (Riot, Dune).
      // Assault and higher-tier sets trade significantly above BB floor.
      const bbFloor = (BB_FLOOR_SETS.has(l.armorSet) && bbRate && l.rarity)
        ? calculateBBFloor(l.armorSet, l.rarity, bbRate)
        : null;

      // Reference price: quality-aware estimate of realistic resale value
      const refPrice = l.refPrice ?? null;

      // Max offer: formula result, then floored by BB floor, then capped by King's rule.
      // King's cap (HQ/exceptional only): don't bid more than 2× or 2.5× the cheapest
      // base-stat listing, regardless of what quality-matched comps suggest — HQ market
      // prices are 3–4× inflated and can push the formula above a safe auction bid.
      const formulaOffer = refPrice != null
        ? calcMaxOffer({
            refPrice,
            bbFloor        : BB_FLOOR_SETS.has(l.armorSet) ? bbFloor : null,
            targetProfitPct: MEM.settings.targetProfitPct,
            mugBufferPct   : MEM.settings.mugBufferPct,
            sellViaTrade   : MEM.settings.sellViaTrade,
          })
        : null;
      const kingCap        = l.kingCap ?? null;
      const maxOffer       = (formulaOffer != null && kingCap != null)
        ? Math.min(formulaOffer, kingCap)
        : formulaOffer;
      const kingCapActive  = kingCap != null && maxOffer != null && maxOffer === kingCap && kingCap < (formulaOffer ?? Infinity);

      // Net profit and ROI at the current bid price
      const bid = l.currentBid;
      let netProfit = null, roi = null;
      if (bid != null && refPrice != null) {
        const marketFee   = MEM.settings.sellViaTrade ? 0 : 0.05;
        const mugBuffer   = MEM.settings.mugBufferPct / 100;
        const netReceived = refPrice * (1 - marketFee) * (1 - mugBuffer);
        netProfit         = Math.round(netReceived - bid);
        roi               = bid > 0 ? (netProfit / bid) * 100 : null;
      }

      // Bonus cell: append tier badge per King's RW Guide classification
      const tier = l.tier ?? 'base';
      const tierBadge = tier === 'exceptional'
        ? `&thinsp;<span style="color:#e060e0;font-size:10px;font-weight:700" title="Exceptional: quality ≥40% AND high bonus — King's guide cap: ${EXCEPTIONAL_MULTIPLIER}× base price">EXCEP</span>`
        : tier === 'hq'
          ? `&thinsp;<span style="color:#60a0f0;font-size:10px;font-weight:700" title="High quality/bonus — King's guide cap: ${HQ_MULTIPLIER}× base price">HQ</span>`
          : '';

      // Mkt Comp cell — display depends on comp source (same for all tiers):
      //   no badge   — direct quality-matched comp (most precise)
      //   interp     — amber, interpolated between quality brackets
      //   floor/ceil — amber, single quality bracket
      //   ~          — amber, no quality data; cheapest bonus-matched only
      const compSource = l.compSource ?? 'bonus-only';
      let compCellInner;
      if (refPrice == null) {
        compCellInner = '—';
      } else if (compSource === 'quality-match') {
        compCellInner = fmtM(refPrice);
      } else if (compSource === 'interpolated') {
        const lq = l.interpLower?.quality?.toFixed(1) ?? '?';
        const uq = l.interpUpper?.quality?.toFixed(1) ?? '?';
        const lp = fmtM(l.interpLower?.price);
        const up = fmtM(l.interpUpper?.price);
        compCellInner = `${fmtM(refPrice)}&thinsp;<span style="color:#f0a040;font-size:10px;font-weight:700" title="Interpolated between ${lq}% qual (${lp}) and ${uq}% qual (${up})">interp</span>`;
      } else if (compSource === 'single-bound') {
        const isLower = l.interpLower != null;
        const bound   = isLower ? l.interpLower : l.interpUpper;
        const dir     = isLower ? '≥' : '≤';
        const side    = isLower ? 'floor' : 'ceil';
        const tip     = isLower
          ? `Only lower quality bound found (${bound?.quality?.toFixed(1)}% at ${fmtM(bound?.price)}) — target quality exceeds all comps`
          : `Only upper quality bound found (${bound?.quality?.toFixed(1)}% at ${fmtM(bound?.price)}) — target quality below all comps`;
        compCellInner = `${dir}${fmtM(refPrice)}&thinsp;<span style="color:#f0a040;font-size:10px;font-weight:700" title="${tip}">${side}</span>`;
      } else {
        compCellInner = `${fmtM(refPrice)}&thinsp;<span style="color:#f0a040;font-size:10px;font-weight:700" title="No quality data in comp listings — cheapest bonus-matched price only">~</span>`;
      }

      // Max Offer cell: green = bid below max, red = at/above max.
      // Badges (at most one fires per row):
      //   cap  — purple/blue: King's cap is the binding constraint (formula would allow more)
      //   !    — amber: comp is imprecise AND max offer exceeds hist median (possible inflation)
      // BB floor active: suppresses ! (hist < BB floor is expected for Riot/Dune, not a signal)
      const canColor      = bid != null && maxOffer != null;
      const isBuyZone     = canColor && bid < maxOffer;
      const offerColor    = canColor ? (isBuyZone ? '#00cc66' : '#ff4444') : '';
      const histMedian    = l.hist?.median ?? null;
      const bbFloorActive = bbFloor != null && maxOffer != null && maxOffer <= bbFloor + 1;
      const offerRiskFlag = !bbFloorActive && !kingCapActive && compSource !== 'quality-match'
                            && histMedian != null && maxOffer != null && maxOffer > histMedian;

      const capColor      = tier === 'exceptional' ? '#e060e0' : '#60a0f0';
      const capMult       = tier === 'exceptional' ? EXCEPTIONAL_MULTIPLIER : HQ_MULTIPLIER;
      const offerBadge    = kingCapActive
        ? `&thinsp;<span style="color:${capColor};font-size:10px;font-weight:700" title="King's cap: base-stat price ${fmtM(l.baseCompPrice)} × ${capMult} = ${fmtM(l.kingCap)} (HQ market prices run 3–4× base; formula gave ${fmtM(formulaOffer)})">cap</span>`
        : offerRiskFlag
          ? `&thinsp;<span style="color:#f0a040;font-size:10px;font-weight:700" title="Max offer exceeds historical auction median (${fmtM(histMedian)}) — live comp may be inflated">!</span>`
          : '';

      // Net Profit / ROI cells: green = positive, red = negative
      const profitColor = netProfit != null ? (netProfit > 0 ? '#00cc66' : '#ff4444') : '';

      return `<tr>
        <td>${escHtml(l.name)}</td>
        <td>${escHtml(l.rarity ?? '—')}</td>
        <td>${escHtml(l.bonusType ?? '—')}${tierBadge}</td>
        <td>${qualityScore != null ? qualityScore.toFixed(1) : '—'}</td>
        <td>${fmtM(bbFloor)}</td>
        <td>${compCellInner}</td>
        <td>${fmtM(bid)}</td>
        <td style="font-weight:600;color:${offerColor}">${fmtM(maxOffer)}${offerBadge}</td>
        <td style="color:${profitColor}">${fmtM(netProfit)}</td>
        <td style="color:${profitColor}">${roi != null ? roi.toFixed(1) + '%' : '—'}</td>
      </tr>`;
    }).join('');

    const errorBanner = MEM.fetchError
      ? `<div style="padding:6px 14px;font-size:12px;color:#ff8844;border-bottom:1px solid #1a2a3a">${escHtml(MEM.fetchError)}</div>`
      : '';

    listingsContent.innerHTML = errorBanner + `
      <table class="rw-table">
        <thead><tr>
          <th>Item</th><th>Rarity</th><th>Bonus</th><th>Score</th>
          <th>BB Floor</th><th>Mkt Comp</th><th>Current Bid</th>
          <th>Max Offer</th><th>Net Profit</th><th>ROI %</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────

  panel.querySelector('#rw-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.rw-tab');
    if (!tab) return;
    const id = tab.dataset.tab;
    panel.querySelectorAll('.rw-tab').forEach(t  => t.classList.toggle('rw-active', t.dataset.tab === id));
    panel.querySelectorAll('.rw-pane').forEach(p => p.classList.toggle('rw-active', p.id === `rw-pane-${id}`));
  });

  // ── Collapse ──────────────────────────────────────────────────────────────────

  collapseBtn.addEventListener('click', () => {
    MEM.collapsed = !MEM.collapsed;
    panel.classList.toggle('rw-collapsed', MEM.collapsed);
    collapseBtn.textContent = MEM.collapsed ? '+' : '−';
    Store.set(KEYS.COLLAPSED, String(MEM.collapsed));
  });

  // ── Settings inputs ───────────────────────────────────────────────────────────

  if (Store.get('rw_apikey')) apikeyInput.placeholder = '(key saved)';

  profitInput.value     = MEM.settings.targetProfitPct;
  mugInput.value        = MEM.settings.mugBufferPct;
  qualRangeInput.value  = MEM.settings.qualityMatchRange;
  bonusRangeInput.value = MEM.settings.bonusMatchRange;
  if (MEM.settings.sellViaTrade) {
    tradeToggle.classList.add('rw-on');
    tradeLabel.textContent = 'On';
  }

  profitInput.addEventListener('change', () => {
    const v = parseFloat(profitInput.value);
    if (isNaN(v) || v < 1 || v > 99) return;
    MEM.settings.targetProfitPct = v;
    Store.set(KEYS.TARGET_PROFIT_PCT, String(v));
    render();
  });

  mugInput.addEventListener('change', () => {
    const v = parseFloat(mugInput.value);
    if (isNaN(v) || v < 0 || v > 30) return;
    MEM.settings.mugBufferPct = v;
    Store.set(KEYS.MUG_BUFFER_PCT, String(v));
    render();
  });

  apikeyInput.addEventListener('change', () => {
    const val = apikeyInput.value.trim();
    if (val) {
      Store.set('rw_apikey', val);
      apikeyInput.value       = '';
      apikeyInput.placeholder = '(key saved)';
    }
  });

  tradeToggle.addEventListener('click', () => {
    MEM.settings.sellViaTrade = !MEM.settings.sellViaTrade;
    tradeToggle.classList.toggle('rw-on', MEM.settings.sellViaTrade);
    tradeLabel.textContent = MEM.settings.sellViaTrade ? 'On' : 'Off';
    Store.set(KEYS.SELL_VIA_TRADE, String(MEM.settings.sellViaTrade));
    render();
  });

  qualRangeInput.addEventListener('change', () => {
    const v = parseFloat(qualRangeInput.value);
    if (isNaN(v) || v < 1 || v > 30) return;
    MEM.settings.qualityMatchRange = v;
    Store.set(KEYS.QUALITY_MATCH_RANGE, String(v));
    MEM.historicalSales = {};
    render();
  });

  bonusRangeInput.addEventListener('change', () => {
    const v = parseFloat(bonusRangeInput.value);
    if (isNaN(v) || v < 1 || v > 10) return;
    MEM.settings.bonusMatchRange = v;
    Store.set(KEYS.BONUS_MATCH_RANGE, String(v));
    MEM.historicalSales = {};
    render();
  });

  // ── Restore panel state ───────────────────────────────────────────────────────

  if (MEM.collapsed) {
    panel.classList.add('rw-collapsed');
    collapseBtn.textContent = '+';
  }

  // Apply saved drag position (left+top); CSS default (top:80px right:20px) used before first drag
  if (MEM.position?.left != null) {
    panel.style.right  = 'auto';
    panel.style.left   = typeof MEM.position.left === 'number' ? MEM.position.left + 'px' : MEM.position.left;
    panel.style.top    = typeof MEM.position.top  === 'number' ? MEM.position.top  + 'px' : MEM.position.top;
  }

  // ── Drag ──────────────────────────────────────────────────────────────────────

  const DRAG_MARGIN = 60;
  let dragging = false, dragOffX = 0, dragOffY = 0;

  function clampPos(x, y) {
    return [
      Math.max(DRAG_MARGIN - panel.offsetWidth,  Math.min(x, window.innerWidth  - DRAG_MARGIN)),
      Math.max(DRAG_MARGIN - panel.offsetHeight, Math.min(y, window.innerHeight - DRAG_MARGIN)),
    ];
  }

  function applyPos(x, y) {
    const [cx, cy] = clampPos(x, y);
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = cx + 'px';
    panel.style.top    = cy + 'px';
  }

  function savePos() {
    MEM.position = { left: panel.style.left, top: panel.style.top };
    Store.set(KEYS.POSITION, JSON.stringify(MEM.position));
  }

  rwHeader.addEventListener('mousedown', e => {
    if (e.target === collapseBtn) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => { if (dragging) applyPos(e.clientX - dragOffX, e.clientY - dragOffY); });
  document.addEventListener('mouseup',   () => { if (dragging) savePos(); dragging = false; });

  rwHeader.addEventListener('touchstart', e => {
    if (e.target === collapseBtn) return;
    const t = e.touches[0];
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = t.clientX - rect.left;
    dragOffY = t.clientY - rect.top;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    applyPos(t.clientX - dragOffX, t.clientY - dragOffY);
  }, { passive: false });

  document.addEventListener('touchend', () => { if (dragging) savePos(); dragging = false; });

  window.addEventListener('resize', () => {
    if (!MEM.position?.left) return;
    applyPos(parseInt(panel.style.left, 10), parseInt(panel.style.top, 10));
  });

  // ── Data wiring ───────────────────────────────────────────────────────────────

  // Resolves armor piece names → Torn item IDs via the items catalog.
  // Results are cached in localStorage after the first fetch.
  async function resolveArmorItemIds() {
    const key = getApiKey();
    if (!key) return;

    const needed = [...new Set(MEM.listings.map(l => l.name))].filter(n => !armorItemIds[n]);
    if (!needed.length) return;

    try {
      const data = await apiFetch(
        `https://api.torn.com/torn/?selections=items&key=${key}&comment=rw-advisor`
      );
      if (data.error) { handleApiError(data.error); return; }

      let updated = false;
      for (const [id, item] of Object.entries(data.items ?? {})) {
        if (needed.includes(item.name)) {
          armorItemIds[item.name] = parseInt(id, 10);
          updated = true;
        }
      }
      if (updated) Store.set(KEYS.ARMOR_ITEM_IDS, JSON.stringify(armorItemIds));
    } catch (err) {
      MEM.fetchError = `resolveArmorItemIds error: ${err.message}`;
    }
  }

  // Enriches each listing with refPrice and kingCap per King's RW Guide.
  //
  // refPrice — quality-aware resale estimate, same logic for all tiers:
  //   1. Cheapest quality-matched comp (bonus ±range, quality ±range)
  //   2. Linear interpolation between nearest quality brackets
  //   3. Single bound (floor or ceiling)
  //   4. Cheapest bonus-matched comp (no quality data available)
  //
  // kingCap — hard ceiling on maxOffer for HQ/exceptional pieces:
  //   King's guide: "bid no more than 2× (or 2.5–3× if very good) than base stat price."
  //   HQ market listings run 3–4× base — the cap prevents overbidding based on
  //   inflated quality-matched comps. Applied at the maxOffer call site:
  //     maxOffer = min(formula_result, kingCap)
  //   Base tier pieces: kingCap = null (no cap, formula runs unconstrained)
  //
  // Historical auction data feeds only the risk signal (amber ! on Max Offer).
  function enrichListingsFromMarketData() {
    for (const listing of MEM.listings) {
      const itemId  = armorItemIds[listing.name];
      const { baseBonusPct, highTierThreshold } = ARMOR_SCORING[listing.armorSet] ?? ARMOR_SCORING.Riot;

      const tier = classifyArmorTier(listing.qualityPct, listing.bonusPct, baseBonusPct, highTierThreshold);
      listing.tier = tier;

      // ── Quality-aware refPrice (identical logic for all tiers) ──────────────
      const imComp  = getItemMarketComp(itemId, listing.bonusPct, listing.qualityPct);
      const w3bComp = getTornW3BComp(listing.name, listing.armorSet, listing.rarity, listing.bonusPct, listing.qualityPct);

      const imPrice  = imComp?.price  ?? Infinity;
      const w3bPrice = w3bComp?.price ?? Infinity;

      if (imPrice === Infinity && w3bPrice === Infinity) continue;

      const imQM  = imComp?.qualityMatched  ?? false;
      const w3bQM = w3bComp?.qualityMatched ?? false;
      const anyQualityMatched = imQM || w3bQM;

      const winner = imPrice <= w3bPrice ? imComp : w3bComp;
      if (listing.qualityPct == null) listing.qualityPct = winner?.avgQuality ?? null;

      let refPrice    = null;
      let compSource  = 'bonus-only';
      let interpLower = null;
      let interpUpper = null;

      if (anyQualityMatched) {
        const qmPrices = [];
        if (imQM)  qmPrices.push(imPrice);
        if (w3bQM) qmPrices.push(w3bPrice);
        refPrice   = Math.min(...qmPrices);
        compSource = 'quality-match';

      } else if (listing.qualityPct != null) {
        const allPoints = [
          ...(imComp?.bonusMatchedPoints  ?? []),
          ...(w3bComp?.bonusMatchedPoints ?? []),
        ];
        if (allPoints.length) {
          const { lower, upper } = findQualityBracket(allPoints, listing.qualityPct);
          interpLower = lower;
          interpUpper = upper;
          const interpolated = interpolateQualityPrice(listing.qualityPct, lower, upper);
          if (interpolated != null) {
            refPrice   = interpolated;
            compSource = (lower && upper) ? 'interpolated' : 'single-bound';
          }
        }
        if (refPrice == null) {
          refPrice   = Math.min(imPrice, w3bPrice);
          compSource = 'bonus-only';
        }
      } else {
        refPrice   = Math.min(imPrice, w3bPrice);
        compSource = 'bonus-only';
      }

      // ── Market ceiling: prevent overpriced outlier bazaar listings from inflating refPrice ──
      // If a bonus-matched listing exists with quality >= target piece AND price < refPrice,
      // our piece cannot realistically sell for more (buyers will take the better piece instead).
      if (refPrice != null && listing.qualityPct != null) {
        const allPoints = [
          ...(imComp?.bonusMatchedPoints  ?? []),
          ...(w3bComp?.bonusMatchedPoints ?? []),
        ];
        const betterCheaper = allPoints
          .filter(p => p.quality >= listing.qualityPct && p.price < refPrice)
          .sort((a, b) => a.price - b.price)[0];
        if (betterCheaper) {
          refPrice   = betterCheaper.price;
          compSource = 'bonus-only';
          interpLower = null;
          interpUpper = null;
        }
      }

      // ── King's cap for HQ/exceptional (ceiling on maxOffer, not on refPrice) ─
      // Anchor = cheapest near-baseBonusPct listing (quality-agnostic), strict match only.
      // strict=true prevents fallback to all listings — if no base-stat comps exist, cap is null.
      // Cap = anchor × tier multiplier. Applied in render(), not here.
      let kingCap       = null;
      let baseCompPrice = null;
      if (tier === 'hq' || tier === 'exceptional') {
        const imBase  = getItemMarketComp(itemId, baseBonusPct, null, { strict: true });
        const w3bBase = getTornW3BComp(listing.name, listing.armorSet, listing.rarity, baseBonusPct, null, { strict: true });
        const basePrice = Math.min(imBase?.price ?? Infinity, w3bBase?.price ?? Infinity);
        if (basePrice < Infinity) {
          baseCompPrice = basePrice;
          const mult    = tier === 'exceptional' ? EXCEPTIONAL_MULTIPLIER : HQ_MULTIPLIER;
          kingCap       = Math.round(basePrice * mult);
        }
      }

      listing.refPrice      = Math.round(refPrice);
      listing.kingCap       = kingCap;
      listing.baseCompPrice = baseCompPrice;
      listing.compSource    = compSource;
      listing.qualityMatched = anyQualityMatched;
      listing.histUsedAsRef  = false;
      listing.interpLower   = interpLower;
      listing.interpUpper   = interpUpper;
      listing.imPrice       = imPrice  === Infinity ? null : imPrice;
      listing.w3bPrice      = w3bPrice === Infinity ? null : w3bPrice;
    }
  }

  // Orchestrates page-load data pipeline:
  //   1. parse DOM → immediate render
  //   2. fetch BB rate → render with floor data
  //   3. resolve armor item IDs → fetch all market comps → enrich listings → final render
  async function init() {
    parseAuctionListings();
    render();

    if (!MEM.listings.length) return;

    const key = getApiKey();
    if (!key) {
      MEM.fetchError = 'No API key — paste one into Settings (only needed without Torn PDA)';
      render();
      return;
    }

    await fetchBBRate();
    render();

    await resolveArmorItemIds();

    const uniqueIds = [...new Set(
      MEM.listings.map(l => armorItemIds[l.name]).filter(Boolean)
    )];

    // Fetch TornW3B bazaar listings — one call per unique armorSet+rarity covers all piece types
    const uniqueSetRarities = [...new Map(
      MEM.listings.map(l => [`${l.armorSet}_${l.rarity}`, l])
    ).values()];

    // All three external sources fetched in parallel:
    //   item market (Torn API) + TornW3B bazaar + Supabase historical sales
    await Promise.all([
      ...uniqueIds.map(id => fetchItemMarketComp(id)),
      ...uniqueSetRarities
          .filter(l => l.armorSet && l.rarity)
          .map(l => fetchTornW3BComp(l.armorSet, l.rarity)),
      ...MEM.listings.map(l => fetchHistoricalSales(l)),
    ]);

    enrichListingsFromMarketData();
    render();
  }

  // ── Init guard + re-init on AJAX page changes ─────────────────────────────

  let isIniting        = false;
  let reinitTimer      = null;
  let lastAutoInitTime = 0;
  const REINIT_COOLDOWN_MS = 30_000;

  // Switches the observer to the most targeted node available.
  // When ul.items-list exists: watch it directly with childList only —
  //   fires on item add/remove (pagination) but NOT on text changes inside
  //   items (auction countdown timers), preventing the re-init loop.
  // When it doesn't exist yet: watch a stable ancestor with subtree so we
  //   catch the ul being injected by Torn's AJAX loader.
  function attachObserver() {
    listObserver.disconnect();
    const ul = document.querySelector('ul.items-list');
    if (ul) {
      listObserver.observe(ul, { childList: true });
    } else {
      const root = document.querySelector('#mainContainer, .content, .cont-wrap') ?? document.body;
      listObserver.observe(root, { childList: true, subtree: true });
    }
  }

  // isManual = true bypasses the cooldown (user explicitly clicked Refresh).
  async function safeInit(isManual = false) {
    if (isIniting) return;
    const now = Date.now();
    if (!isManual && (now - lastAutoInitTime) < REINIT_COOLDOWN_MS) return;

    isIniting        = true;
    lastAutoInitTime = now;
    refreshBtn.classList.add('rw-spinning');
    listObserver.disconnect();
    try {
      await init();
    } finally {
      isIniting = false;
      refreshBtn.classList.remove('rw-spinning');
      attachObserver();
    }
  }

  // Debounced re-init triggered by MutationObserver.
  // Only auto-fires; respects the 30s cooldown via safeInit(false).
  function scheduleReinit() {
    clearTimeout(reinitTimer);
    reinitTimer = setTimeout(() => {
      if (document.querySelector('ul.items-list li:not(.last):not(.clear)')) {
        MEM.historicalSales = {};
        safeInit(false);
      }
    }, 800);
  }

  const listObserver = new MutationObserver(scheduleReinit);

  // Manual refresh — always runs, bypasses cooldown.
  refreshBtn.addEventListener('click', () => {
    MEM.historicalSales = {};
    safeInit(true);
  });

  // Start observing immediately, then run initial scan after AJAX content settles.
  attachObserver();
  setTimeout(() => safeInit(true), 500);

})();
