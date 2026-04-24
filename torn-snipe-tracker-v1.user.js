// ==UserScript==
// @name         Torn Snipe Tracker
// @namespace    estradarpm-snipe-tracker
// @version      1.10.0
// @description  Bazaar snipe detector and trade ledger for Torn City
// @author       Built for EstradaRPM
// @match        https://www.torn.com/bazaar.php*
// @match        https://www.torn.com/page.php*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-snipe-tracker-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.10.0';
  const API_KEY = '###PDA-APIKEY###';

  // ─── Persistence ──────────────────────────────────────────────────────────

  const KEYS = {
    watchlist: 'st_watchlist',
    settings:  'st_settings',
    collapsed: 'st_collapsed',
    position:  'st_position',
    trades:    'st_trades',
  };

  const Store = {
    get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const SEED_WATCHLIST = [
    { itemId: 206, name: 'Xanax',    fairValue: 850000, threshold: 10 },
    { itemId: 197, name: 'Cannabis', fairValue: 95000,  threshold: 10 },
    { itemId: 198, name: 'Speed',    fairValue: 320000, threshold: 10 },
  ];

  const MEM = {
    watchlist:   Store.get(KEYS.watchlist) ?? SEED_WATCHLIST,
    settings:    Store.get(KEYS.settings)  ?? { interval: 60, threshold: 10 },
    collapsed:   Store.get(KEYS.collapsed) ?? false,
    position:    Store.get(KEYS.position)  ?? null,
    trades:      Store.get(KEYS.trades)    ?? [],
    pollResults: {},   // itemId -> { fairValue, lowestListed, updatedAt } — not persisted
    logBuyIdx:   null, // index of watchlist item currently in the buy form — not persisted
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
      padding: 0;
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
      padding: 14px;
    }
    .st-pane.st-active {
      display: block;
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
        <table class="st-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Fair Value</th>
              <th>Threshold</th>
              <th>Lowest</th>
              <th>Gap %</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="st-watchlist-body"></tbody>
        </table>
        <div class="st-scan-line">Last scan: &mdash;</div>
        <div class="st-btn-row">
          <button id="st-scan-btn" class="st-btn">Scan Now</button>
          <button id="st-add-item-btn" class="st-btn st-btn-blue">+ Add Item</button>
        </div>
        <div id="st-add-form" style="display:none;margin-top:10px;background:#0a1220;border:1px solid #1a2a3a;border-radius:6px;padding:10px 12px">
          <div class="st-settings-row" style="margin-bottom:0">
            <div class="st-field">
              <label>Item ID</label>
              <input id="st-add-itemid" class="st-input" type="number" min="1" placeholder="206" style="width:80px">
            </div>
            <div class="st-field">
              <label>Item name</label>
              <input id="st-add-name" class="st-input" type="text" placeholder="Xanax" style="width:120px">
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
          <tbody>
            <tr>
              <td>Cannabis</td>
              <td>10</td>
              <td>$88,000</td>
              <td>$94,500</td>
              <td class="st-profit">$65,000</td>
              <td class="st-roi">7.4%</td>
              <td>1d 4h</td>
            </tr>
            <tr>
              <td>LSD</td>
              <td>3</td>
              <td>$410,000</td>
              <td>$490,000</td>
              <td class="st-profit">$240,000</td>
              <td class="st-roi">19.5%</td>
              <td>0d 18h</td>
            </tr>
          </tbody>
        </table>

        <div class="st-summary">
          <div class="st-summary-item">
            <span class="st-summary-label">Total Invested</span>
            <span class="st-summary-value">$2,614,000</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Total Profit</span>
            <span class="st-summary-value">$305,000</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Avg ROI</span>
            <span class="st-summary-value">13.5%</span>
          </div>
          <div class="st-summary-item">
            <span class="st-summary-label">Trades</span>
            <span class="st-summary-value">2</span>
          </div>
        </div>

        <div class="st-btn-row">
          <button class="st-btn st-btn-blue" disabled>Export CSV</button>
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
          </div>
        </div>
        <button id="st-clear-btn" class="st-btn st-btn-danger">Clear All Data</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ─── API ──────────────────────────────────────────────────────────────────

  function computeMedian(arr) {
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
  }

  async function fetchItemPrice(item) {
    try {
      const url = `https://api.torn.com/market/${item.itemId}?selections=bazaar&key=${API_KEY}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error.error ?? `API error ${d.error.code}`);
      const prices = (d.bazaar ?? []).map(l => l.cost).sort((a, b) => a - b);
      const sample  = prices.slice(0, 5);  // lowest 3-5 listings
      MEM.pollResults[item.itemId] = {
        fairValue:    computeMedian(sample),
        lowestListed: prices[0] ?? null,
        updatedAt:    Date.now(),
      };
    } catch (err) {
      console.error(`[SnipeTracker] fetchItemPrice failed for itemId ${item.itemId}:`, err.message);
      MEM.pollResults[item.itemId] = { error: true, errorMsg: err.message, updatedAt: Date.now() };
    }
  }

  // ─── Poll loop ────────────────────────────────────────────────────────────

  let pollTimer = null;

  async function runPoll() {
    for (const item of MEM.watchlist) {
      if (!(item.itemId > 0)) continue;
      await fetchItemPrice(item);
    }
    const scanLine = panel.querySelector('.st-scan-line');
    if (scanLine) scanLine.textContent = `Last scan: ${new Date().toLocaleTimeString()}`;
    renderWatchlist();
  }

  function startPollLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(runPoll, MEM.settings.interval * 1000);
  }

  // ─── Watchlist render ──────────────────────────────────────────────────────

  function renderWatchlist() {
    const tbody = panel.querySelector('#st-watchlist-body');
    if (MEM.watchlist.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8aa898;padding:16px 8px">No items — click + Add Item to start</td></tr>';
      return;
    }
    tbody.innerHTML = MEM.watchlist.map((item, i) => {
      const res = MEM.pollResults[item.itemId];
      let fairValCell, lowestCell, gapCell, statusCell, snipe = false;

      if (!res) {
        fairValCell = '—';
        lowestCell  = '—';
        gapCell     = '—';
        statusCell  = '<span class="st-status-watch">watch</span>';
      } else if (res.error) {
        fairValCell = '—';
        lowestCell  = '—';
        gapCell     = '—';
        statusCell  = '<span class="st-status-error">API error</span>';
      } else {
        const fv  = res.fairValue;
        const low = res.lowestListed;
        fairValCell = fv  != null ? '$' + fv.toLocaleString()  : '—';
        lowestCell  = low != null ? '$' + low.toLocaleString() : '—';
        if (fv != null && low != null) {
          const gap = (fv - low) / fv * 100;
          snipe     = low < fv * (1 - item.threshold / 100);
          gapCell   = gap.toFixed(1) + '%';
          statusCell = snipe
            ? '<span class="st-status-snipe">SNIPE</span>'
            : '<span class="st-status-watch">watch</span>';
        } else {
          gapCell    = '—';
          statusCell = '<span class="st-status-watch">watch</span>';
        }
      }

      const logBuyBtn = snipe
        ? `<button class="st-log-buy-btn st-btn" data-idx="${i}" style="font-size:11px;padding:3px 8px;margin-right:4px">Log Buy</button>`
        : '';

      return `
        <tr>
          <td>${item.name}</td>
          <td>${fairValCell}</td>
          <td>${item.threshold}%</td>
          <td>${lowestCell}</td>
          <td>${gapCell}</td>
          <td>${statusCell}</td>
          <td>${logBuyBtn}<button class="st-rm-btn" data-idx="${i}" title="Remove item">✕</button></td>
        </tr>
      `;
    }).join('');
    tbody.querySelectorAll('.st-rm-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        MEM.watchlist.splice(parseInt(btn.dataset.idx, 10), 1);
        Store.set(KEYS.watchlist, MEM.watchlist);
        renderWatchlist();
      });
    });
    tbody.querySelectorAll('.st-log-buy-btn').forEach(btn => {
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
  }

  // ─── Add Item form ─────────────────────────────────────────────────────────

  const addItemBtn     = panel.querySelector('#st-add-item-btn');
  const addForm        = panel.querySelector('#st-add-form');
  const addItemId      = panel.querySelector('#st-add-itemid');
  const addName        = panel.querySelector('#st-add-name');
  const addThresh      = panel.querySelector('#st-add-threshold');
  const addConfirmBtn  = panel.querySelector('#st-add-confirm-btn');
  const addCancelBtn   = panel.querySelector('#st-add-cancel-btn');

  function hideAddForm() {
    addForm.style.display = 'none';
    addItemId.value = '';
    addName.value   = '';
  }

  addItemBtn.addEventListener('click', () => {
    const opening = addForm.style.display === 'none';
    if (opening) {
      addThresh.value = MEM.settings.threshold;
      addForm.style.display = 'block';
      addName.focus();
    } else {
      hideAddForm();
    }
  });

  addCancelBtn.addEventListener('click', hideAddForm);

  addConfirmBtn.addEventListener('click', () => {
    const itemId    = parseInt(addItemId.value, 10);
    const name      = addName.value.trim();
    const threshold = Math.min(100, Math.max(1, parseInt(addThresh.value, 10) || MEM.settings.threshold));
    if (!(itemId > 0) || !name) return;
    MEM.watchlist.push({ itemId, name, threshold });
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

  // ─── Open trades render ────────────────────────────────────────────────────

  function renderOpenTrades() {
    const tbody = panel.querySelector('#st-open-trades-body');
    const open = MEM.trades.filter(t => t.sellPrice === null);
    if (!open.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#8aa898;padding:12px 8px">No open trades</td></tr>';
      return;
    }
    tbody.innerHTML = open.map(t => `
      <tr>
        <td>${fmtDate(t.buyDate)}</td>
        <td>${t.name}</td>
        <td>${t.qty}</td>
        <td>${fmtMoney(t.buyPrice)}</td>
        <td>${fmtMoney(t.buyPrice * t.qty)}</td>
      </tr>
    `).join('');
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  panel.querySelectorAll('.st-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.st-tab').forEach(t => t.classList.remove('st-active'));
      panel.querySelectorAll('.st-pane').forEach(p => p.classList.remove('st-active'));
      tab.classList.add('st-active');
      panel.querySelector(`#st-pane-${tab.dataset.tab}`).classList.add('st-active');
      if (tab.dataset.tab === 'ledger') renderOpenTrades();
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
  let dragging = false;
  let dragOffX = 0;
  let dragOffY = 0;

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
    let x = e.clientX - dragOffX;
    let y = e.clientY - dragOffY;
    const maxX = window.innerWidth  - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = x + 'px';
    panel.style.top    = y + 'px';
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
    let x = touch.clientX - dragOffX;
    let y = touch.clientY - dragOffY;
    const maxX = window.innerWidth  - panel.offsetWidth;
    const maxY = window.innerHeight - panel.offsetHeight;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = x + 'px';
    panel.style.top    = y + 'px';
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (dragging) {
      MEM.position = { left: panel.style.left, top: panel.style.top };
      Store.set(KEYS.position, MEM.position);
    }
    dragging = false;
  });

  // ─── Settings inputs ───────────────────────────────────────────────────────

  const inputInterval  = panel.querySelector('#st-input-interval');
  const inputThreshold = panel.querySelector('#st-input-threshold');
  const clearBtn       = panel.querySelector('#st-clear-btn');

  inputInterval.value  = MEM.settings.interval;
  inputThreshold.value = MEM.settings.threshold;

  inputInterval.addEventListener('change', () => {
    MEM.settings.interval = Math.max(10, parseInt(inputInterval.value, 10) || 60);
    inputInterval.value = MEM.settings.interval;
    Store.set(KEYS.settings, MEM.settings);
    startPollLoop();
  });

  inputThreshold.addEventListener('change', () => {
    MEM.settings.threshold = Math.min(100, Math.max(1, parseInt(inputThreshold.value, 10) || 10));
    inputThreshold.value = MEM.settings.threshold;
    Store.set(KEYS.settings, MEM.settings);
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all Snipe Tracker data?')) return;
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    MEM.watchlist = [...SEED_WATCHLIST];
    MEM.settings  = { interval: 60, threshold: 10 };
    MEM.collapsed = false;
    MEM.position  = null;
    inputInterval.value  = MEM.settings.interval;
    inputThreshold.value = MEM.settings.threshold;
    panel.classList.remove('st-collapsed');
    collapseBtn.textContent = '−';
    panel.style.left   = 'auto';
    panel.style.right  = '18px';
    panel.style.top    = 'auto';
    panel.style.bottom = '18px';
    renderWatchlist();
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  panel.querySelector('#st-scan-btn').addEventListener('click', runPoll);

  runPoll();
  startPollLoop();

})();
