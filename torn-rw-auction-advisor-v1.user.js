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

})();
