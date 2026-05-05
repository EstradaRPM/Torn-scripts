// ==UserScript==
// @name         Torn Snipe Tracker
// @namespace    estradarpm-snipe-tracker
// @version      1.64.1
// @description  Bazaar snipe detector and trade ledger for Torn City
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  function detectPageMode() {
    const href = window.location.href;
    return ['/market', '/bazaar', '/imarket', '/trade', 'ItemMarket'].some(p => href.includes(p))
      ? 'market'
      : 'background';
  }
  const PAGE_MODE = detectPageMode();

  if (PAGE_MODE === 'market' && document.getElementById('st-drawer')) return;

  const SCRIPT_VERSION = '1.64.1';
  const API_KEY        = '###PDA-APIKEY###';

  function getApiKey() {
    if (API_KEY !== '###PDA-APIKEY###') return API_KEY;
    return localStorage.getItem('st_apikey') ?? '';
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  const KEYS = {
    settings:      'st_settings',
    collapsed:     'st_collapsed',
    trades:        'st_trades',
    apiKey:        'st_apikey',
    snapshots:     'st_snapshots',
    trendcache:    'st_trendcache',
    marketValues:  'st_market_values',
    marketValuesTs:'st_market_values_ts',
  };

  const Store = {
    get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        if (e instanceof DOMException && (
          e.name === 'QuotaExceededError' ||
          e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
          e.code === 22
        )) {
          alert('[Snipe Tracker] Storage quota exceeded — clear old data in Settings.');
        }
      }
    },
  };

  (function migrateStaleKeys() {
    const staleKeys = ['st_watchlist', 'st_last_poll_time'];
    const hasStale = staleKeys.some(k => localStorage.getItem(k) !== null);
    if (!hasStale) return;
    const tombstone = {};
    staleKeys.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) { tombstone[k] = v; localStorage.removeItem(k); }
    });
    localStorage.setItem('st_tombstone_v1', JSON.stringify(tombstone));
  })();

  const MEM = {
    data: {
      settings: Store.get(KEYS.settings) ?? { aggressiveness: 'moderate' },
      trades:   Store.get(KEYS.trades)   ?? [],
    },
    ui: {
      collapsed:    Store.get(KEYS.collapsed) ?? false,
      pendingQueue: [],
    },
  };

  if (PAGE_MODE !== 'market') return;

  // Market values — keyed by string itemId, loaded from localStorage
  let torn_market_values = Store.get(KEYS.marketValues) ?? {};

  // ─── Styles ───────────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    /* ── Price indicator badges ── */
    .price-indicators-row {
        display: inline-flex;
        gap: 4px;
        margin-left: 4px;
        font-size: 10px;
        vertical-align: middle;
    }
    .price-indicator {
        padding: 1px 3px;
        border-radius: 3px;
        font-weight: bold;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-width: 44px;
        max-width: fit-content;
        text-align: center;
    }
    .diff-90-100 { background: #004d00; color: white; }
    .diff-60-90  { background: #006700; color: white; }
    .diff-30-60  { background: #008100; color: white; }
    .diff-0-30   { background: #009b00; color: white; }
    .diff0-30    { background: #cc0000; color: white; width: fit-content; padding: 1px 4px; }
    .diff30-60   { background: #b30000; color: white; width: fit-content; padding: 1px 4px; }
    .diff60-90   { background: #990000; color: white; width: fit-content; padding: 1px 4px; }
    .diff90-plus { background: #800000; color: white; width: fit-content; padding: 1px 4px; }
    .diff-equal  { background: #666666; color: white; width: fit-content; padding: 1px 4px; }

    .icon-store {
        display: inline-block;
        width: 10px;
        height: 10px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 616 512'%3E%3Cpath fill='white' d='M602 118.6L537.1 15C531.3 5.7 521 0 510 0H106C95 0 84.7 5.7 78.9 15L14 118.6c-33.5 53.5-3.8 127.9 58.8 136.4 4.5.6 9.1.9 13.7.9 29.6 0 55.8-13 73.8-33.1 18 20.1 44.3 33.1 73.8 33.1 29.6 0 55.8-13 73.8-33.1 18 20.1 44.3 33.1 73.8 33.1 29.6 0 55.8-13 73.8-33.1 18.1 20.1 44.3 33.1 73.8 33.1 4.7 0 9.2-.3 13.7-.9 62.8-8.4 92.6-82.8 59-136.4zM529.5 288c-10 0-19.9-1.5-29.5-3.8V384H116v-99.8c-9.6 2.2-19.5 3.8-29.5 3.8-6 0-12.1-.4-18-1.2-5.6-.8-11.1-2.1-16.4-3.6V480c0 17.7 14.3 32 32 32h448c17.7 0 32-14.3 32-32V283.2c-5.4 1.6-10.8 2.9-16.4 3.6-6.1.8-12.1 1.2-18.2 1.2z'/%3E%3C/svg%3E");
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        vertical-align: middle;
        margin-right: 2px;
    }

    @media (min-width: 785px) {
        .sellerRow___AI0m6 {
            padding: 4px 4px !important;
            display: flex !important;
            align-items: center !important;
            gap: 2px !important;
            width: 100% !important;
        }
        .thumbnail___M_h9v { flex-shrink: 0; width: 40px !important; margin-right: 4px !important; }
        .userInfoWrapper___B2a2P { flex-shrink: 0; min-width: 110px; margin-right: 4px !important; }
        .sellerRow___AI0m6 .price-indicators-row {
            display: inline-flex !important;
            flex-direction: column !important;
            gap: 2px !important;
            margin-left: 2px !important;
            margin-right: 0 !important;
        }
        .price___Uwiv2 { display: flex !important; align-items: center !important; flex-shrink: 0; min-width: 85px; margin-right: 0 !important; }
        .available___xegv_ { flex-shrink: 0; min-width: 55px; text-align: right; margin-right: 2px !important; }
        .buyControlsInRow___GVAKp { flex-shrink: 0; }
        .buyControls___MxiIN { display: flex !important; align-items: center !important; gap: 2px !important; }
        .amountInputWrapper___a4BMt { min-width: 55px !important; width: 55px !important; flex-shrink: 0; }
        .input-money { min-width: 45px !important; width: 100% !important; padding: 0 2px !important; }
        .buyButton___Flkhg { flex-shrink: 0; min-width: 65px; padding-left: 8px !important; padding-right: 8px !important; }
        .price-indicator { padding: 1px 4px !important; min-width: 0 !important; }
        .space___qCLQp { display: none !important; }
    }

    @media (max-width: 784px) {
        .sellerRow___Ca2pK {
            display: grid !important;
            grid-template-columns: minmax(80px, 1fr) auto auto auto !important;
            align-items: center !important;
            gap: 8px !important;
            padding: 8px 12px !important;
        }
        .sellerRow___Ca2pK:first-child { font-weight: bold; background-color: rgba(0,0,0,0.1); }
        .userInfoWrapper___B2a2P { min-width: 80px; max-width: 120px; }
        .price___v8rRx { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 85px; }
        .price-indicators-row {
            position: static !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 2px !important;
            margin-top: 2px !important;
            font-size: 9px !important;
            align-items: center !important;
        }
        .price-indicator {
            padding: 1px 4px !important;
            white-space: nowrap !important;
            text-align: center !important;
            justify-content: center !important;
            width: fit-content !important;
            min-width: 0 !important;
            margin: 0 auto !important;
            display: inline-flex !important;
            align-items: center !important;
        }
        .available___jtANf { text-align: center; min-width: 30px; }
        .showBuyControlsButton___K8f72 { padding: 6px !important; display: flex !important; align-items: center !important; justify-content: center !important; }
        .userInfoHead___LXxjB, .priceHead___Yo8ku, .availableHead___BkcpB, .showBuyControlsHead___SczEn { text-align: center !important; }
        .icon-store { width: 8px !important; height: 8px !important; margin: 0 2px 0 0 !important; }
    }

    /* ── FAB ── */
    #st-fab {
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 999999;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #0c1e2e;
      border: 2px solid #2a3a4a;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-family: 'Segoe UI', Arial, sans-serif;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;
      box-shadow: 0 2px 12px rgba(0,0,0,0.5);
    }
    #st-fab:hover { border-color: #00ff88; }

    /* ── Drawer ── */
    #st-drawer {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 999998;
      background: #080e18;
      border-top: 2px solid #1a2a3a;
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -4px 32px rgba(0,0,0,0.7);
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      color: #c0d0c8;
      user-select: none;
      transform: translateY(100%);
      transition: transform 0.25s ease;
      display: flex;
      flex-direction: column;
      height: 50vh;
      max-height: 90vh;
    }
    #st-drawer.st-drawer-open { transform: translateY(0); }

    #st-drawer-handle {
      padding: 10px 0 4px;
      display: flex;
      justify-content: center;
      cursor: ns-resize;
      flex-shrink: 0;
    }
    #st-drawer-handle::after {
      content: '';
      display: block;
      width: 40px;
      height: 4px;
      background: #2a3a4a;
      border-radius: 2px;
    }

    #st-drawer-titlebar { display: flex; align-items: center; padding: 0 14px 6px; flex-shrink: 0; }
    #st-title { font-size: 13px; font-weight: 700; letter-spacing: 0.06em; color: #00ff88; text-transform: uppercase; text-shadow: 0 0 12px rgba(0,255,136,0.5); }

    #st-body { display: flex; flex-direction: column; overflow: hidden; min-height: 0; flex: 1; }

    #st-tabs { display: flex; gap: 0; border-bottom: 1px solid #1a2a3a; background: #0a1220; }
    .st-tab { padding: 9px 22px; font-size: 13px; font-weight: 600; letter-spacing: 0.04em; cursor: pointer; color: #8aa898; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; text-transform: uppercase; }
    .st-tab:hover { color: #d4e4dc; }
    .st-tab.st-active { color: #00ff88; border-bottom: 2px solid #00ff88; text-shadow: 0 0 10px rgba(0,255,136,0.4); }

    .st-pane { display: none; padding: 10px; }
    .st-pane.st-active { display: flex; flex-direction: column; overflow-y: auto; flex: 1; min-height: 0; }

    .st-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .st-table th { text-align: left; color: #00ccff !important; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; padding: 5px 8px; border-bottom: 1px solid #1a2a3a; text-shadow: 0 0 8px rgba(0,204,255,0.35); }
    .st-table td { padding: 6px 8px; border-bottom: 1px solid #0f1e2e; vertical-align: middle; color: #c0d0c8 !important; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
    .st-table tr:last-child td { border-bottom: none; }
    .st-table tr:hover td { background: rgba(255,255,255,0.025); }

    /* ── Pending queue ── */
    #st-queue-section { margin-bottom: 4px; border: 1px solid #1a3a2a; border-radius: 6px; background: #050e0a; overflow: hidden; }
    #st-queue-section .st-section-label { margin: 0; padding: 6px 10px; border-bottom: 1px solid #1a3a2a; border-radius: 6px 6px 0 0; }
    .st-queue-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-bottom: 1px solid #0a1a12; font-size: 12px; }
    .st-queue-row:last-child { border-bottom: none; }
    .st-queue-name { flex: 1; color: #c0d0c8; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .st-queue-price { color: #00ff88; font-weight: 700; white-space: nowrap; }
    .st-queue-age   { color: #8aa898; font-size: 11px; white-space: nowrap; }
    .st-queue-badge { display: inline-block; background: #00cc66; color: #050e0a; border-radius: 10px; padding: 0 6px; font-size: 11px; font-weight: 700; margin-left: 5px; line-height: 1.4; }
    #st-queue-batch-row { padding: 0 8px 8px; margin-top: 4px; }

    /* ── Section labels ── */
    .st-section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #00ccff; margin: 14px 0 8px 0; padding-bottom: 4px; border-bottom: 1px solid #1a2a3a; text-shadow: 0 0 8px rgba(0,204,255,0.4); }
    .st-section-label:first-child { margin-top: 0; }

    /* ── Summary ── */
    .st-summary { display: flex; gap: 12px; flex-wrap: wrap; background: #0a1220; border: 1px solid #1a2a3a; border-radius: 6px; padding: 10px 12px; margin-top: 12px; font-size: 12px; }
    .st-summary-item { display: flex; flex-direction: column; gap: 2px; }
    .st-summary-label { color: #8aa898; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
    .st-summary-value { color: #00ff88; font-weight: 700; font-size: 14px; text-shadow: 0 0 10px rgba(0,255,136,0.4); }

    /* ── Buttons ── */
    .st-btn { background: #0c1e2e; border: 1px solid #2a3a4a; border-radius: 5px; color: #c0d0c8; cursor: pointer; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; padding: 6px 14px; transition: border-color 0.15s, color 0.15s, background 0.15s; }
    .st-btn:hover:not(:disabled) { border-color: #00ff88; color: #00ff88; }
    .st-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .st-btn-blue:hover:not(:disabled) { border-color: #00ccff; color: #00ccff; }
    .st-btn-danger:hover:not(:disabled) { border-color: #ff4444; color: #ff4444; }
    .st-btn-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }

    /* ── Settings ── */
    .st-settings { padding: 12px 14px 14px; }
    .st-settings-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #8aa0b0; margin-bottom: 10px; }
    .st-field { display: flex; flex-direction: column; gap: 4px; }
    .st-field label { font-size: 11px; color: #8aa0b0; letter-spacing: 0.05em; }
    .st-input { background: #0c1622; border: 1px solid #1a2a3a; border-radius: 4px; color: #c0d0c8; font-size: 13px; padding: 5px 10px; width: 110px; outline: none; transition: border-color 0.15s; }
    .st-input:focus { border-color: #00ccff; }

    @media (max-width: 560px) { .st-table th, .st-table td { padding: 5px 5px; font-size: 12px; } }

    .st-aggr-btn.st-aggr-active { border-color: #00ff88; color: #00ff88; background: #0a2018; }
    .st-sell-target-cell { cursor: pointer; color: #4ecdc4; font-weight: 600; white-space: nowrap; }
    .st-sell-target-cell.st-copied { color: #00ff88; }

    /* ── Toast ── */
    .st-toast { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.85); color: white; padding: 10px 16px; border-radius: 5px; z-index: 9999999; opacity: 0; transition: opacity 0.3s ease; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; pointer-events: none; }
    .st-toast.show { opacity: 1; }
  `;
  document.head.appendChild(style);

  // ─── HTML ──────────────────────────────────────────────────────────────────

  const fab = document.createElement('div');
  fab.id = 'st-fab';
  fab.textContent = '⚡';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'st-drawer';
  panel.innerHTML = `
    <div id="st-drawer-handle"></div>
    <div id="st-drawer-titlebar">
      <span id="st-title">Snipe Tracker v${SCRIPT_VERSION}</span>
    </div>
    <div id="st-body">
      <div id="st-tabs">
        <div class="st-tab st-active" data-tab="ledger">Ledger<span id="st-ledger-tab-badge" class="st-queue-badge" style="display:none"></span></div>
        <div class="st-tab" data-tab="settings">Settings</div>
      </div>

      <div id="st-pane-ledger" class="st-pane st-active">

        <div id="st-queue-section" style="display:none">
          <div class="st-section-label">Pending Queue <span id="st-queue-badge"></span></div>
          <div id="st-queue-rows"></div>
          <div class="st-btn-row" id="st-queue-batch-row">
            <button id="st-queue-log-all-btn" class="st-btn">Log All</button>
            <button id="st-queue-clear-btn" class="st-btn st-btn-danger">Clear Queue</button>
          </div>
        </div>

        <details id="st-import-section" style="margin-bottom:8px">
          <summary style="cursor:pointer;color:#8aa898;font-size:12px;user-select:none;padding:4px 0">Import from log</summary>
          <textarea id="st-import-textarea" rows="4" style="width:100%;box-sizing:border-box;margin-top:6px;background:#1a2820;color:#c8e6c9;border:1px solid #3a5244;border-radius:4px;padding:6px;font-size:11px;resize:vertical" placeholder="Paste Torn market log here…"></textarea>
          <div class="st-btn-row" style="margin-top:4px">
            <button id="st-import-btn" class="st-btn">Import</button>
            <span id="st-import-status" style="font-size:11px;color:#8aa898;margin-left:8px"></span>
          </div>
        </details>

        <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 4px">
          <div class="st-section-label" style="margin:0">Open Trades</div>
          <div id="st-aggr-toggle" style="display:flex;gap:4px">
            <button class="st-btn st-aggr-btn" data-aggr="conservative" style="font-size:11px;padding:3px 8px">Conservative</button>
            <button class="st-btn st-aggr-btn" data-aggr="moderate"     style="font-size:11px;padding:3px 8px">Moderate</button>
            <button class="st-btn st-aggr-btn" data-aggr="aggressive"   style="font-size:11px;padding:3px 8px">Aggressive</button>
          </div>
        </div>
        <table class="st-table">
          <thead><tr><th>Date</th><th>Item</th><th>Qty</th><th>Buy Price</th><th>Total</th><th>Sell Target</th><th></th></tr></thead>
          <tbody id="st-open-trades-body"></tbody>
        </table>

        <div class="st-section-label">Closed Trades</div>
        <table class="st-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Buy</th><th>Sell</th><th>Profit</th><th>ROI %</th><th>Held</th><th></th></tr></thead>
          <tbody id="st-closed-trades-body"></tbody>
        </table>

        <div class="st-summary">
          <div class="st-summary-item"><span class="st-summary-label">Invested</span><span class="st-summary-value" id="st-sum-invested">—</span></div>
          <div class="st-summary-item"><span class="st-summary-label">Total Profit</span><span class="st-summary-value" id="st-sum-profit">—</span></div>
          <div class="st-summary-item"><span class="st-summary-label">W. ROI</span><span class="st-summary-value" id="st-sum-roi">—</span></div>
          <div class="st-summary-item"><span class="st-summary-label">Win Rate</span><span class="st-summary-value" id="st-sum-winrate">—</span></div>
          <div class="st-summary-item"><span class="st-summary-label">Trades</span><span class="st-summary-value" id="st-sum-trades">0</span></div>
        </div>

        <div class="st-btn-row">
          <button id="st-export-btn" class="st-btn st-btn-blue">Export CSV</button>
        </div>
      </div>

      <div id="st-pane-settings" class="st-pane">
        <div class="st-settings">
          <div class="st-settings-title">Settings</div>
          <div class="st-field" style="margin-bottom:10px">
            <label for="st-input-apikey">API Key <span style="font-weight:400;color:#4a6070">(only needed if not auto-injected by Torn PDA)</span></label>
            <input id="st-input-apikey" class="st-input" type="password" placeholder="paste key here" style="width:240px">
          </div>
          <div class="st-btn-row" style="margin-top:0;margin-bottom:14px">
            <button id="st-refresh-market-btn" class="st-btn st-btn-blue">Refresh Market Values</button>
            <span id="st-market-status" style="font-size:11px;color:#8aa898;align-self:center;margin-left:6px"></span>
          </div>
          <button id="st-clear-btn" class="st-btn st-btn-danger">Clear All Data</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ─── Pure functions ───────────────────────────────────────────────────────

  function SellTargetEngine(bazaarAverage, marketValue, aggressiveness) {
    if (bazaarAverage == null && marketValue == null) return null;
    if (bazaarAverage != null && marketValue != null) {
      if (aggressiveness === 'conservative') return bazaarAverage;
      if (aggressiveness === 'aggressive')   return marketValue;
      return Math.round((bazaarAverage + marketValue) / 2);
    }
    const ref   = marketValue ?? bazaarAverage;
    const scale = aggressiveness === 'conservative' ? 0.90
                : aggressiveness === 'aggressive'   ? 1.00
                : 0.95;
    return Math.round(ref * scale);
  }

  function LogParser(logText) {
    if (!logText || !logText.trim()) return [];
    const lines   = logText.split('\n').map(l => l.trim()).filter(Boolean);
    const entries = [];
    for (let i = 0; i < lines.length; i++) {
      const buyM = lines[i].match(/^You bought (\d+)x (.+?) on .+? at \$([0-9,]+) each/);
      if (!buyM) continue;
      const quantity      = parseInt(buyM[1], 10);
      const itemName      = buyM[2].trim();
      const purchasePrice = parseInt(buyM[3].replace(/,/g, ''), 10);
      let timestamp = null;
      const next = lines[i + 1] ?? '';
      const tsM  = next.match(/^(\d{2}:\d{2}:\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})$/);
      if (tsM) {
        const [, time, mm, dd, yy] = tsM;
        const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
        const t    = new Date(`${year}-${mm}-${dd}T${time}`).getTime();
        if (!isNaN(t)) { timestamp = t; i++; }
      }
      entries.push({ itemId: null, itemName, purchasePrice, quantity, timestamp });
    }
    return entries;
  }

  // ─── Log import ───────────────────────────────────────────────────────────

  function parseApiLogEntry(entry) {
    const data      = entry.data ?? entry.params ?? {};
    const itemName  = data.item ?? data.name ?? data.itemname ?? null;
    const qty       = parseInt(data.quantity ?? data.qty ?? 1, 10);
    const totalCost = data.cost ?? data.total ?? null;
    const unitPrice = data.price != null
      ? parseInt(data.price, 10)
      : totalCost != null ? Math.round(parseInt(totalCost, 10) / qty) : null;
    if (!itemName || unitPrice == null) return null;
    const itemId = data.item_id ?? data.itemid ?? data.itemId ?? null;
    const ts     = entry.timestamp ? entry.timestamp * 1000 : null;
    return { itemId: itemId ? parseInt(itemId, 10) : null, itemName, purchasePrice: unitPrice, quantity: qty, timestamp: ts };
  }

  async function fetchApiLogEntries() {
    const key = getApiKey();
    if (!key) return [];
    try {
      const text = await gmFetch(`https://api.torn.com/v2/user/log?log=1112,1125&limit=100&key=${key}`);
      const d    = JSON.parse(text);
      if (d.error) return [];
      const raw  = Array.isArray(d.log) ? d.log : Object.values(d.log ?? {});
      return raw.flatMap(e => { const r = parseApiLogEntry(e); return r ? [r] : []; });
    } catch { return []; }
  }

  function logEntryDedupeKey(name, buyDate) { return `${name}|${buyDate}`; }

  function importLogEntries(entries) {
    const existing = new Set(MEM.data.trades.map(t => logEntryDedupeKey(t.name, t.buyDate)));
    let added = 0;
    for (const e of entries) {
      const trade = { itemId: e.itemId, name: e.itemName, qty: e.quantity, buyPrice: e.purchasePrice, buyDate: e.timestamp ?? Date.now(), sellPrice: null, sellDate: null };
      const key = logEntryDedupeKey(trade.name, trade.buyDate);
      if (!existing.has(key)) { MEM.data.trades.push(trade); existing.add(key); added++; }
    }
    if (added > 0) { Store.set(KEYS.trades, MEM.data.trades); renderOpenTrades(); renderClosedTrades(); renderSummary(); }
    return added;
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:  'GET',
        url,
        onload:  r  => resolve(r.responseText),
        onerror: () => reject(new Error('network error')),
      });
    });
  }

  // ─── Toast ────────────────────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'st-toast';
    toast.textContent = message;
    if (type === 'success') toast.style.backgroundColor = '#1a5c2a';
    else if (type === 'error') toast.style.backgroundColor = '#5c1a1a';
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 50);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
  }

  // ─── Market values ────────────────────────────────────────────────────────

  async function getTornMarketValues() {
    const key = getApiKey();
    if (!key) { showToast('No API key — add one in Settings first.', 'error'); return; }
    const statusEl = panel.querySelector('#st-market-status');
    if (statusEl) statusEl.textContent = 'Fetching…';
    try {
      const text = await gmFetch(`https://api.torn.com/torn/?key=${key}&selections=items`);
      const data = JSON.parse(text);
      if (data.error) {
        showToast('Torn API error: ' + (data.error.error ?? data.error), 'error');
        if (statusEl) statusEl.textContent = 'Failed.';
        return;
      }
      if (data.items) {
        Object.entries(data.items).forEach(([id, item]) => { torn_market_values[id] = item.market_value || 0; });
        Store.set(KEYS.marketValues, torn_market_values);
        Store.set(KEYS.marketValuesTs, Date.now());
        showToast('Market values updated!', 'success');
        if (statusEl) statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
        processElements();
      }
    } catch {
      showToast('Failed to fetch market values.', 'error');
      if (statusEl) statusEl.textContent = 'Failed.';
    }
  }

  function scheduleNextUpdate() {
    const now = new Date(), target = new Date(now);
    target.setUTCHours(20, 15, 0, 0);
    if (now > target) target.setDate(target.getDate() + 1);
    setTimeout(() => { getTornMarketValues(); scheduleNextUpdate(); }, target - now);
  }

  // ─── Price indicator injection (Highlighter logic, market value only) ──────

  function addPriceIndicator(itemId, itemPrice, container) {
    const existingRow = container.nextElementSibling;
    if (existingRow?.classList.contains('price-indicators-row')) existingRow.remove();

    const indicatorsRow = document.createElement('div');
    indicatorsRow.classList.add('price-indicators-row');

    let quantity = 1;
    const sellerRow = container.closest('.sellerRow___AI0m6');
    if (sellerRow) {
      const qtyEl = sellerRow.querySelector('.available___xegv_');
      if (qtyEl) {
        const m = qtyEl.textContent.match(/(\d+)\s+available/);
        quantity = m ? parseInt(m[1]) : 1;
      }
    }

    if (torn_market_values[itemId]) {
      const marketValue     = torn_market_values[itemId];
      const diff            = Math.round(((marketValue - itemPrice) / marketValue) * 10000) / 100;
      const potentialProfit = (marketValue - itemPrice) * quantity;

      const indicator = document.createElement('span');
      indicator.classList.add('price-indicator');
      indicator.title = `Potential profit: $${potentialProfit.toLocaleString()}${quantity > 1 ? ` (${quantity}x)` : ''}`;

      const icon = document.createElement('span');
      icon.classList.add('icon-store');
      indicator.appendChild(icon);
      indicator.appendChild(document.createTextNode(` ${diff > 0 ? '-' : '+'}${Math.abs(Math.round(diff))}%`));

      if (Math.abs(diff) < 0.5)  indicator.classList.add('diff-equal');
      else if (diff > 0) {
        if (diff >= 90)      indicator.classList.add('diff-90-100');
        else if (diff >= 60) indicator.classList.add('diff-60-90');
        else if (diff >= 30) indicator.classList.add('diff-30-60');
        else                 indicator.classList.add('diff-0-30');
      } else {
        if (diff <= -90)      indicator.classList.add('diff90-plus');
        else if (diff <= -60) indicator.classList.add('diff60-90');
        else if (diff <= -30) indicator.classList.add('diff30-60');
        else                  indicator.classList.add('diff0-30');
      }

      indicatorsRow.appendChild(indicator);
    }

    if (indicatorsRow.children.length > 0) container.after(indicatorsRow);
  }

  function updateSingleElement(element) {
    let itemId, priceElement;
    const isMobile = window.innerWidth < 785;

    if (isMobile) {
      const infoBtn = document.querySelector('button[aria-controls^="wai-itemInfo-"]');
      if (infoBtn) {
        const m = infoBtn.getAttribute('aria-controls').match(/wai-itemInfo-(\d+)/);
        if (m) itemId = m[1];
      }
      if (element.classList.contains('price___v8rRx')) priceElement = element;
    } else {
      let container = element;
      while (container && !itemId) {
        const img = container.querySelector('img[src*="/images/items/"]');
        if (img) { const m = img.src.match(/\/images\/items\/(\d+)\//); if (m) itemId = m[1]; }
        container = container.parentElement;
      }
      if (element.classList.contains('priceAndTotal___eEVS7') ||
          element.classList.contains('price___Uwiv2') ||
          element.className.includes('price_')) {
        priceElement = element;
      }
    }

    if (!itemId || !priceElement) return;
    const m = priceElement.textContent.match(/\$([0-9,]+)/);
    if (m) addPriceIndicator(itemId, parseInt(m[1].replace(/,/g, '')), priceElement);
  }

  function processElements() {
    const isMobile = window.innerWidth < 785;
    const url = document.URL;

    if (url.includes('sid=ItemMarket') || url.includes('imarket') || url.includes('/market')) {
      // Tile grid
      document.querySelectorAll('.itemTile___cbw7w').forEach(tile => {
        const img = tile.querySelector('img.torn-item');
        if (!img) return;
        const m = img.src.match(/\/images\/items\/(\d+)\//);
        if (!m) return;
        const priceEl = tile.querySelector('.priceAndTotal___eEVS7');
        if (!priceEl) return;
        const pm = priceEl.textContent.match(/\$([0-9,]+)/);
        if (pm) addPriceIndicator(m[1], parseInt(pm[1].replace(/,/g, '')), priceEl);
      });

      // Seller rows
      if (isMobile) {
        const infoBtn = document.querySelector('button[aria-controls^="wai-itemInfo-"]');
        if (infoBtn) {
          const im = infoBtn.getAttribute('aria-controls').match(/wai-itemInfo-(\d+)/);
          if (im) {
            const itemId = im[1];
            document.querySelectorAll('.sellerRow___Ca2pK').forEach(row => {
              const priceEl = row.querySelector('.price___v8rRx');
              if (!priceEl) return;
              const pm = priceEl.textContent.match(/\$([0-9,]+)/);
              if (!pm) return;
              addPriceIndicator(itemId, parseInt(pm[1].replace(/,/g, '')), priceEl);
              if (!row.querySelector('.userInfoHead___LXxjB')) {
                const indRow = row.querySelector('.price-indicators-row');
                if (indRow) priceEl.appendChild(indRow);
              }
            });
          }
        }
      } else {
        document.querySelectorAll('.sellerRow___AI0m6').forEach(row => {
          const img = row.querySelector('.thumbnail___M_h9v img');
          if (!img) return;
          const m = img.src.match(/\/images\/items\/(\d+)\//);
          if (!m) return;
          const priceEl = row.querySelector('.price___Uwiv2');
          if (!priceEl) return;
          const pm = priceEl.textContent.match(/\$([0-9,]+)/);
          if (pm) addPriceIndicator(m[1], parseInt(pm[1].replace(/,/g, '')), priceEl);
        });
      }
    } else if (url.includes('bazaar.php')) {
      document.querySelectorAll('img[src*="/images/items/"][src*="/large.png"]').forEach(img => {
        if (!img.parentElement?.parentElement?.parentElement) return;
        const m  = img.src.match(/\/images\/items\/(\d+)\//);
        if (!m) return;
        const container = img.parentElement.parentElement.parentElement;
        const priceEl   = container.querySelector('[class*="price_"]');
        if (!priceEl) return;
        const pm = priceEl.textContent.match(/\$([0-9,]+)/);
        if (pm) addPriceIndicator(m[1], parseInt(pm[1].replace(/,/g, '')), priceEl);
      });
    }
  }

  // ─── Ledger helpers ────────────────────────────────────────────────────────

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString(); }
  function fmtAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mn = m % 60;
    if (d > 0) return `${d}d ${h}h ago`;
    if (h > 0) return `${h}h ${mn}m ago`;
    return `${mn}m ago`;
  }
  function fmtHeld(buyTs, sellTs) {
    const h = Math.floor((sellTs - buyTs) / 3600000);
    return `${Math.floor(h/24)}d ${h%24}h`;
  }
  function roiTier(roi) {
    if (roi < 0)  return { bg: 'rgba(255,60,60,0.10)',  color: '#ff4444', label: '' };
    if (roi < 3)  return { bg: '',                       color: '#c0d0c8', label: '' };
    if (roi < 8)  return { bg: 'rgba(0,255,136,0.06)',  color: '#00ff88', label: '' };
    if (roi < 15) return { bg: 'rgba(0,255,136,0.12)',  color: '#00ff88', label: '' };
    return        { bg: 'rgba(0,255,136,0.20)',          color: '#00ff88', label: 'STRONG' };
  }

  // ─── Open trades render ────────────────────────────────────────────────────

  function renderOpenTrades() {
    const tbody = panel.querySelector('#st-open-trades-body');
    const open  = MEM.data.trades.map((t, i) => ({ ...t, _idx: i })).filter(t => t.sellPrice === null);
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8aa898;padding:12px 8px">No open trades</td></tr>';
      return;
    }
    const aggr = MEM.data.settings.aggressiveness ?? 'moderate';
    tbody.innerHTML = open.map(t => {
      const mv     = torn_market_values[t.itemId] || null;
      const target = SellTargetEngine(null, mv, aggr);
      const targetCell = target != null
        ? `<span class="st-sell-target-cell" data-target="${target}" title="Tap to copy">${fmtMoney(target)}</span>`
        : `<span style="color:#8aa898">—</span>`;
      return `
        <tr data-trade-idx="${t._idx}">
          <td>${fmtDate(t.buyDate)}</td><td>${t.name}</td><td>${t.qty}</td>
          <td>${fmtMoney(t.buyPrice)}</td><td>${fmtMoney(t.buyPrice * t.qty)}</td>
          <td>${targetCell}</td>
          <td style="white-space:nowrap">
            <button class="st-log-sell-btn st-btn" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px">Log Sell</button>
            <button class="st-delete-trade-btn st-btn st-btn-danger" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px" title="Delete">✕</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.st-sell-target-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        navigator.clipboard.writeText(String(cell.dataset.target)).catch(() => {});
        cell.classList.add('st-copied');
        setTimeout(() => cell.classList.remove('st-copied'), 1000);
      });
    });

    tbody.querySelectorAll('.st-log-sell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const existing = tbody.querySelector('.st-sell-form-row');
        if (existing) existing.remove();
        const tradeIdx = parseInt(btn.dataset.tradeIdx, 10);
        const formRow  = document.createElement('tr');
        formRow.className = 'st-sell-form-row';
        formRow.innerHTML = `
          <td colspan="7" style="padding:6px 8px 10px">
            <div style="background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:10px 12px">
              <div class="st-field"><label>Sell price / unit ($)</label><input class="st-sell-price-input st-input" type="number" min="1" style="width:150px"></div>
              <div class="st-btn-row" style="margin-top:8px">
                <button class="st-sell-confirm-btn st-btn">Confirm</button>
                <button class="st-sell-cancel-btn st-btn st-btn-danger">Cancel</button>
              </div>
            </div>
          </td>`;
        btn.closest('tr').after(formRow);
        formRow.querySelector('.st-sell-price-input').focus();
        formRow.querySelector('.st-sell-cancel-btn').addEventListener('click', () => formRow.remove());
        formRow.querySelector('.st-sell-confirm-btn').addEventListener('click', () => {
          const price = parseInt(formRow.querySelector('.st-sell-price-input').value, 10);
          if (!(price > 0)) return;
          MEM.data.trades[tradeIdx].sellPrice = price;
          MEM.data.trades[tradeIdx].sellDate  = Date.now();
          Store.set(KEYS.trades, MEM.data.trades);
          renderOpenTrades(); renderClosedTrades(); renderSummary();
        });
      });
    });

    tbody.querySelectorAll('.st-delete-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this trade? This cannot be undone.')) return;
        MEM.data.trades.splice(parseInt(btn.dataset.tradeIdx, 10), 1);
        Store.set(KEYS.trades, MEM.data.trades);
        renderOpenTrades(); renderSummary();
      });
    });
  }

  // ─── Closed trades render ──────────────────────────────────────────────────

  function renderClosedTrades() {
    const tbody  = panel.querySelector('#st-closed-trades-body');
    const closed = MEM.data.trades.map((t, i) => ({ ...t, _idx: i })).filter(t => t.sellPrice !== null);
    if (!closed.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8aa898;padding:12px 8px">No closed trades</td></tr>';
      return;
    }
    tbody.innerHTML = closed.map(t => {
      const profit = (t.sellPrice - t.buyPrice) * t.qty;
      const roi    = ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100;
      const tier   = roiTier(roi);
      const roiLabel = tier.label
        ? `${roi.toFixed(1)}% <span style="font-size:10px">${tier.label}</span>`
        : roi.toFixed(1) + '%';
      return `
        <tr style="${tier.bg ? 'background:' + tier.bg : ''}">
          <td>${t.name}</td><td>${t.qty}</td><td>${fmtMoney(t.buyPrice)}</td><td>${fmtMoney(t.sellPrice)}</td>
          <td style="color:${tier.color}">${fmtMoney(profit)}</td>
          <td style="color:${tier.color}">${roiLabel}</td>
          <td>${fmtHeld(t.buyDate, t.sellDate)}</td>
          <td><button class="st-delete-trade-btn st-btn st-btn-danger" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px" title="Delete">✕</button></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.st-delete-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this closed trade? This cannot be undone.')) return;
        MEM.data.trades.splice(parseInt(btn.dataset.tradeIdx, 10), 1);
        Store.set(KEYS.trades, MEM.data.trades);
        renderClosedTrades(); renderSummary();
      });
    });
  }

  // ─── Summary render ───────────────────────────────────────────────────────

  function renderSummary() {
    const open   = MEM.data.trades.filter(t => t.sellPrice === null);
    const closed = MEM.data.trades.filter(t => t.sellPrice !== null);
    const invested   = open.reduce((s, t) => s + t.buyPrice * t.qty, 0);
    const profit     = closed.reduce((s, t) => s + (t.sellPrice - t.buyPrice) * t.qty, 0);
    const closedCost = closed.reduce((s, t) => s + t.buyPrice * t.qty, 0);
    const wRoi   = closedCost > 0 ? (profit / closedCost) * 100 : null;
    const wins   = closed.filter(t => t.sellPrice > t.buyPrice).length;
    const winRate = closed.length ? (wins / closed.length * 100).toFixed(0) + '%' : null;
    panel.querySelector('#st-sum-invested').textContent = fmtMoney(invested);
    panel.querySelector('#st-sum-profit').textContent   = fmtMoney(profit);
    panel.querySelector('#st-sum-roi').textContent      = wRoi != null ? wRoi.toFixed(1) + '%' : '—';
    panel.querySelector('#st-sum-winrate').textContent  = winRate ?? '—';
    panel.querySelector('#st-sum-trades').textContent   = closed.length;
  }

  // ─── Pending queue ────────────────────────────────────────────────────────

  function updateQueueBadge() {
    const el = panel.querySelector('#st-ledger-tab-badge');
    if (!el) return;
    const count = MEM.ui.pendingQueue.length;
    el.textContent = count || '';
    el.style.display = count ? '' : 'none';
  }

  function renderQueueStrip() {
    updateQueueBadge();
    const section = panel.querySelector('#st-queue-section');
    const rowsEl  = panel.querySelector('#st-queue-rows');
    const badge   = panel.querySelector('#st-queue-badge');
    const count   = MEM.ui.pendingQueue.length;
    if (!count) { section.style.display = 'none'; return; }
    section.style.display = '';
    badge.textContent = count;
    rowsEl.innerHTML = MEM.ui.pendingQueue.map((item, i) => `
      <div class="st-queue-row" data-qi="${i}">
        <span class="st-queue-name" title="${item.name}">${item.name}</span>
        <span class="st-queue-price">${fmtMoney(item.price)}</span>
        <span class="st-queue-age">${fmtAgo(item.ts)}</span>
        <input class="st-input st-queue-qty-input" type="number" min="1" placeholder="qty" style="width:58px">
        <button class="st-queue-log-btn st-btn" style="font-size:11px;padding:3px 8px">Log</button>
        <button class="st-queue-rm-btn st-btn st-btn-danger" style="font-size:11px;padding:3px 8px">✕</button>
      </div>`).join('');

    rowsEl.querySelectorAll('.st-queue-log-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.st-queue-row');
        const qi  = parseInt(row.dataset.qi, 10);
        const qty = parseInt(row.querySelector('.st-queue-qty-input').value, 10);
        if (!(qty > 0)) return;
        const item = MEM.ui.pendingQueue[qi];
        if (!item) return;
        MEM.data.trades.push({ itemId: item.itemId, name: item.name, qty, buyPrice: item.price, buyDate: Date.now(), sellPrice: null, sellDate: null });
        Store.set(KEYS.trades, MEM.data.trades);
        MEM.ui.pendingQueue.splice(qi, 1);
        renderQueueStrip(); renderOpenTrades(); renderSummary();
      });
    });

    rowsEl.querySelectorAll('.st-queue-rm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        MEM.ui.pendingQueue.splice(parseInt(btn.closest('.st-queue-row').dataset.qi, 10), 1);
        renderQueueStrip();
      });
    });
  }

  panel.querySelector('#st-queue-log-all-btn').addEventListener('click', () => {
    const rows  = [...panel.querySelectorAll('#st-queue-rows .st-queue-row')];
    const toLog = rows
      .map(row => ({ qi: parseInt(row.dataset.qi, 10), qty: parseInt(row.querySelector('.st-queue-qty-input').value, 10) }))
      .filter(({ qi, qty }) => qty > 0 && MEM.ui.pendingQueue[qi])
      .sort((a, b) => b.qi - a.qi);
    if (!toLog.length) return;
    toLog.forEach(({ qi, qty }) => {
      const item = MEM.ui.pendingQueue[qi];
      MEM.data.trades.push({ itemId: item.itemId, name: item.name, qty, buyPrice: item.price, buyDate: Date.now(), sellPrice: null, sellDate: null });
      MEM.ui.pendingQueue.splice(qi, 1);
    });
    Store.set(KEYS.trades, MEM.data.trades);
    renderQueueStrip(); renderOpenTrades(); renderSummary();
  });

  panel.querySelector('#st-queue-clear-btn').addEventListener('click', () => {
    MEM.ui.pendingQueue.length = 0;
    renderQueueStrip();
  });

  // ─── Log import ───────────────────────────────────────────────────────────

  panel.querySelector('#st-import-btn').addEventListener('click', () => {
    const ta      = panel.querySelector('#st-import-textarea');
    const status  = panel.querySelector('#st-import-status');
    const entries = LogParser(ta.value);
    if (!entries.length) { status.textContent = 'No valid entries found.'; return; }
    const added = importLogEntries(entries);
    status.textContent = added > 0 ? `Added ${added} trade${added === 1 ? '' : 's'}.` : 'No new entries (all duplicates).';
    if (added > 0) ta.value = '';
  });

  // ─── Tab switching ─────────────────────────────────────────────────────────

  panel.querySelectorAll('.st-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.st-tab').forEach(t => t.classList.remove('st-active'));
      panel.querySelectorAll('.st-pane').forEach(p => p.classList.remove('st-active'));
      tab.classList.add('st-active');
      panel.querySelector(`#st-pane-${tab.dataset.tab}`).classList.add('st-active');
      if (tab.dataset.tab === 'ledger') {
        renderQueueStrip(); renderOpenTrades(); renderClosedTrades(); renderSummary();
        fetchApiLogEntries().then(entries => { if (entries.length) importLogEntries(entries); });
      }
    });
  });

  // ─── FAB + drawer ─────────────────────────────────────────────────────────

  function openDrawer()  { panel.classList.add('st-drawer-open');    MEM.ui.collapsed = false; Store.set(KEYS.collapsed, false); }
  function closeDrawer() { panel.classList.remove('st-drawer-open'); MEM.ui.collapsed = true;  Store.set(KEYS.collapsed, true);  }

  fab.addEventListener('click', () => {
    if (panel.classList.contains('st-drawer-open')) closeDrawer(); else openDrawer();
  });
  if (!MEM.ui.collapsed) openDrawer();

  // ─── Drag-to-resize ───────────────────────────────────────────────────────

  const drawerHandle = panel.querySelector('#st-drawer-handle');
  let resizing = false, rsY = 0, rsH = 0;
  const startResize = y => { resizing = true; rsY = y; rsH = panel.offsetHeight; panel.style.transition = 'none'; };
  const doResize    = y => { if (!resizing) return; panel.style.height = Math.min(window.innerHeight * 0.9, Math.max(120, rsH + (rsY - y))) + 'px'; };
  const endResize   = () => { if (resizing) panel.style.transition = ''; resizing = false; };
  drawerHandle.addEventListener('mousedown',  e => { startResize(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove',  e => { if (resizing) doResize(e.clientY); });
  document.addEventListener('mouseup',    endResize);
  drawerHandle.addEventListener('touchstart', e => { startResize(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove',  e => { if (resizing) doResize(e.touches[0].clientY); }, { passive: false });
  document.addEventListener('touchend',   endResize);

  // ─── Settings ─────────────────────────────────────────────────────────────

  const inputApiKey = panel.querySelector('#st-input-apikey');
  if (localStorage.getItem('st_apikey')) inputApiKey.placeholder = '(key saved)';
  inputApiKey.addEventListener('change', () => {
    const val = inputApiKey.value.trim();
    if (val) { localStorage.setItem('st_apikey', val); inputApiKey.value = ''; inputApiKey.placeholder = '(key saved)'; }
  });

  function updateAggrButtons() {
    const current = MEM.data.settings.aggressiveness ?? 'moderate';
    panel.querySelectorAll('.st-aggr-btn').forEach(btn => btn.classList.toggle('st-aggr-active', btn.dataset.aggr === current));
  }
  panel.querySelectorAll('.st-aggr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MEM.data.settings.aggressiveness = btn.dataset.aggr;
      Store.set(KEYS.settings, MEM.data.settings);
      updateAggrButtons(); renderOpenTrades(); renderSummary();
    });
  });
  updateAggrButtons();

  panel.querySelector('#st-refresh-market-btn').addEventListener('click', getTornMarketValues);

  panel.querySelector('#st-clear-btn').addEventListener('click', () => {
    if (!confirm('Clear all Snipe Tracker data?')) return;
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    torn_market_values = {};
    MEM.data.trades    = [];
    MEM.data.settings  = { aggressiveness: 'moderate' };
    MEM.ui.collapsed   = false;
    updateAggrButtons(); openDrawer();
    panel.style.height = '';
    renderOpenTrades(); renderClosedTrades(); renderSummary();
  });

  // ─── Export CSV ───────────────────────────────────────────────────────────

  function csvEsc(v) { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  panel.querySelector('#st-export-btn').addEventListener('click', () => {
    const closed = MEM.data.trades.filter(t => t.sellPrice !== null);
    const rows   = [
      ['Item', 'Qty', 'Buy Price', 'Sell Price', 'Profit', 'ROI %', 'Held'],
      ...closed.map(t => {
        const profit = (t.sellPrice - t.buyPrice) * t.qty;
        const roi    = ((t.sellPrice - t.buyPrice) / t.buyPrice * 100).toFixed(1);
        return [t.name, t.qty, t.buyPrice, t.sellPrice, profit, roi, fmtHeld(t.buyDate, t.sellDate)];
      }),
    ];
    const csv  = rows.map(r => r.map(csvEsc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'snipe_trades.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  });

  // ─── MutationObserver ─────────────────────────────────────────────────────

  const observer = new MutationObserver(mutations => {
    const affected = new Set();
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        let el = mutation.target.parentElement;
        while (el) {
          if (el.classList) {
            if (el.classList.contains('priceAndTotal___eEVS7') ||
                el.classList.contains('price___Uwiv2') ||
                [...el.classList].some(c => c.includes('price_'))) {
              affected.add(el); break;
            }
          }
          el = el.parentElement;
        }
      } else if (mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList?.contains('itemTile___cbw7w') ||
                node.classList?.contains('sellerRow___AI0m6') ||
                node.querySelector?.('.itemTile___cbw7w, .sellerRow___AI0m6, [class*="price_"]')) {
              processElements(); return;
            }
          }
        }
      }
    }
    affected.forEach(el => updateSingleElement(el));
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  renderQueueStrip(); renderOpenTrades(); renderClosedTrades(); renderSummary();
  fetchApiLogEntries().then(entries => { if (entries.length) importLogEntries(entries); });

  if (Date.now() - (Store.get(KEYS.marketValuesTs) ?? 0) > 24 * 60 * 60 * 1000) {
    getTornMarketValues();
  }

  scheduleNextUpdate();

  setTimeout(() => {
    observer.observe(document.body, {
      childList: true, subtree: true,
      characterData: true, characterDataOldValue: true,
    });
    processElements();
  }, 1000);

})();
