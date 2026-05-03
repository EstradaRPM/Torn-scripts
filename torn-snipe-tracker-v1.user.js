// ==UserScript==
// @name         Torn Snipe Tracker
// @namespace    estradarpm-snipe-tracker
// @version      1.63.0
// @description  Bazaar snipe detector and trade ledger for Torn City
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      api.torn.com
// @connect      weav3r.dev
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

  const SCRIPT_VERSION   = '1.63.0';
  const API_KEY          = '###PDA-APIKEY###';

  // Prefer PDA-injected key; fall back to manually stored key
  function getApiKey() {
    if (API_KEY !== '###PDA-APIKEY###') return API_KEY;
    return localStorage.getItem('st_apikey') ?? '';
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  const KEYS = {
    settings:   'st_settings',
    collapsed:  'st_collapsed',
    trades:     'st_trades',
    apiKey:     'st_apikey',
    snapshots:  'st_snapshots',
    trendcache: 'st_trendcache',
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
          alert('[Snipe Tracker] Storage quota exceeded — data could not be saved. Free up browser storage or clear old data.');
        }
      }
    },
  };

  // One-time migration: move stale watchlist/poll keys to tombstone so data isn't silently lost
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
      settings:   Store.get(KEYS.settings)  ?? { aggressiveness: 'moderate' },
      trades:     Store.get(KEYS.trades)    ?? [],
      snapshots:  Store.get(KEYS.snapshots) ?? {},
      trendCache: Store.get(KEYS.trendcache) ?? {},
    },
    price: {
      bazaarMap:     null,  // itemId -> bazaarAverage; null until PriceDataModule.init() resolves
      marketValueMap: null, // itemId -> marketValue;   null until PriceDataModule.init() resolves
    },
    sellerRow: {
      p50:      null,   // computed from per-item weav3r Refresh; null until user taps Refresh
      fetching: false,  // prevents double-tap
    },
    fetchError: null,       // string | null — set by PriceDataModule.init() on partial/full failure
    ui: {
      collapsed:        Store.get(KEYS.collapsed) ?? false,
      storageWarnShown: false,
      pendingQueue:     [],
    },
  };

  if (PAGE_MODE !== 'market') return;

  // ─── Styles ───────────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
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
    #st-fab.st-fab-alert { border-color: #ff4444; background: #1a0808; }
    #st-fab-api {
      position: absolute;
      bottom: -4px;
      left: -4px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1.5px solid #0c1e2e;
      pointer-events: none;
    }
    #st-fab-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ff4444;
      color: #fff;
      border-radius: 10px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 700;
      min-width: 16px;
      text-align: center;
      line-height: 1.4;
      font-family: 'Segoe UI', Arial, sans-serif;
    }

    /* ── Drawer ── */
    #st-drawer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
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

    /* ── Drawer handle ── */
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

    /* ── Drawer title ── */
    #st-drawer-titlebar {
      display: flex;
      align-items: center;
      padding: 0 14px 6px;
      flex-shrink: 0;
    }
    #st-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #00ff88;
      text-transform: uppercase;
      text-shadow: 0 0 12px rgba(0,255,136,0.5);
    }
    #st-api-counter {
      margin-left: auto;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      background: rgba(0,0,0,0.3);
      letter-spacing: 0.04em;
    }



    /* ── Body (tabs + pane container) ── */
    #st-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      flex: 1;
    }

    /* ── Tabs ── */
    #st-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid #1a2a3a;
      background: #0a1220;
    }

    .st-tab {
      padding: 9px 22px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      cursor: pointer;
      color: #8aa898;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      text-transform: uppercase;
    }
    .st-tab:hover {
      color: #d4e4dc;
    }
    .st-tab.st-active {
      color: #00ff88;
      border-bottom: 2px solid #00ff88;
      text-shadow: 0 0 10px rgba(0,255,136,0.4);
    }

    /* ── Tab panes ── */
    .st-pane {
      display: none;
      padding: 10px;
    }
    .st-pane.st-active {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }

    /* ── Tables ── */
    .st-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .st-table th {
      text-align: left;
      color: #00ccff !important;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      padding: 5px 8px;
      border-bottom: 1px solid #1a2a3a;
      text-shadow: 0 0 8px rgba(0,204,255,0.35);
    }
    .st-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #0f1e2e;
      vertical-align: middle;
      color: #c0d0c8 !important;
      text-shadow: 0 1px 3px rgba(0,0,0,0.7);
    }
    .st-table tr:last-child td {
      border-bottom: none;
    }
    .st-table tr:hover td {
      background: rgba(255,255,255,0.025);
    }

    /* ── Status badges ── */
    .st-status-snipe {
      color: #00ff88;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-shadow: 0 0 8px rgba(0,255,136,0.45);
    }


    /* ── Pending queue strip ── */
    #st-queue-section {
      margin-bottom: 4px;
      border: 1px solid #1a3a2a;
      border-radius: 6px;
      background: #050e0a;
      overflow: hidden;
    }
    #st-queue-section .st-section-label {
      margin: 0;
      padding: 6px 10px;
      border-bottom: 1px solid #1a3a2a;
      border-radius: 6px 6px 0 0;
    }
    .st-queue-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-bottom: 1px solid #0a1a12;
      font-size: 12px;
    }
    .st-queue-row:last-child { border-bottom: none; }
    .st-queue-name {
      flex: 1;
      color: #c0d0c8;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .st-queue-price { color: #00ff88; font-weight: 700; white-space: nowrap; }
    .st-queue-age   { color: #8aa898; font-size: 11px; white-space: nowrap; }
    .st-queue-badge {
      display: inline-block;
      background: #00cc66;
      color: #050e0a;
      border-radius: 10px;
      padding: 0 6px;
      font-size: 11px;
      font-weight: 700;
      margin-left: 5px;
      line-height: 1.4;
    }
    #st-queue-batch-row { padding: 0 8px 8px; margin-top: 4px; }

    /* ── Trend indicators ── */
    .st-trend-rising {
      color: #00ff88;
      font-size: 12px;
      white-space: nowrap;
    }
    .st-trend-falling {
      color: #ff4444;
      font-size: 12px;
      white-space: nowrap;
    }
    .st-trend-flat {
      color: #6a8070;
      font-size: 12px;
    }
    .st-trend-dim {
      color: #3a5060;
      font-size: 11px;
    }
    .st-trend-age {
      color: #3a5060;
      font-size: 10px;
      letter-spacing: 0.03em;
    }

    /* ── Profit/ROI tints ── */
    .st-profit {
      color: #00ff88;
      text-shadow: 0 0 8px rgba(0,255,136,0.35);
    }
    .st-roi {
      color: #00ff88;
      text-shadow: 0 0 8px rgba(0,255,136,0.35);
    }

    /* ── Tile profit badges ── */
    .st-profit-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
      line-height: 1.4;
      vertical-align: middle;
      pointer-events: none;
    }
    .st-profit-badge.st-badge-green {
      background: rgba(0, 255, 136, 0.15);
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.3);
    }
    .st-profit-badge.st-badge-amber {
      background: rgba(255, 153, 68, 0.15);
      color: #ff9944;
      border: 1px solid rgba(255, 153, 68, 0.3);
    }

    /* ── Seller row Refresh button ── */
    .st-seller-refresh-btn {
      display: block;
      margin: 6px 8px;
      padding: 6px 14px;
      background: #0c1e2e;
      border: 1px solid #2a3a4a;
      border-radius: 4px;
      color: #00ccff;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      touch-action: manipulation;
    }
    .st-seller-refresh-btn:disabled {
      color: #556677;
      cursor: default;
    }

    /* ── Seller row log button ── */
    .st-log-btn {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      margin-left: 5px;
      line-height: 1.4;
      vertical-align: middle;
      background: rgba(0, 204, 255, 0.12);
      color: #00ccff;
      border: 1px solid rgba(0, 204, 255, 0.3);
      cursor: pointer;
      touch-action: manipulation;
      transition: background 0.15s, color 0.15s;
    }
    .st-log-btn:active { background: rgba(0, 204, 255, 0.25); }
    .st-log-btn.st-log-btn-confirmed {
      background: rgba(0, 255, 136, 0.15);
      color: #00ff88;
      border-color: rgba(0, 255, 136, 0.3);
      cursor: default;
    }

    /* ── Section labels ── */
    .st-section-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #00ccff;
      margin: 14px 0 8px 0;
      padding-bottom: 4px;
      border-bottom: 1px solid #1a2a3a;
      text-shadow: 0 0 8px rgba(0,204,255,0.4);
    }
    .st-section-label:first-child {
      margin-top: 0;
    }

    /* ── Summary row ── */
    .st-summary {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      background: #0a1220;
      border: 1px solid #1a2a3a;
      border-radius: 6px;
      padding: 10px 12px;
      margin-top: 12px;
      font-size: 12px;
    }
    .st-summary-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .st-summary-label {
      color: #8aa898;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .st-summary-value {
      color: #00ff88;
      font-weight: 700;
      font-size: 14px;
      text-shadow: 0 0 10px rgba(0,255,136,0.4);
    }

    /* ── Buttons ── */
    .st-btn {
      background: #0c1e2e;
      border: 1px solid #2a3a4a;
      border-radius: 5px;
      color: #c0d0c8;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 6px 14px;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .st-btn:hover:not(:disabled) {
      border-color: #00ff88;
      color: #00ff88;
    }
    .st-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .st-btn-blue:hover:not(:disabled) {
      border-color: #00ccff;
      color: #00ccff;
    }
    .st-btn-danger:hover:not(:disabled) {
      border-color: #ff4444;
      color: #ff4444;
    }

    .st-btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    /* ── Settings (now a tab pane) ── */
    .st-settings {
      padding: 12px 14px 14px;
    }
    .st-settings-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #8aa0b0;
      margin-bottom: 10px;
    }
    .st-settings-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: flex-end;
      margin-bottom: 10px;
    }
    .st-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .st-field label {
      font-size: 11px;
      color: #8aa0b0;
      letter-spacing: 0.05em;
    }
    .st-input {
      background: #0c1622;
      border: 1px solid #1a2a3a;
      border-radius: 4px;
      color: #c0d0c8;
      font-size: 13px;
      padding: 5px 10px;
      width: 110px;
      outline: none;
      transition: border-color 0.15s;
    }
    .st-input:focus {
      border-color: #00ccff;
    }

    @media (max-width: 560px) {
      .st-table th,
      .st-table td {
        padding: 5px 5px;
        font-size: 12px;
      }
    }

    .st-aggr-btn.st-aggr-active {
      border-color: #00ff88;
      color: #00ff88;
      background: #0a2018;
    }
    .st-sell-target-cell {
      cursor: pointer;
      color: #4ecdc4;
      font-weight: 600;
      white-space: nowrap;
    }
    .st-sell-target-cell.st-copied {
      color: #00ff88;
    }
  `;
  document.head.appendChild(style);

  // ─── HTML ──────────────────────────────────────────────────────────────────

  const fab = document.createElement('div');
  fab.id = 'st-fab';
  fab.innerHTML = `<span id="st-fab-badge" style="display:none">0</span><span id="st-fab-api" style="display:none"></span>⚡`;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'st-drawer';
  panel.innerHTML = `
    <div id="st-drawer-handle"></div>
    <div id="st-drawer-titlebar">
      <span id="st-title">Snipe Tracker v${SCRIPT_VERSION}</span>
    </div>
    <div id="st-body">
      <!-- Tabs -->
      <div id="st-tabs">
        <div class="st-tab st-active" data-tab="ledger">Ledger<span id="st-ledger-tab-badge" class="st-queue-badge" style="display:none"></span></div>
        <div class="st-tab" data-tab="settings">Settings</div>
      </div>

      <!-- ── LEDGER pane ── -->
      <div id="st-pane-ledger" class="st-pane st-active">

        <!-- Pending Queue -->
        <div id="st-queue-section" style="display:none">
          <div class="st-section-label">Pending Queue <span id="st-queue-badge"></span></div>
          <div id="st-queue-rows"></div>
          <div class="st-btn-row" id="st-queue-batch-row">
            <button id="st-queue-log-all-btn" class="st-btn">Log All</button>
            <button id="st-queue-clear-btn" class="st-btn st-btn-danger">Clear Queue</button>
          </div>
        </div>

        <!-- Import from log -->
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
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Buy Price</th>
              <th>Total</th>
              <th>Sell Target</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="st-open-trades-body"></tbody>
        </table>

        <div class="st-section-label">Closed Trades</div>
        <table class="st-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Buy</th>
              <th>Sell</th>
              <th>Profit</th>
              <th>ROI %</th>
              <th>Held</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="st-closed-trades-body"></tbody>
        </table>

        <div class="st-summary">
          <div class="st-summary-item">
            <span class="st-summary-label">Invested</span>
            <span class="st-summary-value" id="st-sum-invested">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">At Risk</span>
            <span class="st-summary-value" id="st-sum-atrisk">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Live Est</span>
            <span class="st-summary-value" id="st-sum-liveest">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Total Profit</span>
            <span class="st-summary-value" id="st-sum-profit">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">W. ROI</span>
            <span class="st-summary-value" id="st-sum-roi">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Win Rate</span>
            <span class="st-summary-value" id="st-sum-winrate">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Trades</span>
            <span class="st-summary-value" id="st-sum-trades">0</span>
          </div>
        </div>

        <div class="st-btn-row">
          <button id="st-export-btn" class="st-btn st-btn-blue">Export CSV</button>
        </div>
      </div>

      <!-- ── Settings pane ── -->
      <div id="st-pane-settings" class="st-pane">
        <div class="st-settings">
          <div class="st-settings-title">Settings</div>
          <div class="st-field" style="margin-bottom:10px">
            <label for="st-input-apikey">API Key <span style="font-weight:400;color:#4a6070">(only needed if not auto-injected by Torn PDA)</span></label>
            <input id="st-input-apikey" class="st-input" type="password" placeholder="paste key here" style="width:240px">
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
    const baz    = bazaarAverage ?? marketValue;
    const market = marketValue   ?? bazaarAverage;
    if (aggressiveness === 'conservative') return baz;
    if (aggressiveness === 'aggressive')   return market;
    return Math.round((baz + market) / 2);
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

  // ─── Log import (paste + API) ─────────────────────────────────────────────

  function parseApiLogEntry(entry) {
    const data      = entry.data ?? entry.params ?? {};
    const itemName  = data.item ?? data.name ?? data.itemname ?? null;
    const qty       = parseInt(data.quantity ?? data.qty ?? 1, 10);
    const totalCost = data.cost ?? data.total ?? null;
    const unitPrice = data.price != null
      ? parseInt(data.price, 10)
      : totalCost != null ? Math.round(parseInt(totalCost, 10) / qty) : null;
    if (!itemName || unitPrice == null) return null;
    const itemId    = data.item_id ?? data.itemid ?? data.itemId ?? null;
    const ts        = entry.timestamp ? entry.timestamp * 1000 : null;
    return { itemId: itemId ? parseInt(itemId, 10) : null, itemName, purchasePrice: unitPrice, quantity: qty, timestamp: ts };
  }

  async function fetchApiLogEntries() {
    const key = getApiKey();
    if (!key) return [];
    try {
      const text    = await gmFetch(`https://api.torn.com/v2/user/log?log=1112,1125&limit=100&key=${key}`);
      const d       = JSON.parse(text);
      if (d.error) return [];
      const raw     = Array.isArray(d.log) ? d.log : Object.values(d.log ?? {});
      return raw.flatMap(e => { const r = parseApiLogEntry(e); return r ? [r] : []; });
    } catch (e) {
      return [];
    }
  }

  function logEntryDedupeKey(name, buyDate) {
    return `${name}|${buyDate}`;
  }

  function importLogEntries(entries) {
    const existing = new Set(MEM.data.trades.map(t => logEntryDedupeKey(t.name, t.buyDate)));
    let added = 0;
    for (const e of entries) {
      const trade = {
        itemId:    e.itemId,
        name:      e.itemName,
        qty:       e.quantity,
        buyPrice:  e.purchasePrice,
        buyDate:   e.timestamp ?? Date.now(),
        sellPrice: null,
        sellDate:  null,
      };
      const key = logEntryDedupeKey(trade.name, trade.buyDate);
      if (!existing.has(key)) {
        MEM.data.trades.push(trade);
        existing.add(key);
        added++;
      }
    }
    if (added > 0) {
      Store.set(KEYS.trades, MEM.data.trades);
      renderOpenTrades();
      renderClosedTrades();
      renderSummary();
    }
    return added;
  }

  // ─── API ──────────────────────────────────────────────────────────────────

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:  'GET',
        url,
        onload:  r  => resolve(r.responseText),
        onerror: () => reject(new Error('GM_xmlhttpRequest network error')),
      });
    });
  }

  // ─── Tile profit badges ───────────────────────────────────────────────────────

  function computeBadge(listingPrice, bazaarAverage, marketValue) {
    if (bazaarAverage == null && marketValue == null) return null;
    const refs = [bazaarAverage, marketValue].filter(v => v != null);
    const hiRef = Math.max(...refs);
    const loRef = Math.min(...refs);
    const hiProfit = hiRef - listingPrice;
    const loProfit = loRef - listingPrice;
    if (hiProfit <= 0) return null;
    const fmt = n => '$' + Math.round(n).toLocaleString();
    if (loProfit > 0) {
      const text = loRef === hiRef ? `${fmt(hiProfit)} profit` : `${fmt(loProfit)} – ${fmt(hiProfit)} profit`;
      return { color: 'green', text };
    }
    return { color: 'amber', text: `${fmt(hiProfit)} profit` };
  }

  function injectBadgeOnTile(tile, itemId) {
    if (tile.querySelector('.st-profit-badge')) return;
    const { bazaarAverage, marketValue } = PriceDataModule.getItemData(itemId);
    const prices = parseNodePrices(tile);
    if (!prices.length) return;
    const badge = computeBadge(prices[0], bazaarAverage, marketValue);
    if (!badge) return;
    const priceEl = tile.querySelector('[class*="price"]') ?? tile.querySelector('[class*="value"]') ?? tile;
    const el = document.createElement('span');
    el.className = `st-profit-badge st-badge-${badge.color}`;
    el.textContent = badge.text;
    priceEl.appendChild(el);
  }

  function injectBadgesOnAllTiles() {
    const itemId = getImarketItemId();
    if (!itemId) return;
    document.querySelectorAll('.itemTile___cbw7w').forEach(tile => injectBadgeOnTile(tile, itemId));
  }

  function injectBadgesFromNodes(addedNodes) {
    const itemId = getImarketItemId();
    if (!itemId) return;
    for (const node of addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.classList?.contains('itemTile___cbw7w')) {
        injectBadgeOnTile(node, itemId);
      } else {
        node.querySelectorAll?.('.itemTile___cbw7w').forEach(tile => injectBadgeOnTile(tile, itemId));
      }
    }
  }

  // ─── Seller row badges + per-item Refresh (#213) ────────────────────────────

  const SELLER_ROW_SELECTOR = '.sellerRow___AI0m6, .sellerRow___Ca2pK';

  function logSellerRowTrade(btn, itemId, listingPrice) {
    if (btn.classList.contains('st-log-btn-confirmed')) return;
    const name = getImarketItemName(itemId);
    MEM.data.trades.push({
      itemId,
      name,
      qty:       1,
      buyPrice:  listingPrice,
      buyDate:   Date.now(),
      sellPrice: null,
      sellDate:  null,
    });
    Store.set(KEYS.trades, MEM.data.trades);
    renderOpenTrades();
    renderSummary();
    btn.textContent = '✓';
    btn.classList.add('st-log-btn-confirmed');
    setTimeout(() => {
      btn.textContent = 'Log';
      btn.classList.remove('st-log-btn-confirmed');
    }, 2000);
  }

  function computeRoiBadge(listingPrice, p50) {
    if (p50 == null || listingPrice <= 0) return null;
    const roi = ((p50 - listingPrice) / listingPrice) * 100;
    if (roi <= 0) return null;
    return { color: 'green', text: `${roi.toFixed(1)}% ROI` };
  }

  function injectBadgeOnSellerRow(row, itemId) {
    if (row.querySelector('.st-profit-badge')) return;
    const prices = parseNodePrices(row);
    if (!prices.length) return;
    const listingPrice = prices[0];
    const { bazaarAverage, marketValue } = PriceDataModule.getItemData(itemId);
    const badge = MEM.sellerRow.p50 != null
      ? computeRoiBadge(listingPrice, MEM.sellerRow.p50)
      : computeBadge(listingPrice, bazaarAverage, marketValue);
    if (!badge) return;
    const el = document.createElement('span');
    el.className = `st-profit-badge st-badge-${badge.color}`;
    el.textContent = badge.text;
    const logBtn = document.createElement('button');
    logBtn.className = 'st-log-btn';
    logBtn.textContent = 'Log';
    logBtn.addEventListener('click', e => { e.stopPropagation(); logSellerRowTrade(logBtn, itemId, listingPrice); });
    const anchor = row.querySelector('[class*="price"]') ?? row.querySelector('[class*="value"]') ?? row;
    anchor.appendChild(el);
    anchor.appendChild(logBtn);
  }

  function injectBadgesOnAllSellerRows() {
    const itemId = getImarketItemId();
    if (!itemId) return;
    document.querySelectorAll(SELLER_ROW_SELECTOR).forEach(row => injectBadgeOnSellerRow(row, itemId));
  }

  function injectSellerRowsFromNodes(addedNodes) {
    const itemId = getImarketItemId();
    if (!itemId) return;
    for (const node of addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.(SELLER_ROW_SELECTOR)) {
        injectBadgeOnSellerRow(node, itemId);
      } else {
        node.querySelectorAll?.(SELLER_ROW_SELECTOR).forEach(row => injectBadgeOnSellerRow(row, itemId));
      }
    }
  }

  function updateSellerRowBadgesToRoi() {
    const itemId = getImarketItemId();
    document.querySelectorAll(SELLER_ROW_SELECTOR).forEach(row => {
      row.querySelector('.st-profit-badge')?.remove();
      injectBadgeOnSellerRow(row, itemId);
    });
  }

  function injectRefreshButton(itemId) {
    if (document.getElementById('st-seller-refresh')) return;
    const firstRow = document.querySelector(SELLER_ROW_SELECTOR);
    if (!firstRow) return;
    const container = firstRow.parentElement;
    if (!container) return;
    const btn = document.createElement('button');
    btn.id = 'st-seller-refresh';
    btn.className = 'st-seller-refresh-btn';
    btn.textContent = 'Refresh Prices';
    btn.addEventListener('click', () => handleSellerRowRefresh(itemId));
    container.insertBefore(btn, container.firstChild);
  }

  async function handleSellerRowRefresh(itemId) {
    if (MEM.sellerRow.fetching) return;
    MEM.sellerRow.fetching = true;
    const btn = document.getElementById('st-seller-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
    try {
      const text = await gmFetch(`https://weav3r.dev/api/marketplace/${itemId}`);
      const d = JSON.parse(text);
      if (d.error) throw new Error(d.error);
      const listings = (d.listings ?? []).map(l => ({ price: l.price, quantity: l.quantity }));
      const { p50 } = computeFairValue(listings);
      MEM.sellerRow.p50 = p50;
      updateSellerRowBadgesToRoi();
      if (btn) btn.textContent = p50 ? `Refreshed — p50 $${Math.round(p50).toLocaleString()}` : 'Refresh Prices';
    } catch (err) {
      console.error('[SnipeTracker] seller row refresh failed:', err.message);
      if (btn) btn.textContent = 'Refresh failed';
    } finally {
      MEM.sellerRow.fetching = false;
      if (btn) btn.disabled = false;
    }
  }

  function maybeInjectRefreshButton() {
    const itemId = getImarketItemId();
    if (itemId) injectRefreshButton(itemId);
  }

  // ─── PriceDataModule ──────────────────────────────────────────────────────────

  function parseBazaarResponse(d) {
    const map = {};
    for (const item of (d.items ?? [])) {
      map[item.item_id] = item.bazaar_average ?? null;
    }
    return map;
  }

  function parseItemsResponse(d) {
    const map = {};
    for (const [id, v] of Object.entries(d.items ?? {})) {
      map[parseInt(id, 10)] = v.market_value ?? null;
    }
    return map;
  }

  const PriceDataModule = {
    async init() {
      const key = getApiKey();
      const [weav3rResult, tornResult] = await Promise.allSettled([
        gmFetch('https://weav3r.dev/api/marketplace').then(t => parseBazaarResponse(JSON.parse(t))),
        gmFetch(`https://api.torn.com/torn/?selections=items&key=${key}`).then(t => {
          const d = JSON.parse(t);
          if (d.error) throw new Error(d.error.error ?? `API error ${d.error.code}`);
          return parseItemsResponse(d);
        }),
      ]);

      const errors = [];
      if (weav3rResult.status === 'fulfilled') {
        MEM.price.bazaarMap = weav3rResult.value;
      } else {
        errors.push(`weav3r: ${weav3rResult.reason.message}`);
        console.error('[SnipeTracker] PriceDataModule weav3r failed:', weav3rResult.reason.message);
      }
      if (tornResult.status === 'fulfilled') {
        MEM.price.marketValueMap = tornResult.value;
      } else {
        errors.push(`torn items: ${tornResult.reason.message}`);
        console.error('[SnipeTracker] PriceDataModule torn items failed:', tornResult.reason.message);
      }
      if (errors.length) MEM.fetchError = errors.join('; ');
    },

    getItemData(itemId) {
      return {
        bazaarAverage: MEM.price.bazaarMap?.[itemId] ?? null,
        marketValue:   MEM.price.marketValueMap?.[itemId] ?? null,
      };
    },
  };

  // Listing-count percentile fair value. Each listing is one data point regardless
  // of quantity — a bulk seller with 500 units gets one vote, not 500, so large
  // cheap inventories can't drag the fair value to the market floor.
  function computeFairValue(listings) {
    if (!listings.length) return { p25: null, p50: null, p75: null };
    const sorted = [...listings].sort((a, b) => a.price - b.price);
    const n = sorted.length;
    return {
      p25: sorted[Math.floor(n * 0.25)].price,
      p50: sorted[Math.floor(n * 0.50)].price,
      p75: sorted[Math.floor(n * 0.75)].price,
    };
  }

  function showStorageWarning() {
    if (MEM.ui.storageWarnShown) return;
    MEM.ui.storageWarnShown = true;
    const warn = document.createElement('div');
    warn.id = 'st-storage-warn';
    warn.style.cssText = 'background:#1a0800;border-bottom:1px solid #ff6600;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#ff9944;line-height:1.4';
    warn.innerHTML = `
      <span>Storage limit approaching — consider reducing watchlist size or snapshot retention period.</span>
      <button style="background:none;border:none;color:#ff9944;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0" id="st-storage-warn-dismiss">✕</button>
    `;
    const body = panel.querySelector('#st-body');
    body.insertBefore(warn, body.firstChild);
    panel.querySelector('#st-storage-warn-dismiss').addEventListener('click', () => warn.remove());
  }

  // ─── Ledger helpers ────────────────────────────────────────────────────────

  function fmtDate(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dy}`;
  }

  function fmtMoney(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  function fmtAgo(ts) {
    const totalMins = Math.floor((Date.now() - ts) / 60000);
    const days  = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins  = totalMins % 60;
    if (days > 0)  return `${days}d ${hours}h ago`;
    if (hours > 0) return `${hours}h ${mins}m ago`;
    return `${mins}m ago`;
  }

  // ─── Open trades render ────────────────────────────────────────────────────

  function renderOpenTrades() {
    const tbody = panel.querySelector('#st-open-trades-body');
    const open = MEM.data.trades
      .map((t, i) => ({ ...t, _idx: i }))
      .filter(t => t.sellPrice === null);
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8aa898;padding:12px 8px">No open trades</td></tr>';
      return;
    }
    const aggr = MEM.data.settings.aggressiveness ?? 'moderate';
    tbody.innerHTML = open.map(t => {
      const { bazaarAverage, marketValue } = PriceDataModule.getItemData(t.itemId);
      const target = SellTargetEngine(bazaarAverage, marketValue, aggr);
      const targetCell = target != null
        ? `<span class="st-sell-target-cell" data-target="${target}" title="Tap to copy">${fmtMoney(target)}</span>`
        : `<span style="color:#8aa898">—</span>`;
      return `
        <tr data-trade-idx="${t._idx}">
          <td>${fmtDate(t.buyDate)}</td>
          <td>${t.name}</td>
          <td>${t.qty}</td>
          <td>${fmtMoney(t.buyPrice)}</td>
          <td>${fmtMoney(t.buyPrice * t.qty)}</td>
          <td>${targetCell}</td>
          <td style="white-space:nowrap">
            <button class="st-log-sell-btn st-btn" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px">Log Sell</button>
            <button class="st-delete-trade-btn st-btn st-btn-danger" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px" title="Delete this trade">✕</button>
          </td>
        </tr>
      `;
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
        const parentRow = btn.closest('tr');

        const formRow = document.createElement('tr');
        formRow.className = 'st-sell-form-row';
        formRow.innerHTML = `
          <td colspan="7" style="padding:6px 8px 10px">
            <div style="background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:10px 12px">
              <div class="st-field">
                <label>Sell price / unit ($)</label>
                <input class="st-sell-price-input st-input" type="number" min="1" style="width:150px">
              </div>
              <div class="st-btn-row" style="margin-top:8px">
                <button class="st-sell-confirm-btn st-btn">Confirm</button>
                <button class="st-sell-cancel-btn st-btn st-btn-danger">Cancel</button>
              </div>
            </div>
          </td>
        `;
        parentRow.after(formRow);
        formRow.querySelector('.st-sell-price-input').focus();

        formRow.querySelector('.st-sell-cancel-btn').addEventListener('click', () => {
          formRow.remove();
        });

        formRow.querySelector('.st-sell-confirm-btn').addEventListener('click', () => {
          const price = parseInt(formRow.querySelector('.st-sell-price-input').value, 10);
          if (!(price > 0)) return;
          MEM.data.trades[tradeIdx].sellPrice = price;
          MEM.data.trades[tradeIdx].sellDate  = Date.now();
          Store.set(KEYS.trades, MEM.data.trades);
          renderOpenTrades();
          renderClosedTrades();
          renderSummary();
        });
      });
    });

    tbody.querySelectorAll('.st-delete-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this trade entry? This cannot be undone.')) return;
        MEM.data.trades.splice(parseInt(btn.dataset.tradeIdx, 10), 1);
        Store.set(KEYS.trades, MEM.data.trades);
        renderOpenTrades();
        renderSummary();
      });
    });
  }

  // ─── Closed trades render ──────────────────────────────────────────────────

  function fmtHeld(buyTs, sellTs) {
    const totalHours = Math.floor((sellTs - buyTs) / 3600000);
    const days  = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${hours}h`;
  }

  function roiTier(roi) {
    if (roi < 0)  return { bg: 'rgba(255,60,60,0.10)',   color: '#ff4444', label: '' };
    if (roi < 3)  return { bg: '',                        color: '#c0d0c8', label: '' };
    if (roi < 8)  return { bg: 'rgba(0,255,136,0.06)',   color: '#00ff88', label: '' };
    if (roi < 15) return { bg: 'rgba(0,255,136,0.12)',   color: '#00ff88', label: '' };
    return        { bg: 'rgba(0,255,136,0.20)',           color: '#00ff88', label: 'STRONG' };
  }

  function renderClosedTrades() {
    const tbody = panel.querySelector('#st-closed-trades-body');
    const closed = MEM.data.trades
      .map((t, i) => ({ ...t, _idx: i }))
      .filter(t => t.sellPrice !== null);
    if (!closed.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8aa898;padding:12px 8px">No closed trades</td></tr>';
      return;
    }
    tbody.innerHTML = closed.map(t => {
      const profit = (t.sellPrice - t.buyPrice) * t.qty;
      const roi    = ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100;
      const held   = fmtHeld(t.buyDate, t.sellDate);
      const tier   = roiTier(roi);
      const numStyle  = `color:${tier.color}`;
      const roiLabel  = tier.label
        ? `${roi.toFixed(1)}% <span style="font-size:10px;letter-spacing:0.05em">${tier.label}</span>`
        : roi.toFixed(1) + '%';
      return `
        <tr style="${tier.bg ? 'background:' + tier.bg : ''}">
          <td>${t.name}</td>
          <td>${t.qty}</td>
          <td>${fmtMoney(t.buyPrice)}</td>
          <td>${fmtMoney(t.sellPrice)}</td>
          <td style="${numStyle}">${fmtMoney(profit)}</td>
          <td style="${numStyle}">${roiLabel}</td>
          <td>${held}</td>
          <td><button class="st-delete-trade-btn st-btn st-btn-danger" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px" title="Delete this trade">✕</button></td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.st-delete-trade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this closed trade? This cannot be undone.')) return;
        MEM.data.trades.splice(parseInt(btn.dataset.tradeIdx, 10), 1);
        Store.set(KEYS.trades, MEM.data.trades);
        renderClosedTrades();
        renderSummary();
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
    const weightedRoi = closedCost > 0 ? (profit / closedCost) * 100 : null;
    const wins    = closed.filter(t => t.sellPrice > t.buyPrice).length;
    const winRate = closed.length ? (wins / closed.length * 100).toFixed(0) + '%' : null;

    const aggr = MEM.data.settings.aggressiveness ?? 'moderate';

    // Unrealized P&L for open trades that have a known sell target
    let liveEst = null;
    for (const t of open) {
      const { bazaarAverage, marketValue } = PriceDataModule.getItemData(t.itemId);
      const sellTarget = SellTargetEngine(bazaarAverage, marketValue, aggr);
      if (sellTarget != null) liveEst = (liveEst ?? 0) + (sellTarget - t.buyPrice) * t.qty;
    }

    // Capital in open positions where expected sale value >= mug threshold
    const atRisk = open.reduce((s, t) => {
      const { bazaarAverage, marketValue } = PriceDataModule.getItemData(t.itemId);
      const sellTarget = SellTargetEngine(bazaarAverage, marketValue, aggr);
      return (sellTarget != null && sellTarget * t.qty >= MUG_THRESHOLD)
        ? s + t.buyPrice * t.qty : s;
    }, 0);

    const atRiskEl  = panel.querySelector('#st-sum-atrisk');
    const liveEstEl = panel.querySelector('#st-sum-liveest');

    panel.querySelector('#st-sum-invested').textContent = fmtMoney(invested);
    atRiskEl.textContent  = atRisk > 0 ? fmtMoney(atRisk) : '—';
    atRiskEl.style.color  = atRisk > 0 ? '#e8a838' : '';
    liveEstEl.textContent = liveEst != null ? fmtMoney(liveEst) : '—';
    liveEstEl.style.color = liveEst == null ? '' : liveEst >= 0 ? '#4caf50' : '#e85c5c';
    panel.querySelector('#st-sum-profit').textContent   = fmtMoney(profit);
    panel.querySelector('#st-sum-roi').textContent      = weightedRoi != null ? weightedRoi.toFixed(1) + '%' : '—';
    panel.querySelector('#st-sum-winrate').textContent  = winRate ?? '—';
    panel.querySelector('#st-sum-trades').textContent   = closed.length;
  }

  // ─── Pending queue strip ──────────────────────────────────────────────────

  function updateQueueBadge() {
    const tabBadge = panel.querySelector('#st-ledger-tab-badge');
    if (!tabBadge) return;
    const count = MEM.ui.pendingQueue.length;
    tabBadge.textContent = count || '';
    tabBadge.style.display = count ? '' : 'none';
  }

  function renderQueueStrip() {
    updateQueueBadge();
    const section = panel.querySelector('#st-queue-section');
    const rowsEl  = panel.querySelector('#st-queue-rows');
    const badge   = panel.querySelector('#st-queue-badge');
    const count   = MEM.ui.pendingQueue.length;

    if (!count) {
      section.style.display = 'none';
      return;
    }
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
      </div>
    `).join('');

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
        renderQueueStrip();
        renderOpenTrades();
        renderSummary();
      });
    });

    rowsEl.querySelectorAll('.st-queue-rm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qi = parseInt(btn.closest('.st-queue-row').dataset.qi, 10);
        MEM.ui.pendingQueue.splice(qi, 1);
        renderQueueStrip();
      });
    });
  }

  panel.querySelector('#st-queue-log-all-btn').addEventListener('click', () => {
    const rows = [...panel.querySelectorAll('#st-queue-rows .st-queue-row')];
    // collect valid entries; iterate in reverse so splices don't shift earlier indices
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
    renderQueueStrip();
    renderOpenTrades();
    renderSummary();
  });

  panel.querySelector('#st-queue-clear-btn').addEventListener('click', () => {
    MEM.ui.pendingQueue.length = 0;
    renderQueueStrip();
  });

  // ─── Log import button ────────────────────────────────────────────────────

  panel.querySelector('#st-import-btn').addEventListener('click', () => {
    const ta     = panel.querySelector('#st-import-textarea');
    const status = panel.querySelector('#st-import-status');
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
        renderQueueStrip();
        renderOpenTrades();
        renderClosedTrades();
        renderSummary();
        fetchApiLogEntries().then(entries => { if (entries.length) importLogEntries(entries); });
      }
    });
  });

  // ─── FAB toggle + drawer state ────────────────────────────────────────────

  function openDrawer() {
    panel.classList.add('st-drawer-open');
    MEM.ui.collapsed = false;
    Store.set(KEYS.collapsed, false);
  }

  function closeDrawer() {
    panel.classList.remove('st-drawer-open');
    MEM.ui.collapsed = true;
    Store.set(KEYS.collapsed, true);
  }

  fab.addEventListener('click', () => {
    if (panel.classList.contains('st-drawer-open')) closeDrawer();
    else openDrawer();
  });

  if (!MEM.ui.collapsed) openDrawer();

  // ─── Drawer handle drag-to-resize ─────────────────────────────────────────

  const drawerHandle = panel.querySelector('#st-drawer-handle');
  let resizing = false;
  let resizeStartY = 0;
  let resizeStartH = 0;

  function startResize(clientY) {
    resizing     = true;
    resizeStartY = clientY;
    resizeStartH = panel.offsetHeight;
    panel.style.transition = 'none';
  }

  function doResize(clientY) {
    if (!resizing) return;
    const delta = resizeStartY - clientY;
    const newH  = Math.min(window.innerHeight * 0.9, Math.max(120, resizeStartH + delta));
    panel.style.height = newH + 'px';
  }

  function endResize() {
    if (resizing) panel.style.transition = '';
    resizing = false;
  }

  drawerHandle.addEventListener('mousedown', e => { startResize(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => { if (resizing) doResize(e.clientY); });
  document.addEventListener('mouseup', endResize);

  drawerHandle.addEventListener('touchstart', e => { startResize(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (resizing) doResize(e.touches[0].clientY); }, { passive: false });
  document.addEventListener('touchend', endResize);

  // ─── Settings inputs ───────────────────────────────────────────────────────

  const inputApiKey = panel.querySelector('#st-input-apikey');
  const clearBtn    = panel.querySelector('#st-clear-btn');

  // show stored key placeholder but not the actual value for security
  if (localStorage.getItem('st_apikey')) inputApiKey.placeholder = '(key saved)';

  inputApiKey.addEventListener('change', () => {
    const val = inputApiKey.value.trim();
    if (val) {
      localStorage.setItem('st_apikey', val);
      inputApiKey.value       = '';
      inputApiKey.placeholder = '(key saved)';
    }
  });

  function updateAggrButtons() {
    const current = MEM.data.settings.aggressiveness ?? 'moderate';
    panel.querySelectorAll('.st-aggr-btn').forEach(btn => {
      btn.classList.toggle('st-aggr-active', btn.dataset.aggr === current);
    });
  }

  panel.querySelectorAll('.st-aggr-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      MEM.data.settings.aggressiveness = btn.dataset.aggr;
      Store.set(KEYS.settings, MEM.data.settings);
      updateAggrButtons();
      renderOpenTrades();
      renderSummary();
    });
  });

  updateAggrButtons();

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all Snipe Tracker data?')) return;
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    MEM.data.settings  = { aggressiveness: 'moderate' };
    MEM.ui.collapsed = false;
    updateAggrButtons();
    openDrawer();
    panel.style.height = '';
    renderOpenTrades();
    renderClosedTrades();
    renderSummary();
  });

  // ─── MutationObserver — real-time imarket snipe detection ────────────────

  function getImarketItemId() {
    // Handles: bazaar.php?step=ItemMarket&ID=206, imarket.php#/p=shop&ID=206,
    //          page.php?sid=ItemMarket#/market/...&itemID=206
    const m = window.location.href.match(/[?&#](?:item)?ID=(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function getImarketItemName(itemId) {
    const heading = document.querySelector('[class*="itemName"], [class*="title"] h4, h4');
    if (heading?.textContent?.trim()) return heading.textContent.trim();
    return `Item #${itemId}`;
  }

  function parseNodePrices(node) {
    const text = node.textContent || '';
    return [...text.matchAll(/\$\s*([\d,]+)/g)]
      .map(m => parseInt(m[1].replace(/,/g, ''), 10))
      .filter(p => p > 10000);
  }

  let _ioMutObs = null;

  function startImarketObserver() {
    if (_ioMutObs) { _ioMutObs.disconnect(); _ioMutObs = null; }

    // Prefer a scoped container over body to limit noise; CSS-modules parent varies by build
    const target = document.querySelector('.item-market, #market-items, .market-items-cont, ul.items-list, .cont-gray.items')
                ?? document.body;

    const buf = [];
    let debounce = null;
    _ioMutObs = new MutationObserver(mutations => {
      for (const m of mutations) m.addedNodes.forEach(n => buf.push(n));
      clearTimeout(debounce);
      debounce = setTimeout(() => { const nodes = buf.splice(0); injectBadgesFromNodes(nodes); injectSellerRowsFromNodes(nodes); maybeInjectRefreshButton(); }, 150);
    });
    _ioMutObs.observe(target, { childList: true, subtree: true });

    window.addEventListener('beforeunload', stopImarketObserver, { once: true });
  }

  function stopImarketObserver() {
    if (_ioMutObs) { _ioMutObs.disconnect(); _ioMutObs = null; }
  }

  const MUG_THRESHOLD = 10_000_000;

  // ─── Export CSV ───────────────────────────────────────────────────────────

  function csvEsc(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  panel.querySelector('#st-export-btn').addEventListener('click', () => {
    const closed = MEM.data.trades.filter(t => t.sellPrice !== null);
    const rows = [
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
    a.href     = url;
    a.download = 'snipe_trades.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  renderQueueStrip();
  renderOpenTrades();
  renderClosedTrades();
  renderSummary();
  fetchApiLogEntries().then(entries => { if (entries.length) importLogEntries(entries); });

  PriceDataModule.init().then(() => { injectBadgesOnAllTiles(); injectBadgesOnAllSellerRows(); maybeInjectRefreshButton(); });

  startImarketObserver();

})();
