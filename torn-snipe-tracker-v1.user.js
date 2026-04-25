// ==UserScript==
// @name         Torn Snipe Tracker
// @namespace    estradarpm-snipe-tracker
// @version      1.30.1
// @description  Bazaar snipe detector and trade ledger for Torn City
// @author       Built for EstradaRPM
// @match        https://www.torn.com/bazaar.php*
// @match        https://www.torn.com/market.php*
// @match        https://www.torn.com/imarket.php*
// @match        https://www.torn.com/trade.php*
// @match        https://www.torn.com/page.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ALLOWED_PATHS = ['/market', '/bazaar', '/imarket', '/trade', 'ItemMarket'];
  if (!ALLOWED_PATHS.some(p => window.location.href.includes(p))) return;
  if (document.getElementById('st-panel')) return;

  if (window.__stPollTimer) {
    clearInterval(window.__stPollTimer);
    window.__stPollTimer = null;
  }

  const SCRIPT_VERSION = '1.30.1';
  const API_KEY = '###PDA-APIKEY###';

  // Prefer PDA-injected key; fall back to manually stored key
  function getApiKey() {
    if (API_KEY !== '###PDA-APIKEY###') return API_KEY;
    return localStorage.getItem('st_apikey') ?? '';
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  const KEYS = {
    watchlist: 'st_watchlist',
    settings:  'st_settings',
    collapsed: 'st_collapsed',
    position:  'st_position',
    trades:    'st_trades',
    apiKey:    'st_apikey',
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

  const SEED_WATCHLIST = [
    { itemId: 206, name: 'Xanax',    fairValue: 850000, threshold: 10 },
    { itemId: 197, name: 'Cannabis', fairValue: 95000,  threshold: 10 },
    { itemId: 198, name: 'Speed',    fairValue: 320000, threshold: 10 },
  ];

  const MEM = {
    watchlist:   Store.get(KEYS.watchlist) ?? SEED_WATCHLIST,
    settings:    Store.get(KEYS.settings)  ?? { interval: 60, threshold: 10, availableCapital: 0 },
    collapsed:   Store.get(KEYS.collapsed) ?? false,
    position:    Store.get(KEYS.position)  ?? null,
    trades:      Store.get(KEYS.trades)    ?? [],
    snapshots:        Store.get(KEYS.snapshots)   ?? {},
    trendCache:       Store.get(KEYS.trendcache)  ?? {},
    pollResults:      {},   // itemId -> { fairValue, lowestListed, … } — not persisted
    bookExpanded:     {},   // itemId -> bool — not persisted
    logBuyIdx:        null,
    storageWarnShown: false,
  };

  // ─── Styles ───────────────────────────────────────────────────────────────

  const style = document.createElement('style');
  style.textContent = `
    #st-panel {
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 999999;
      width: 520px;
      max-width: calc(100vw - 24px);
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: #080e18;
      border: 1px solid #1a2a3a;
      border-radius: 8px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.7);
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 14px;
      color: #c0d0c8;
      user-select: none;
    }

    /* ── Header ── */
    #st-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0c1622;
      border-radius: 8px 8px 0 0;
      cursor: grab;
      border-bottom: 1px solid #1a2a3a;
    }
    #st-header:active { cursor: grabbing; }

    #st-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #00ff88;
      text-transform: uppercase;
      text-shadow: 0 0 12px rgba(0,255,136,0.5);
    }

    #st-collapse-btn {
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
    #st-collapse-btn:hover {
      border-color: #00ff88;
      color: #00ff88;
    }

    /* ── Body ── */
    #st-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      flex: 1;
    }
    #st-panel.st-collapsed #st-body {
      display: none;
    }
    #st-panel.st-collapsed {
      border-radius: 8px;
    }
    #st-panel.st-collapsed #st-header {
      border-bottom: none;
      border-radius: 8px;
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
    .st-status-watch {
      color: #7a9888;
      font-size: 12px;
      letter-spacing: 0.04em;
    }
    .st-status-error {
      color: #ff4444;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.04em;
    }

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

    /* ── Scan line ── */
    .st-scan-line {
      font-size: 12px;
      color: #8aa898;
      margin-top: 10px;
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

    .st-rm-btn {
      background: none;
      border: none;
      color: #4a6070;
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
      transition: color 0.15s;
    }
    .st-rm-btn:hover { color: #ff4444; }

    .st-btn-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    /* ── Settings ── */
    .st-settings {
      flex-shrink: 0;
      border-top: 1px solid #1a2a3a;
      padding: 12px 14px 14px;
      background: #070c14;
      border-radius: 0 0 8px 8px;
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

    /* ── Mobile adjustments ── */
    /* ── Search dropdown ── */
    #st-add-dropdown .st-dd-item {
      padding: 7px 10px;
      font-size: 13px;
      color: #c0d0c8;
      cursor: pointer;
      border-bottom: 1px solid #0f1e2e;
    }
    #st-add-dropdown .st-dd-item:last-child { border-bottom: none; }
    #st-add-dropdown .st-dd-item:hover {
      background: rgba(0,255,136,0.08);
      color: #00ff88;
    }
    #st-add-dropdown .st-dd-empty {
      padding: 7px 10px;
      font-size: 12px;
      color: #8aa898;
    }

    /* ── Watchlist card layout ── */
    #st-watchlist-cards {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .st-card {
      background: #080e18;
      border: 1px solid #1a2a3a;
      border-radius: 6px;
      overflow: hidden;
    }
    .st-card-disabled {
      opacity: 0.4;
    }
    .st-card-r1 {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      background: #0c1622;
      border-bottom: 1px solid #1a2a3a;
    }
    .st-card-name {
      flex: 1;
      font-weight: 700;
      font-size: 13px;
      color: #d0e0d8;
    }
    .st-card-trend-badge {
      font-size: 11px;
    }
    .st-card-r2, .st-card-r3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      border-bottom: 1px solid #0f1e2e;
    }
    .st-card-col {
      padding: 5px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-right: 1px solid #0f1e2e;
    }
    .st-card-col:last-child {
      border-right: none;
    }
    .st-card-lbl {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3a5060;
    }
    .st-card-val {
      font-size: 12px;
      color: #c0d0c8;
    }
    .st-card-book-toggle {
      width: 100%;
      background: none;
      border: none;
      border-bottom: 1px solid #0f1e2e;
      padding: 5px 10px;
      text-align: left;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #3a5060;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      font-family: inherit;
    }
    .st-card-book-toggle:hover {
      color: #00ccff;
      background: rgba(0,204,255,0.04);
    }
    .st-card-book-content {
      background: #05080f;
      border-bottom: 1px solid #0f1e2e;
    }
    .st-card-proj {
      border-bottom: 1px solid #0f1e2e;
    }
    .st-card-log-buy {
      padding: 6px 10px;
      border-bottom: 1px solid #0f1e2e;
      background: #07100a;
    }
    .st-card-r6 {
      display: flex;
      align-items: center;
      padding: 5px 10px;
      gap: 8px;
      background: #070c14;
    }
    .st-card-snap-info {
      flex: 1;
      font-size: 10px;
      color: #3a5060;
      letter-spacing: 0.02em;
    }

    @media (max-width: 560px) {
      #st-panel {
        width: calc(100vw - 24px);
        right: 12px;
        bottom: 12px;
      }
      .st-table th,
      .st-table td {
        padding: 5px 5px;
        font-size: 12px;
      }
    }
  `;
  document.head.appendChild(style);

  // ─── HTML ──────────────────────────────────────────────────────────────────

  const panel = document.createElement('div');
  panel.id = 'st-panel';
  panel.innerHTML = `
    <div id="st-header">
      <span id="st-title">Snipe Tracker v${SCRIPT_VERSION}</span>
      <button id="st-collapse-btn" title="Toggle panel">&minus;</button>
    </div>

    <div id="st-body">
      <!-- Tabs -->
      <div id="st-tabs">
        <div class="st-tab st-active" data-tab="snipe">Snipe</div>
        <div class="st-tab" data-tab="ledger">Ledger</div>
      </div>

      <!-- ── SNIPE pane ── -->
      <div id="st-pane-snipe" class="st-pane st-active">
        <div id="st-watchlist-cards"></div>
        <div class="st-scan-line" style="margin-top:10px">Last scan: &mdash;</div>
        <div class="st-btn-row">
          <button id="st-scan-btn" class="st-btn">Scan Now</button>
          <button id="st-add-item-btn" class="st-btn st-btn-blue">+ Add Item</button>
        </div>
        <div id="st-add-form" style="display:none;margin-top:10px;background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:10px 12px">
          <div class="st-settings-row" style="margin-bottom:0;align-items:flex-start">
            <div class="st-field" style="position:relative">
              <label>Search item name</label>
              <input id="st-add-search" class="st-input" type="text" placeholder="e.g. Xanax" autocomplete="off" style="width:180px">
              <div id="st-add-dropdown" style="display:none;position:absolute;top:100%;left:0;width:220px;background:#0c1622;border:1px solid #1a2a3a;border-radius:0 0 4px 4px;z-index:10;max-height:200px;overflow-y:auto"></div>
            </div>
            <div class="st-field">
              <label>Threshold %</label>
              <input id="st-add-threshold" class="st-input" type="number" min="1" max="100" style="width:80px">
            </div>
          </div>
          <div class="st-btn-row" style="margin-top:8px">
            <button id="st-add-confirm-btn" class="st-btn">Add</button>
            <button id="st-add-cancel-btn" class="st-btn st-btn-danger">Cancel</button>
          </div>
          <div id="st-add-error" style="display:none;color:#ff4444;font-size:12px;margin-top:6px"></div>
        </div>
        <div id="st-buy-form" style="display:none;margin-top:10px;background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:10px 12px">
          <div class="st-settings-row" style="margin-bottom:0">
            <div class="st-field">
              <label>Item</label>
              <span id="st-buy-item-name" style="font-size:13px;color:#c0d0c8"></span>
            </div>
            <div class="st-field">
              <label>Qty</label>
              <input id="st-buy-qty" class="st-input" type="number" min="1" style="width:80px">
            </div>
            <div class="st-field">
              <label>Buy price / unit ($)</label>
              <input id="st-buy-price" class="st-input" type="number" min="1">
            </div>
          </div>
          <div class="st-btn-row" style="margin-top:8px">
            <button id="st-buy-confirm-btn" class="st-btn">Confirm</button>
            <button id="st-buy-cancel-btn" class="st-btn st-btn-danger">Cancel</button>
          </div>
        </div>
        <div id="st-capital-bar" style="margin-top:10px"></div>
      </div>

      <!-- ── LEDGER pane ── -->
      <div id="st-pane-ledger" class="st-pane">

        <div class="st-section-label">Open Trades</div>
        <table class="st-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Buy Price</th>
              <th>Total</th>
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
            </tr>
          </thead>
          <tbody id="st-closed-trades-body"></tbody>
        </table>

        <div class="st-summary">
          <div class="st-summary-item">
            <span class="st-summary-label">Total Invested</span>
            <span class="st-summary-value" id="st-sum-invested">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Total Profit</span>
            <span class="st-summary-value" id="st-sum-profit">—</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Avg ROI</span>
            <span class="st-summary-value" id="st-sum-roi">—</span>
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

      <!-- ── Settings ── -->
      <div class="st-settings">
        <div class="st-settings-title">Settings</div>
        <div class="st-settings-row">
          <div class="st-field">
            <label for="st-input-interval">Scan interval (sec)</label>
            <input id="st-input-interval" class="st-input" type="number" min="10">
          </div>
          <div class="st-field">
            <label for="st-input-threshold">Default threshold %</label>
            <input id="st-input-threshold" class="st-input" type="number" min="1" max="100">
            <span id="st-thresh-hint" style="font-size:11px;color:#8aa898;margin-top:3px">—</span>
          </div>
          <div class="st-field">
            <label for="st-input-capital">Available Capital ($)</label>
            <input id="st-input-capital" class="st-input" type="number" min="0" style="width:130px">
          </div>
        </div>
        <div class="st-field" style="margin-bottom:10px">
          <label for="st-input-apikey">API Key <span style="font-weight:400;color:#4a6070">(only needed if not auto-injected by Torn PDA)</span></label>
          <input id="st-input-apikey" class="st-input" type="password" placeholder="paste key here" style="width:240px">
        </div>
        <button id="st-clear-btn" class="st-btn st-btn-danger">Clear All Data</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

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

  function computeMedian(arr) {
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
  }

  function showStorageWarning() {
    if (MEM.storageWarnShown) return;
    MEM.storageWarnShown = true;
    const warn = document.createElement('div');
    warn.id = 'st-storage-warn';
    warn.style.cssText = 'background:#1a0800;border-bottom:1px solid #ff6600;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#ff9944;line-height:1.4';
    warn.innerHTML = `
      <span>Storage limit approaching — consider reducing watchlist size or snapshot retention period.</span>
      <button style="background:none;border:none;color:#ff9944;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;flex-shrink:0" id="st-storage-warn-dismiss">✕</button>
    `;
    const tabs = panel.querySelector('#st-tabs');
    tabs.parentNode.insertBefore(warn, tabs);
    panel.querySelector('#st-storage-warn-dismiss').addEventListener('click', () => warn.remove());
  }

  // ─── Trend calculation ────────────────────────────────────────────────────

  function calculateTrend(itemId) {
    const TREND_BAND_PCT    = 0.005;           // 0.5% of current price per hour; tune here
    const MIN_TIMESPAN_MS   = 2 * 60 * 60 * 1000; // 2 hours minimum span; tune here

    const snaps = MEM.snapshots[itemId] ?? [];
    if (snaps.length < 6) {
      return { trend: 'insufficient', slopePerHour: null, dataPoints: snaps.length, oldestSnapshot: null, newestSnapshot: null };
    }

    // Lowest listed price per snapshot; skip snapshots that have no listings
    const points = snaps
      .map(s => {
        const prices = (s.listings ?? []).map(l => l.price).filter(p => p > 0);
        return prices.length ? { t: s.timestamp, price: Math.min(...prices) } : null;
      })
      .filter(Boolean);

    if (points.length < 6) {
      return { trend: 'insufficient', slopePerHour: null, dataPoints: points.length, oldestSnapshot: snaps[0].timestamp, newestSnapshot: snaps[snaps.length - 1].timestamp };
    }

    const oldestSnapshot = points[0].t;
    const newestSnapshot = points[points.length - 1].t;
    const n              = points.length;

    if (newestSnapshot - oldestSnapshot < MIN_TIMESPAN_MS) {
      return { trend: 'insufficient', slopePerHour: null, dataPoints: n, oldestSnapshot, newestSnapshot };
    }

    // Timestamps in hours relative to oldest point (numerical stability)
    const xs = points.map(p => (p.t - oldestSnapshot) / 3600000);
    const ys = points.map(p => p.price);

    const sumX  = xs.reduce((a, v) => a + v, 0);
    const sumY  = ys.reduce((a, v) => a + v, 0);
    const sumXY = xs.reduce((a, v, i) => a + v * ys[i], 0);
    const sumX2 = xs.reduce((a, v) => a + v * v, 0);

    const denom       = n * sumX2 - sumX * sumX;
    const slopePerHour = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;

    // Band threshold relative to most recent observed price
    const currentPrice = ys[ys.length - 1];
    const band = TREND_BAND_PCT * currentPrice;

    let trend;
    if (slopePerHour > band)       trend = 'rising';
    else if (slopePerHour < -band) trend = 'falling';
    else                           trend = 'flat';

    return { trend, slopePerHour, dataPoints: n, oldestSnapshot, newestSnapshot };
  }

  async function fetchItemPrice(item) {
    const key = getApiKey();
    const url = `https://api.torn.com/market/${item.itemId}?selections=bazaar,itemmarket&key=${key}`;
    console.log(`[SnipeTracker] fetch → market/${item.itemId}?selections=bazaar,itemmarket`);
    try {
      const text = await gmFetch(url);
      const d    = JSON.parse(text);
      console.log(`[SnipeTracker] raw response itemId=${item.itemId}:`, JSON.stringify(d));
      // Step 1: raw response logged — no parsing yet
    } catch (err) {
      console.error(`[SnipeTracker] fetchItemPrice failed for itemId ${item.itemId}:`, err.message);
      MEM.pollResults[item.itemId] = { error: true, errorMsg: err.message, updatedAt: Date.now() };
    }
  }

  // ─── Poll loop ────────────────────────────────────────────────────────────

  let pollTimer = null;

  async function runPoll() {
    const scanLine = panel.querySelector('.st-scan-line');
    if (!getApiKey()) {
      console.warn('[SnipeTracker] No API key available — enter one in Settings.');
      if (scanLine) scanLine.textContent = 'Error: no API key — paste one in Settings below';
      renderWatchlist();
      return;
    }
    for (const item of MEM.watchlist) {
      if (!(item.itemId > 0) || item.enabled === false) continue;
      await fetchItemPrice(item);
      renderWatchlist(); // clear error state immediately on per-item success
    }
    if (scanLine) scanLine.textContent = `Last scan: ${new Date().toLocaleTimeString()}`;
  }

  function startPollLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(runPoll, MEM.settings.interval * 1000);
    window.__stPollTimer = pollTimer;
  }

  // ─── Watchlist render ──────────────────────────────────────────────────────

  function renderTrendCell(itemId) {
    const cache     = MEM.trendCache[itemId];
    const snapCount = (MEM.snapshots[itemId] ?? []).length;
    const ageText   = cache ? 'updated ' + fmtAgo(cache.calculatedAt) : 'pending';
    const ageLine   = `<br><span class="st-trend-age">${ageText}</span>`;

    let signal;
    if (!cache || cache.trend === 'insufficient') {
      signal = `<span class="st-trend-dim">… building history · ${snapCount} snapshot${snapCount === 1 ? '' : 's'}</span>`;
    } else {
      const { trend, slopePerHour } = cache;
      if (trend === 'rising') {
        const s = '+$' + Math.round(slopePerHour).toLocaleString() + '/hr';
        signal = `<span class="st-trend-rising">▲ Rising <span style="font-size:11px">${s}</span></span>`;
      } else if (trend === 'falling') {
        const s = '-$' + Math.abs(Math.round(slopePerHour)).toLocaleString() + '/hr';
        signal = `<span class="st-trend-falling">▼ Falling <span style="font-size:11px">${s}</span></span>`;
      } else {
        signal = `<span class="st-trend-flat">→ stable</span>`;
      }
    }
    return signal + ageLine + renderSparkline(itemId);
  }

  function renderSparkline(itemId) {
    const snaps = MEM.snapshots[itemId] ?? [];
    const prices = snaps
      .map(s => {
        const p = (s.listings ?? []).map(l => l.price).filter(v => v > 0);
        return p.length ? Math.min(...p) : null;
      })
      .filter(v => v !== null);

    if (prices.length < 2) return '';

    const W = 80, H = 24;
    const min   = Math.min(...prices);
    const max   = Math.max(...prices);
    const range = max - min || 1;
    const n     = prices.length;

    const cache = MEM.trendCache[itemId];
    const trend = cache?.trend;
    const color = trend === 'rising'  ? '#00ff88'
                : trend === 'falling' ? '#ff4444'
                : '#3a5060';

    const pts = prices.map((p, i) => {
      const x = (i / (n - 1)) * W;
      const y = (H - 2) - ((p - min) / range) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `<svg width="${W}" height="${H}" style="display:block;margin-top:3px"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  function renderCapitalBar() {
    const bar = panel.querySelector('#st-capital-bar');
    if (!bar) return;
    const available = MEM.settings.availableCapital ?? 0;
    if (!available) {
      bar.innerHTML = '<div style="font-size:11px;color:#3a5060;text-align:center;padding:4px 0">Set available capital in settings to enable utilization tracking</div>';
      return;
    }

    let committed = 0;
    for (const item of MEM.watchlist) {
      if (item.enabled === false) continue;
      const res = MEM.pollResults[item.itemId];
      if (!res || res.error) continue;
      const { fairValue, lowestListed, lowestListedQty } = res;
      if (fairValue != null && lowestListed != null && lowestListed < fairValue * (1 - item.threshold / 100) && lowestListedQty > 0) {
        committed += lowestListed * lowestListedQty;
      }
    }

    const remaining   = available - committed;
    const utilPct     = (committed / available * 100).toFixed(1);
    const remColor    = remaining >= 0 ? '#00ff88' : '#ff4444';
    const fmt         = n => '$' + Math.round(n).toLocaleString();

    bar.innerHTML = `
      <div style="background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:8px 12px">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8aa0b0;margin-bottom:6px">Capital</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div class="st-summary-item">
            <span class="st-summary-label">Available</span>
            <span class="st-summary-value" style="font-size:13px">${fmt(available)}</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Committed</span>
            <span class="st-summary-value" style="font-size:13px">${fmt(committed)}</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Remaining</span>
            <span class="st-summary-value" style="font-size:13px;color:${remColor}">${fmt(remaining)}</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Utilization</span>
            <span class="st-summary-value" style="font-size:13px">${utilPct}%</span>
          </div>
        </div>
      </div>`;
  }

  function roiTier(roi) {
    if (roi < 0)  return { bg: 'rgba(255,60,60,0.10)',   color: '#ff4444', label: '' };
    if (roi < 3)  return { bg: '',                        color: '#c0d0c8', label: '' };
    if (roi < 8)  return { bg: 'rgba(0,255,136,0.06)',   color: '#00ff88', label: '' };
    if (roi < 15) return { bg: 'rgba(0,255,136,0.12)',   color: '#00ff88', label: '' };
    return        { bg: 'rgba(0,255,136,0.20)',           color: '#00ff88', label: 'STRONG' };
  }

  function renderProjection(item, res) {
    const snipePrice = res?.lowestListed;
    const snipeQty   = res?.lowestListedQty;
    if (snipePrice == null || !(snipeQty > 0)) return '';

    const sellTarget  = item.manualSellTarget ?? res?.recommendedSellTarget ?? null;
    if (sellTarget == null) return '';

    const totalCost   = snipePrice * snipeQty;
    const grossRev    = sellTarget * snipeQty;
    const grossProfit = grossRev - totalCost;
    const roi         = (grossProfit / totalCost) * 100;
    const fmt         = n => '$' + Math.round(n).toLocaleString();
    const tier        = roiTier(roi);

    const roiLabel = tier.label
      ? `${roi.toFixed(1)}% <span style="font-size:11px;color:#00ff88;text-shadow:0 0 8px rgba(0,255,136,0.6);letter-spacing:0.06em">${tier.label}</span>`
      : roi.toFixed(1) + '%';

    const stats = [
      { label: 'Snipe Price',   value: fmt(snipePrice),           style: '' },
      { label: 'Snipe Qty',     value: snipeQty.toLocaleString(), style: '' },
      { label: 'Total Cost',    value: fmt(totalCost),            style: '' },
      { label: 'Sell Target',   value: fmt(sellTarget),           style: '' },
      { label: 'Gross Revenue', value: fmt(grossRev),             style: '' },
      { label: 'Gross Profit',  value: fmt(grossProfit),          style: `color:${tier.color}` },
      { label: 'ROI %',         value: roiLabel,                  style: `color:${tier.color}` },
    ];

    const statsHtml = stats.map(s => `
      <div class="st-summary-item">
        <span class="st-summary-label">${s.label}</span>
        <span class="st-summary-value" style="font-size:13px;${s.style}">${s.value}</span>
      </div>`).join('');

    return `<div class="st-card-proj" style="${tier.bg ? 'background:' + tier.bg : ''}">
      <div style="padding:8px 12px">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8aa0b0;margin-bottom:6px">Snipe Projection</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${statsHtml}</div>
      </div>
    </div>`;
  }

  function renderOrderBook(item, res) {
    const TH = `style="text-align:left;color:#00ccff;font-size:10px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;padding:5px 8px;border-bottom:1px solid #1a2a3a"`;
    const snaps = MEM.snapshots[item.itemId] ?? [];
    if (!snaps.length) {
      return `<div class="st-card-book-content"><div style="padding:10px 12px;font-size:12px;color:#3a5060">scan required</div></div>`;
    }

    const latestSnap = snaps[snaps.length - 1];
    const listings   = latestSnap.listings ?? [];
    if (!listings.length) {
      return `<div class="st-card-book-content"><div style="padding:10px 12px;font-size:12px;color:#3a5060">no listings in latest scan</div></div>`;
    }

    const byPrice = new Map();
    for (const l of listings) byPrice.set(l.price, (byPrice.get(l.price) ?? 0) + l.quantity);
    let cumQty = 0;
    const tiers = [...byPrice.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([price, qty]) => { cumQty += qty; return { price, qty, cumQty }; });

    const effectiveTarget = item.manualSellTarget ?? res?.recommendedSellTarget ?? null;
    const unitsAhead = effectiveTarget != null
      ? tiers.filter(t => t.price < effectiveTarget).reduce((s, t) => s + t.qty, 0)
      : null;

    const bookRows = tiers.map(t => {
      const isPos    = effectiveTarget != null && t.price === effectiveTarget;
      const rowStyle = isPos ? 'background:rgba(0,204,255,0.07)' : '';
      const posNote  = isPos ? ' <span style="font-size:10px;color:#00ccff;opacity:0.6">← your position</span>' : '';
      return `<tr style="${rowStyle}">
        <td style="padding:3px 8px;font-size:12px;color:#c0d0c8">$${t.price.toLocaleString()}${posNote}</td>
        <td style="padding:3px 8px;font-size:12px;color:#8aa898">${t.qty.toLocaleString()}</td>
        <td style="padding:3px 8px;font-size:12px;color:#6a8070">${t.cumQty.toLocaleString()}</td>
      </tr>`;
    }).join('');

    const aheadNote = unitsAhead != null && unitsAhead > 0
      ? `<div style="font-size:11px;color:#3a5060;padding:4px 8px 6px">${unitsAhead.toLocaleString()} units listed cheaper</div>`
      : '';

    return `<div class="st-card-book-content">
      <div style="max-height:180px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr><th ${TH}>Price</th><th ${TH}>Qty</th><th ${TH}>Cum. Qty</th></tr></thead>
          <tbody>${bookRows}</tbody>
        </table>
      </div>
      ${aheadNote}
    </div>`;
  }

  function renderWatchlist() {
    const container = panel.querySelector('#st-watchlist-cards');
    if (MEM.watchlist.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:#8aa898;padding:16px 8px">No items — click + Add Item to start</div>';
      renderCapitalBar();
      return;
    }

    container.innerHTML = MEM.watchlist.map((item, i) => {
      const res     = MEM.pollResults[item.itemId];
      const enabled = item.enabled !== false;
      let fairValStr, lowestStr, gapStr, statusHtml, snipe = false;

      if (!res) {
        fairValStr = '—'; lowestStr = '—'; gapStr = '—';
        statusHtml = '<span class="st-status-watch">watch</span>';
      } else if (res.error) {
        fairValStr = '—'; lowestStr = '—'; gapStr = '—';
        statusHtml = '<span class="st-status-error">API error</span>';
      } else {
        const fv  = res.fairValue;
        const low = res.lowestListed;
        const outlierNote = res.outlierExcluded
          ? '<br><span style="font-size:10px;color:#3a5060">⚠ outlier excl.</span>'
          : '';
        fairValStr = fv  != null ? '$' + fv.toLocaleString() + outlierNote : '—';
        lowestStr  = low != null ? '$' + low.toLocaleString() : '—';
        if (fv != null && low != null) {
          const gap = (fv - low) / fv * 100;
          snipe     = low < fv * (1 - item.threshold / 100);
          gapStr    = gap.toFixed(1) + '%';
          statusHtml = snipe
            ? '<span class="st-status-snipe">SNIPE</span>'
            : '<span class="st-status-watch">watch</span>';
        } else {
          gapStr     = '—';
          statusHtml = '<span class="st-status-watch">watch</span>';
        }
      }

      // Row 1: trend signal only (no sparkline/age — those go in Row 6)
      const cache = MEM.trendCache[item.itemId];
      let trendSignal;
      if (!cache || cache.trend === 'insufficient') {
        trendSignal = '<span class="st-trend-dim">…</span>';
      } else {
        const { trend, slopePerHour } = cache;
        if (trend === 'rising') {
          const s = '+$' + Math.round(slopePerHour).toLocaleString() + '/hr';
          trendSignal = `<span class="st-trend-rising">▲ <span style="font-size:10px">${s}</span></span>`;
        } else if (trend === 'falling') {
          const s = '-$' + Math.abs(Math.round(slopePerHour)).toLocaleString() + '/hr';
          trendSignal = `<span class="st-trend-falling">▼ <span style="font-size:10px">${s}</span></span>`;
        } else {
          trendSignal = '<span class="st-trend-flat">→ stable</span>';
        }
      }

      // Row 2: threshold annotation under fair value label
      const fvForAnnot    = (res && !res.error) ? res.fairValue : null;
      const snipePriceAnnot = fvForAnnot != null
        ? ' ≤ $' + Math.round(fvForAnnot * (1 - item.threshold / 100)).toLocaleString()
        : '';

      // Row 3: sell target + ROI
      const recTarget  = res?.recommendedSellTarget ?? null;
      const manTarget  = item.manualSellTarget ?? null;
      const isManual   = manTarget != null;
      const showTarget = isManual ? manTarget : recTarget;
      const targetColor  = isManual ? '#00ccff' : '#c0d0c8';
      const targetBorder = isManual ? 'border-color:#004466;' : '';
      const clearBtnHtml = isManual
        ? `<button class="st-sell-target-clear" data-idx="${i}" title="Clear manual override" style="background:none;border:none;color:#4a6070;cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0;transition:color 0.15s" onmouseover="this.style.color='#ff4444'" onmouseout="this.style.color='#4a6070'">✕</button>`
        : '';

      const snipePrice = res?.lowestListed ?? null;
      const roiVal     = (showTarget != null && snipePrice != null && snipePrice > 0)
        ? ((showTarget - snipePrice) / snipePrice * 100)
        : null;
      const tier       = roiVal != null ? roiTier(roiVal) : null;
      const roiStr     = roiVal != null ? roiVal.toFixed(1) + '%' : '—';
      const tierStr    = tier?.label || '—';
      const tierColor  = tier?.color ?? '#c0d0c8';

      // Row 4: order book
      const isExpanded = !!MEM.bookExpanded[item.itemId];
      const expandIcon = isExpanded ? '▼' : '▶';

      // Row 6: snapshot info
      const snaps = MEM.snapshots[item.itemId] ?? [];
      const snapLabel = snaps.length === 0
        ? 'no history yet'
        : `${snaps.length} snapshot${snaps.length === 1 ? '' : 's'} · oldest ${fmtAgo(snaps[0].timestamp)}`;

      return `
        <div class="st-card${enabled ? '' : ' st-card-disabled'}">

          <!-- Row 1: checkbox | name | trend | status | remove -->
          <div class="st-card-r1">
            <input type="checkbox" class="st-toggle-chk" data-idx="${i}" ${enabled ? 'checked' : ''}
                   style="cursor:pointer;accent-color:#00ff88;width:14px;height:14px;flex-shrink:0">
            <span class="st-card-name">${item.name}</span>
            <span class="st-card-trend-badge">${trendSignal}</span>
            <span>${statusHtml}</span>
            <button class="st-rm-btn" data-idx="${i}" title="Remove item"
                    style="background:none;border:none;color:#4a6070;cursor:pointer;font-size:12px;padding:2px 4px;flex-shrink:0;transition:color 0.15s"
                    onmouseover="this.style.color='#ff4444'" onmouseout="this.style.color='#4a6070'">✕</button>
          </div>

          <!-- Row 2: fair value | lowest price | gap % -->
          <div class="st-card-r2">
            <div class="st-card-col">
              <span class="st-card-lbl">Fair Value (${item.threshold}%${snipePriceAnnot})</span>
              <span class="st-card-val">${fairValStr}</span>
            </div>
            <div class="st-card-col">
              <span class="st-card-lbl">Lowest Price</span>
              <span class="st-card-val">${lowestStr}</span>
            </div>
            <div class="st-card-col">
              <span class="st-card-lbl">Gap %</span>
              <span class="st-card-val">${gapStr}</span>
            </div>
          </div>

          <!-- Row 3: sell target | ROI | tier -->
          <div class="st-card-r3">
            <div class="st-card-col">
              <span class="st-card-lbl">Sell Target</span>
              <div style="display:flex;align-items:center;gap:3px">
                <input class="st-sell-target-input st-input" type="number" min="1" data-idx="${i}"
                       ${showTarget != null ? `value="${showTarget}"` : 'placeholder="—"'}
                       style="width:78px;font-size:12px;padding:3px 6px;color:${targetColor};${targetBorder}">
                ${clearBtnHtml}
              </div>
            </div>
            <div class="st-card-col">
              <span class="st-card-lbl">ROI</span>
              <span class="st-card-val" style="color:${tierColor}">${roiStr}</span>
            </div>
            <div class="st-card-col">
              <span class="st-card-lbl">Tier</span>
              <span class="st-card-val" style="color:${tierColor}">${tierStr}</span>
            </div>
          </div>

          <!-- Row 4: order book toggle + content -->
          <button class="st-card-book-toggle st-book-expand-btn" data-itemid="${item.itemId}">
            ${expandIcon} Order Book
          </button>
          ${isExpanded ? renderOrderBook(item, res) : ''}

          <!-- Row 5: projection panel (only when SNIPE) -->
          ${snipe ? renderProjection(item, res) : ''}
          ${snipe ? `<div class="st-card-log-buy"><button class="st-log-buy-btn st-btn" data-idx="${i}" style="font-size:11px;padding:3px 8px">Log Buy</button></div>` : ''}

          <!-- Row 6: snapshot count + sparkline -->
          <div class="st-card-r6">
            <span class="st-card-snap-info">${snapLabel}</span>
            ${renderSparkline(item.itemId)}
          </div>

        </div>
      `;
    }).join('');

    container.querySelectorAll('.st-rm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        MEM.watchlist.splice(parseInt(btn.dataset.idx, 10), 1);
        Store.set(KEYS.watchlist, MEM.watchlist);
        renderWatchlist();
      });
    });
    container.querySelectorAll('.st-log-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        MEM.logBuyIdx = parseInt(btn.dataset.idx, 10);
        const item = MEM.watchlist[MEM.logBuyIdx];
        buyItemName.textContent  = item.name;
        buyPriceInput.value      = MEM.pollResults[item.itemId]?.lowestListed ?? '';
        buyQtyInput.value        = '';
        buyForm.style.display    = 'block';
        buyQtyInput.focus();
      });
    });
    container.querySelectorAll('.st-toggle-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const idx = parseInt(chk.dataset.idx, 10);
        MEM.watchlist[idx].enabled = chk.checked;
        Store.set(KEYS.watchlist, MEM.watchlist);
        renderWatchlist();
      });
    });
    container.querySelectorAll('.st-sell-target-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx, 10);
        const val = parseInt(input.value, 10);
        if (val > 0) {
          MEM.watchlist[idx].manualSellTarget = val;
          Store.set(KEYS.watchlist, MEM.watchlist);
          renderWatchlist();
        }
      });
    });
    container.querySelectorAll('.st-sell-target-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        delete MEM.watchlist[idx].manualSellTarget;
        Store.set(KEYS.watchlist, MEM.watchlist);
        renderWatchlist();
      });
    });
    container.querySelectorAll('.st-book-expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const itemId = parseInt(btn.dataset.itemid, 10);
        MEM.bookExpanded[itemId] = !MEM.bookExpanded[itemId];
        renderWatchlist();
      });
    });
    renderCapitalBar();
  }

  // ─── Add Item form ─────────────────────────────────────────────────────────

  const addItemBtn    = panel.querySelector('#st-add-item-btn');
  const addForm       = panel.querySelector('#st-add-form');
  const addSearch     = panel.querySelector('#st-add-search');
  const addDropdown   = panel.querySelector('#st-add-dropdown');
  const addThresh     = panel.querySelector('#st-add-threshold');
  const addConfirmBtn = panel.querySelector('#st-add-confirm-btn');
  const addCancelBtn  = panel.querySelector('#st-add-cancel-btn');
  const addError      = panel.querySelector('#st-add-error');

  let addSelectedItem = null;  // { itemId, name } populated by dropdown click
  let itemLookupCache = null;  // full item list cached after first fetch
  let searchDebounceT = null;

  function showAddError(msg) {
    addError.textContent    = msg;
    addError.style.display  = 'block';
  }

  function hideAddForm() {
    addForm.style.display     = 'none';
    addSearch.value           = '';
    addDropdown.style.display = 'none';
    addDropdown.innerHTML     = '';
    addError.style.display    = 'none';
    addError.textContent      = '';
    addSelectedItem           = null;
  }

  function renderDropdown(items) {
    if (!items.length) {
      addDropdown.innerHTML = '<div class="st-dd-empty">No matches</div>';
    } else {
      addDropdown.innerHTML = items.slice(0, 8).map(it =>
        `<div class="st-dd-item" data-id="${it.itemId}" data-name="${it.name.replace(/"/g, '&quot;')}">${it.name}</div>`
      ).join('');
      addDropdown.querySelectorAll('.st-dd-item').forEach(el => {
        el.addEventListener('click', () => {
          addSelectedItem       = { itemId: parseInt(el.dataset.id, 10), name: el.dataset.name };
          addSearch.value       = el.dataset.name;
          addDropdown.style.display = 'none';
        });
      });
    }
    addDropdown.style.display = 'block';
  }

  async function fetchItemLookup() {
    if (itemLookupCache) return itemLookupCache;
    try {
      const text = await gmFetch(`https://api.torn.com/torn/?selections=items&key=${getApiKey()}`);
      const d    = JSON.parse(text);
      console.log('[SnipeTracker] fetchItemLookup raw response:', d);
      if (d.error) throw new Error(d.error.error ?? `API error ${d.error.code}`);
      const raw = d.items ?? {};
      itemLookupCache = Object.entries(raw)
        .map(([id, v]) => ({ itemId: parseInt(id, 10), name: v.name }))
        .filter(it => it.itemId && it.name);
      return itemLookupCache;
    } catch (err) {
      console.error('[SnipeTracker] fetchItemLookup failed:', err.message);
      return [];
    }
  }

  addSearch.addEventListener('input', () => {
    clearTimeout(searchDebounceT);
    addSelectedItem        = null;
    addError.style.display = 'none';
    const q = addSearch.value.trim();
    if (!q) {
      addDropdown.style.display = 'none';
      addDropdown.innerHTML     = '';
      return;
    }
    searchDebounceT = setTimeout(async () => {
      const all    = await fetchItemLookup();
      const ql     = q.toLowerCase();
      const matches = all.filter(it => it.name.toLowerCase().includes(ql));
      renderDropdown(matches);
    }, 400);
  });

  document.addEventListener('click', e => {
    if (!addForm.contains(e.target)) addDropdown.style.display = 'none';
  });

  addItemBtn.addEventListener('click', () => {
    const opening = addForm.style.display === 'none';
    if (opening) {
      addThresh.value       = MEM.settings.threshold;
      addForm.style.display = 'block';
      addSearch.focus();
    } else {
      hideAddForm();
    }
  });

  addCancelBtn.addEventListener('click', hideAddForm);

  addConfirmBtn.addEventListener('click', () => {
    addError.style.display = 'none';

    if (!addSelectedItem) {
      showAddError('Select an item from the dropdown first.');
      return;
    }

    const pct = parseInt(addThresh.value, 10);
    if (isNaN(pct) || pct < 1 || pct > 50) {
      showAddError('Threshold must be a number between 1 and 50.');
      return;
    }

    if (MEM.watchlist.some(it => it.itemId === addSelectedItem.itemId)) {
      showAddError(`${addSelectedItem.name} is already on the watchlist.`);
      return;
    }

    MEM.watchlist.push({ itemId: addSelectedItem.itemId, name: addSelectedItem.name, threshold: pct, enabled: true });
    Store.set(KEYS.watchlist, MEM.watchlist);
    renderWatchlist();
    hideAddForm();
  });

  renderWatchlist();

  // ─── Buy form ──────────────────────────────────────────────────────────────

  const buyForm        = panel.querySelector('#st-buy-form');
  const buyItemName    = panel.querySelector('#st-buy-item-name');
  const buyQtyInput    = panel.querySelector('#st-buy-qty');
  const buyPriceInput  = panel.querySelector('#st-buy-price');
  const buyConfirmBtn  = panel.querySelector('#st-buy-confirm-btn');
  const buyCancelBtn   = panel.querySelector('#st-buy-cancel-btn');

  function hideBuyForm() {
    buyForm.style.display = 'none';
    buyQtyInput.value     = '';
    buyPriceInput.value   = '';
    MEM.logBuyIdx         = null;
  }

  buyCancelBtn.addEventListener('click', hideBuyForm);

  buyConfirmBtn.addEventListener('click', () => {
    const qty   = parseInt(buyQtyInput.value, 10);
    const price = parseInt(buyPriceInput.value, 10);
    if (!(qty > 0) || !(price > 0) || MEM.logBuyIdx === null) return;
    const item = MEM.watchlist[MEM.logBuyIdx];
    MEM.trades.push({
      itemId:    item.itemId,
      name:      item.name,
      qty,
      buyPrice:  price,
      buyDate:   Date.now(),
      sellPrice: null,
      sellDate:  null,
    });
    Store.set(KEYS.trades, MEM.trades);
    hideBuyForm();
    renderOpenTrades();
    renderSummary();
  });

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
    const open = MEM.trades
      .map((t, i) => ({ ...t, _idx: i }))
      .filter(t => t.sellPrice === null);
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#8aa898;padding:12px 8px">No open trades</td></tr>';
      return;
    }
    tbody.innerHTML = open.map(t => `
      <tr data-trade-idx="${t._idx}">
        <td>${fmtDate(t.buyDate)}</td>
        <td>${t.name}</td>
        <td>${t.qty}</td>
        <td>${fmtMoney(t.buyPrice)}</td>
        <td>${fmtMoney(t.buyPrice * t.qty)}</td>
        <td><button class="st-log-sell-btn st-btn" data-trade-idx="${t._idx}" style="font-size:11px;padding:3px 8px">Log Sell</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.st-log-sell-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const existing = tbody.querySelector('.st-sell-form-row');
        if (existing) existing.remove();

        const tradeIdx = parseInt(btn.dataset.tradeIdx, 10);
        const parentRow = btn.closest('tr');

        const formRow = document.createElement('tr');
        formRow.className = 'st-sell-form-row';
        formRow.innerHTML = `
          <td colspan="6" style="padding:6px 8px 10px">
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
          MEM.trades[tradeIdx].sellPrice = price;
          MEM.trades[tradeIdx].sellDate  = Date.now();
          Store.set(KEYS.trades, MEM.trades);
          renderOpenTrades();
          renderClosedTrades();
          renderSummary();
        });
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

  function renderClosedTrades() {
    const tbody = panel.querySelector('#st-closed-trades-body');
    const closed = MEM.trades.filter(t => t.sellPrice !== null);
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
        </tr>
      `;
    }).join('');
  }

  // ─── Summary render ───────────────────────────────────────────────────────

  function renderSummary() {
    const open   = MEM.trades.filter(t => t.sellPrice === null);
    const closed = MEM.trades.filter(t => t.sellPrice !== null);

    const invested = open.reduce((s, t) => s + t.buyPrice * t.qty, 0);
    const profit   = closed.reduce((s, t) => s + (t.sellPrice - t.buyPrice) * t.qty, 0);
    const avgRoi   = closed.length
      ? closed.reduce((s, t) => s + ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100, 0) / closed.length
      : null;

    panel.querySelector('#st-sum-invested').textContent = fmtMoney(invested);
    panel.querySelector('#st-sum-profit').textContent   = fmtMoney(profit);
    panel.querySelector('#st-sum-roi').textContent      = avgRoi !== null ? avgRoi.toFixed(1) + '%' : '—';
    panel.querySelector('#st-sum-trades').textContent   = closed.length;
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  panel.querySelectorAll('.st-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.st-tab').forEach(t => t.classList.remove('st-active'));
      panel.querySelectorAll('.st-pane').forEach(p => p.classList.remove('st-active'));
      tab.classList.add('st-active');
      panel.querySelector(`#st-pane-${tab.dataset.tab}`).classList.add('st-active');
      if (tab.dataset.tab === 'ledger') { renderOpenTrades(); renderClosedTrades(); renderSummary(); }
    });
  });

  // ─── Collapse toggle ───────────────────────────────────────────────────────

  const collapseBtn = panel.querySelector('#st-collapse-btn');
  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('st-collapsed');
    collapseBtn.textContent = collapsed ? '+' : '−';
    MEM.collapsed = collapsed;
    Store.set(KEYS.collapsed, MEM.collapsed);
  });

  // ─── Restore panel state ───────────────────────────────────────────────────

  if (MEM.collapsed) {
    panel.classList.add('st-collapsed');
    collapseBtn.textContent = '+';
  }

  if (MEM.position) {
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = MEM.position.left;
    panel.style.top    = MEM.position.top;
  }

  // ─── Drag ─────────────────────────────────────────────────────────────────

  const header = panel.querySelector('#st-header');
  const DRAG_MARGIN = 60;
  let dragging = false;
  let dragOffX = 0;
  let dragOffY = 0;

  function clampPos(x, y) {
    const minX = DRAG_MARGIN - panel.offsetWidth;
    const maxX = window.innerWidth  - DRAG_MARGIN;
    const minY = DRAG_MARGIN - panel.offsetHeight;
    const maxY = window.innerHeight - DRAG_MARGIN;
    return [
      Math.max(minX, Math.min(x, maxX)),
      Math.max(minY, Math.min(y, maxY)),
    ];
  }

  function applyPos(x, y) {
    const [cx, cy] = clampPos(x, y);
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = cx + 'px';
    panel.style.top    = cy + 'px';
  }

  header.addEventListener('mousedown', e => {
    if (e.target === collapseBtn) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    applyPos(e.clientX - dragOffX, e.clientY - dragOffY);
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      MEM.position = { left: panel.style.left, top: panel.style.top };
      Store.set(KEYS.position, MEM.position);
    }
    dragging = false;
  });

  // Touch drag support
  header.addEventListener('touchstart', e => {
    if (e.target === collapseBtn) return;
    const touch = e.touches[0];
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = touch.clientX - rect.left;
    dragOffY = touch.clientY - rect.top;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const touch = e.touches[0];
    applyPos(touch.clientX - dragOffX, touch.clientY - dragOffY);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (dragging) {
      MEM.position = { left: panel.style.left, top: panel.style.top };
      Store.set(KEYS.position, MEM.position);
    }
    dragging = false;
  });

  window.addEventListener('resize', () => {
    if (!MEM.position) return;
    const curX = parseInt(panel.style.left, 10);
    const curY = parseInt(panel.style.top,  10);
    if (!isNaN(curX) && !isNaN(curY)) applyPos(curX, curY);
  });

  // ─── Settings inputs ───────────────────────────────────────────────────────

  const inputInterval  = panel.querySelector('#st-input-interval');
  const inputThreshold = panel.querySelector('#st-input-threshold');
  const threshHint     = panel.querySelector('#st-thresh-hint');
  const inputApiKey    = panel.querySelector('#st-input-apikey');
  const inputCapital   = panel.querySelector('#st-input-capital');
  const clearBtn       = panel.querySelector('#st-clear-btn');

  inputInterval.value  = MEM.settings.interval;
  inputThreshold.value = MEM.settings.threshold;
  inputCapital.value   = MEM.settings.availableCapital ?? 0;
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

  inputInterval.addEventListener('change', () => {
    MEM.settings.interval = Math.max(10, parseInt(inputInterval.value, 10) || 60);
    inputInterval.value = MEM.settings.interval;
    Store.set(KEYS.settings, MEM.settings);
    startPollLoop();
  });

  function updateThreshHint() {
    // Global default has no associated item; always "—"
    threshHint.textContent = '—';
  }

  inputThreshold.addEventListener('input', updateThreshHint);

  inputThreshold.addEventListener('change', () => {
    MEM.settings.threshold = Math.min(100, Math.max(1, parseInt(inputThreshold.value, 10) || 10));
    inputThreshold.value = MEM.settings.threshold;
    Store.set(KEYS.settings, MEM.settings);
  });

  inputCapital.addEventListener('change', () => {
    MEM.settings.availableCapital = Math.max(0, parseInt(inputCapital.value, 10) || 0);
    inputCapital.value = MEM.settings.availableCapital;
    Store.set(KEYS.settings, MEM.settings);
    renderCapitalBar();
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all Snipe Tracker data?')) return;
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    MEM.watchlist = [...SEED_WATCHLIST];
    MEM.settings  = { interval: 60, threshold: 10, availableCapital: 0 };
    MEM.collapsed = false;
    MEM.position  = null;
    inputInterval.value  = MEM.settings.interval;
    inputThreshold.value = MEM.settings.threshold;
    inputCapital.value   = 0;
    panel.classList.remove('st-collapsed');
    collapseBtn.textContent = '−';
    panel.style.left   = 'auto';
    panel.style.right  = '18px';
    panel.style.top    = 'auto';
    panel.style.bottom = '18px';
    renderWatchlist();
  });

  // ─── Export CSV ───────────────────────────────────────────────────────────

  function csvEsc(v) {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  panel.querySelector('#st-export-btn').addEventListener('click', () => {
    const closed = MEM.trades.filter(t => t.sellPrice !== null);
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

  panel.querySelector('#st-scan-btn').addEventListener('click', runPoll);

  runPoll();
  startPollLoop();

})();
