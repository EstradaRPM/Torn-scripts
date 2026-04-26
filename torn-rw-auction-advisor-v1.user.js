// ==UserScript==
// @name         Torn RW Auction Advisor
// @namespace    estradarpm-rw-auction-advisor
// @version      1.17.0
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

  const SCRIPT_VERSION = '1.17.0';
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
    CACHE_ITEM_IDS     : 'rw_cacheItemIds',
    ARMOR_ITEM_IDS     : 'rw_armorItemIds',
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

    // Weighted $/BB rate from all 5 combat caches
    // { rate, cachePrices: { name: price }, fetchedAt }
    bbRate: (() => {
      try { return JSON.parse(Store.get(KEYS.BB_RATE)) || null; } catch { return null; }
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
      Store.remove(KEYS.CACHE_ITEM_IDS);
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

  // All 5 combat caches with their correct BB yields per cache.
  // $/BB rate per cache = price / bb. Medium/Heavy caches typically give
  // cheaper $/BB than Small Arms, pulling the weighted rate down.
  const COMBAT_CACHES = [
    { name: 'Small Arms Cache', bb: 20 },
    { name: 'Melee Cache',      bb: 30 },
    { name: 'Medium Arms Cache',bb: 50 },
    { name: 'Armor Cache',      bb: 60 },
    { name: 'Heavy Arms Cache', bb: 70 },
  ];

  /**
   * Fetches the $/BB rate as a harmonic-mean weighted average across all 5
   * combat caches, using each cache's correct BB yield.
   *
   * Per-cache rate = price / bb_count. Inverse-rate weighting gives the
   * highest weight to whichever cache is cheapest per BB. The harmonic mean
   * of the individual rates is always ≤ the arithmetic mean, and with
   * medium/heavy caches typically providing cheaper $/BB than small arms,
   * the result lands below the old small-arms-only rate.
   *
   * Item IDs are resolved once from the Torn catalog and persisted as a
   * name→id map in localStorage. Only missing IDs trigger a catalog fetch.
   *
   * Stores result in MEM.bbRate and persists to localStorage.
   * @returns {Promise<{rate, cachePrices, fetchedAt}|null>}
   */
  async function fetchBBRate() {
    const key = getApiKey();
    if (!key) { MEM.fetchError = 'No API key — enter one in Settings'; return null; }

    try {
      // Load persisted cache ID map; resolve any missing IDs via catalog
      const cacheNames = COMBAT_CACHES.map(c => c.name);
      let cacheItemIds = (() => {
        try { return JSON.parse(Store.get(KEYS.CACHE_ITEM_IDS)) || {}; } catch { return {}; }
      })();

      const missing = cacheNames.filter(name => !cacheItemIds[name]);
      if (missing.length) {
        const catalogData = await apiFetch(
          `https://api.torn.com/torn/?selections=items&key=${key}&comment=rw-advisor`
        );
        if (catalogData.error) { handleApiError(catalogData.error); return null; }

        for (const [id, item] of Object.entries(catalogData.items ?? {})) {
          if (cacheNames.includes(item.name)) {
            cacheItemIds[item.name] = parseInt(id, 10);
          }
        }

        const stillMissing = cacheNames.filter(name => !cacheItemIds[name]);
        if (stillMissing.length) {
          MEM.fetchError = `Cache IDs not found: ${stillMissing.join(', ')}`;
          return null;
        }

        Store.set(KEYS.CACHE_ITEM_IDS, JSON.stringify(cacheItemIds));
      }

      // Fetch cheapest listing for each cache in parallel
      const results = await Promise.all(
        COMBAT_CACHES.map(async ({ name, bb }) => {
          const id   = cacheItemIds[name];
          const data = await apiFetch(
            `https://api.torn.com/v2/market/${id}/itemmarket?limit=1&key=${key}&comment=rw-advisor`
          );
          if (data.error) { handleApiError(data.error); return null; }
          const price = data.itemmarket?.listings?.[0]?.price ?? null;
          return price != null && price > 0 ? { name, price, bb, rate: price / bb } : null;
        })
      );

      const valid = results.filter(Boolean);
      if (!valid.length) {
        MEM.fetchError = 'No cache listings found for BB rate calculation';
        return null;
      }

      // Harmonic mean of per-cache $/BB rates, weighted by inverse rate.
      // Caches with cheaper $/BB receive higher weight, pulling the result
      // down toward the best-value option.
      const invSum      = valid.reduce((s, r) => s + 1 / r.rate, 0);
      const weightedRate = valid.length / invSum;

      const cachePrices = Object.fromEntries(valid.map(r => [r.name, r.price]));
      const bbRateData  = { rate: weightedRate, cachePrices, fetchedAt: Date.now() };
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

      results.push({ name, armorSet, pieceType, rarity, bonusType, bonusPct, qualityPct, uid, currentBid, timeRemaining, el: li });
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

  // ── UI ──────────────────────────────────────────────────────────────────────

  // Guard against double-injection (e.g. Tampermonkey re-runs on AJAX nav)
  if (document.getElementById('rwa-gear-cluster')) return;

  // ── Styles ──────────────────────────────────────────────────────────────────

  const rwStyle = document.createElement('style');
  rwStyle.textContent = `
    /* ── Floating gear cluster ── */
    #rwa-gear-cluster {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999998;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    #rwa-error-toast {
      background: #1a0a00;
      border: 1px solid #ff4444;
      border-radius: 6px;
      color: #ff8844;
      font-size: 11px;
      max-width: 280px;
      padding: 6px 10px;
      display: none;
    }
    #rwa-error-toast.rwa-visible { display: block; }
    .rwa-cluster-btn {
      background: #0c1622;
      border: 1px solid #1a2a3a;
      border-radius: 6px;
      color: #c0d0c8;
      cursor: pointer;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 15px;
      height: 38px;
      line-height: 1;
      padding: 0 12px;
      transition: border-color 0.15s, color 0.15s;
    }
    .rwa-cluster-btn:hover { border-color: #00ff88; color: #00ff88; }
    .rwa-cluster-btn.rwa-spinning { animation: rwaSpin 0.6s linear infinite; }
    @keyframes rwaSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* ── Settings modal ── */
    #rwa-settings-modal {
      background: #080e18;
      border: 1px solid #1a2a3a;
      border-radius: 8px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.8);
      color: #c0d0c8;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      max-height: 85vh;
      overflow-y: auto;
      padding: 0;
      width: 340px;
    }
    #rwa-settings-modal::backdrop { background: rgba(0,0,0,0.6); }
    .rwa-modal-header {
      align-items: center;
      background: #0c1622;
      border-bottom: 1px solid #1a2a3a;
      border-radius: 8px 8px 0 0;
      display: flex;
      justify-content: space-between;
      padding: 12px 16px;
    }
    .rwa-modal-title {
      color: #00ff88;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .rwa-modal-close {
      background: none;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #c0d0c8;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 8px;
    }
    .rwa-modal-close:hover { border-color: #00ff88; color: #00ff88; }
    .rwa-modal-body { padding: 16px; }
    .rwa-section-label {
      color: #4a7060;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
      text-transform: uppercase;
    }
    .rwa-field       { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .rwa-field label { color: #8aa898; font-size: 12px; }
    .rwa-input {
      background: #0a1220;
      border: 1px solid #1a2a3a;
      border-radius: 4px;
      color: #c0d0c8;
      font-size: 13px;
      outline: none;
      padding: 5px 8px;
      transition: border-color 0.15s;
      width: 110px;
    }
    .rwa-input:focus { border-color: #00ff88; }
    .rwa-toggle-row { align-items: center; display: flex; gap: 10px; }
    .rwa-toggle {
      background: #1a2a3a;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      flex-shrink: 0;
      height: 20px;
      position: relative;
      transition: background 0.2s;
      width: 36px;
    }
    .rwa-toggle.rwa-on { background: #00aa66; }
    .rwa-toggle::after {
      background: #c0d0c8;
      border-radius: 50%;
      content: '';
      height: 14px;
      left: 3px;
      position: absolute;
      top: 3px;
      transition: left 0.2s;
      width: 14px;
    }
    .rwa-toggle.rwa-on::after { left: 19px; }
    .rwa-toggle-label { color: #8aa898; font-size: 12px; }
    .rwa-modal-footer {
      border-top: 1px solid #1a2a3a;
      color: #4a6070;
      font-size: 11px;
      padding: 8px 16px;
      text-align: right;
    }

    /* ── Advisory strip (injected into each auction li) ── */
    .rwa-strip {
      background: #060c16;
      border-top: 1px solid #1a2a3a;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 12px;
      margin-top: 4px;
      padding: 6px 8px;
      user-select: none;
    }
    .rwa-strip-main {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
    }
    .rwa-strip-offer { align-items: center; display: flex; gap: 6px; }
    .rwa-strip-label {
      color: #4a7060;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .rwa-strip-val  { font-size: 13px; font-weight: 700; }
    .rwa-strip-roi  { font-size: 11px; font-weight: 600; }
    .rwa-strip-actions { align-items: center; display: flex; gap: 4px; }
    .rwa-btn {
      background: #0c1622;
      border: 1px solid #1a2a3a;
      border-radius: 4px;
      color: #8aa898;
      cursor: pointer;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      line-height: 1;
      padding: 3px 7px;
      transition: border-color 0.15s, color 0.15s;
    }
    .rwa-btn:hover { border-color: #00ff88; color: #c0d0c8; }
    .rwa-strip-loading { color: #4a7060; font-size: 11px; font-style: italic; }
  `;
  document.head.appendChild(rwStyle);

  // ── Gear cluster HTML ────────────────────────────────────────────────────────

  const gearCluster = document.createElement('div');
  gearCluster.id = 'rwa-gear-cluster';
  gearCluster.innerHTML = `
    <div id="rwa-error-toast"></div>
    <button id="rwa-refresh-btn" class="rwa-cluster-btn" title="Refresh advisor data">↻</button>
    <button id="rwa-gear-btn"    class="rwa-cluster-btn" title="Advisor settings">⚙</button>
  `;
  document.body.appendChild(gearCluster);

  const rwaRefreshBtn = document.getElementById('rwa-refresh-btn');
  const rwaGearBtn    = document.getElementById('rwa-gear-btn');
  const rwaErrorToast = document.getElementById('rwa-error-toast');

  function showError(msg) {
    if (!msg) { rwaErrorToast.classList.remove('rwa-visible'); return; }
    rwaErrorToast.textContent = msg;
    rwaErrorToast.classList.add('rwa-visible');
  }

  // ── Settings modal HTML ──────────────────────────────────────────────────────

  const settingsModal = document.createElement('dialog');
  settingsModal.id = 'rwa-settings-modal';
  settingsModal.innerHTML = `
    <div class="rwa-modal-header">
      <span class="rwa-modal-title">RW Advisor Settings</span>
      <button class="rwa-modal-close" title="Close">✕</button>
    </div>
    <div class="rwa-modal-body">
      <div class="rwa-section-label">API</div>
      <div class="rwa-field">
        <label for="rwa-input-apikey">API Key <span style="font-weight:400;color:#4a6070">(only needed if not auto-injected by Torn PDA)</span></label>
        <input id="rwa-input-apikey" class="rwa-input" type="password" placeholder="paste key here" style="width:240px">
      </div>
      <div class="rwa-section-label">Pricing</div>
      <div class="rwa-field">
        <label for="rwa-input-profit">Target profit %</label>
        <input id="rwa-input-profit" class="rwa-input" type="number" min="1" max="99" step="1">
      </div>
      <div class="rwa-field">
        <label for="rwa-input-mug">Mug buffer %</label>
        <input id="rwa-input-mug" class="rwa-input" type="number" min="0" max="30" step="1">
      </div>
      <div class="rwa-field">
        <label>Sell via trade <span style="font-weight:400;color:#4a6070">(skips 5% market fee)</span></label>
        <div class="rwa-toggle-row">
          <button id="rwa-toggle-trade" class="rwa-toggle" aria-label="Sell via trade"></button>
          <span id="rwa-toggle-trade-label" class="rwa-toggle-label">Off</span>
        </div>
      </div>
      <div class="rwa-section-label">Comp Tolerances</div>
      <div class="rwa-field">
        <label for="rwa-input-quality-range">Quality match range ±&thinsp;%</label>
        <input id="rwa-input-quality-range" class="rwa-input" type="number" min="1" max="30" step="1">
      </div>
      <div class="rwa-field">
        <label for="rwa-input-bonus-range">Bonus match range ±&thinsp;%</label>
        <input id="rwa-input-bonus-range" class="rwa-input" type="number" min="1" max="10" step="1">
      </div>
    </div>
    <div class="rwa-modal-footer">RW Auction Advisor v${SCRIPT_VERSION} · Data stored locally only</div>
  `;
  document.body.appendChild(settingsModal);

  // ── Element refs ─────────────────────────────────────────────────────────────

  const profitInput     = settingsModal.querySelector('#rwa-input-profit');
  const mugInput        = settingsModal.querySelector('#rwa-input-mug');
  const tradeToggle     = settingsModal.querySelector('#rwa-toggle-trade');
  const tradeLabel      = settingsModal.querySelector('#rwa-toggle-trade-label');
  const apikeyInput     = settingsModal.querySelector('#rwa-input-apikey');
  const qualRangeInput  = settingsModal.querySelector('#rwa-input-quality-range');
  const bonusRangeInput = settingsModal.querySelector('#rwa-input-bonus-range');

  // ── Inline render ────────────────────────────────────────────────────────────

  function computeListingMetrics(l) {
    const { baseBonusPct, highTierThreshold } = ARMOR_SCORING[l.armorSet] ?? ARMOR_SCORING.Riot;
    const bbRate = MEM.bbRate?.rate ?? null;

    const bbFloor = (BB_FLOOR_SETS.has(l.armorSet) && bbRate && l.rarity)
      ? calculateBBFloor(l.armorSet, l.rarity, bbRate)
      : null;

    const refPrice     = l.refPrice ?? null;
    const kingCap      = l.kingCap  ?? null;
    const formulaOffer = refPrice != null
      ? calcMaxOffer({
          refPrice,
          bbFloor        : BB_FLOOR_SETS.has(l.armorSet) ? bbFloor : null,
          targetProfitPct: MEM.settings.targetProfitPct,
          mugBufferPct   : MEM.settings.mugBufferPct,
          sellViaTrade   : MEM.settings.sellViaTrade,
        })
      : null;
    const maxOffer = (formulaOffer != null && kingCap != null)
      ? Math.min(formulaOffer, kingCap)
      : formulaOffer;

    const bid = l.currentBid;
    let netProfit = null, roi = null;
    if (bid != null && refPrice != null) {
      const marketFee   = MEM.settings.sellViaTrade ? 0 : 0.05;
      const mugBuffer   = MEM.settings.mugBufferPct / 100;
      const netReceived = refPrice * (1 - marketFee) * (1 - mugBuffer);
      netProfit         = Math.round(netReceived - bid);
      roi               = bid > 0 ? (netProfit / bid) * 100 : null;
    }

    const signalColor = bid != null && maxOffer != null
      ? (bid < maxOffer ? '#00cc66' : '#ff4444')
      : '#8aa898';

    return { bbFloor, refPrice, maxOffer, netProfit, roi, signalColor };
  }

  function injectAdvisoryStrip(listing) {
    if (!listing.el) return;
    listing.el.querySelector('.rwa-strip')?.remove();

    const { maxOffer, roi, signalColor } = computeListingMetrics(listing);
    const isLoading = maxOffer == null && !MEM.fetchError;

    const strip = document.createElement('div');
    strip.className = 'rwa-strip';

    const offerHtml = isLoading
      ? `<span class="rwa-strip-loading">fetching…</span>`
      : `<span class="rwa-strip-val" style="color:${escHtml(signalColor)}">${escHtml(fmtM(maxOffer))}</span>`;
    const roiHtml = (!isLoading && roi != null)
      ? `<span class="rwa-strip-roi" style="color:${escHtml(signalColor)}">${roi.toFixed(1)}%</span>`
      : '';

    strip.innerHTML = `
      <div class="rwa-strip-main">
        <div class="rwa-strip-offer">
          <span class="rwa-strip-label">Max Offer</span>
          ${offerHtml}
          ${roiHtml}
        </div>
        <div class="rwa-strip-actions">
          <button class="rwa-btn rwa-btn-details">&#9660; Details</button>
          <button class="rwa-btn rwa-btn-market">Market</button>
          <button class="rwa-btn rwa-btn-bazaar">Bazaar</button>
          <button class="rwa-btn rwa-btn-log">Log</button>
        </div>
      </div>
    `;

    listing.el.appendChild(strip);
  }

  function renderInline() {
    showError(MEM.fetchError);
    for (const listing of MEM.listings) {
      injectAdvisoryStrip(listing);
    }
  }

  // ── Settings event wiring ────────────────────────────────────────────────────

  if (Store.get('rw_apikey')) apikeyInput.placeholder = '(key saved)';

  profitInput.value     = MEM.settings.targetProfitPct;
  mugInput.value        = MEM.settings.mugBufferPct;
  qualRangeInput.value  = MEM.settings.qualityMatchRange;
  bonusRangeInput.value = MEM.settings.bonusMatchRange;
  if (MEM.settings.sellViaTrade) {
    tradeToggle.classList.add('rwa-on');
    tradeLabel.textContent = 'On';
  }

  profitInput.addEventListener('change', () => {
    const v = parseFloat(profitInput.value);
    if (isNaN(v) || v < 1 || v > 99) return;
    MEM.settings.targetProfitPct = v;
    Store.set(KEYS.TARGET_PROFIT_PCT, String(v));
    renderInline();
  });

  mugInput.addEventListener('change', () => {
    const v = parseFloat(mugInput.value);
    if (isNaN(v) || v < 0 || v > 30) return;
    MEM.settings.mugBufferPct = v;
    Store.set(KEYS.MUG_BUFFER_PCT, String(v));
    renderInline();
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
    tradeToggle.classList.toggle('rwa-on', MEM.settings.sellViaTrade);
    tradeLabel.textContent = MEM.settings.sellViaTrade ? 'On' : 'Off';
    Store.set(KEYS.SELL_VIA_TRADE, String(MEM.settings.sellViaTrade));
    renderInline();
  });

  qualRangeInput.addEventListener('change', () => {
    const v = parseFloat(qualRangeInput.value);
    if (isNaN(v) || v < 1 || v > 30) return;
    MEM.settings.qualityMatchRange = v;
    Store.set(KEYS.QUALITY_MATCH_RANGE, String(v));
    MEM.historicalSales = {};
    renderInline();
  });

  bonusRangeInput.addEventListener('change', () => {
    const v = parseFloat(bonusRangeInput.value);
    if (isNaN(v) || v < 1 || v > 10) return;
    MEM.settings.bonusMatchRange = v;
    Store.set(KEYS.BONUS_MATCH_RANGE, String(v));
    MEM.historicalSales = {};
    renderInline();
  });

  settingsModal.querySelector('.rwa-modal-close').addEventListener('click', () => settingsModal.close());
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.close(); });
  rwaGearBtn.addEventListener('click', () => settingsModal.showModal());

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
      // Cap = anchor × tier multiplier. Applied in computeListingMetrics(), not here.
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
    renderInline();

    if (!MEM.listings.length) return;

    const key = getApiKey();
    if (!key) {
      MEM.fetchError = 'No API key — tap ⚙ (bottom right) to add one';
      renderInline();
      return;
    }

    await fetchBBRate();
    renderInline();

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
    renderInline();
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
