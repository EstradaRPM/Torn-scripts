// ==UserScript==
// @name         Torn Trade Ledger
// @namespace    estradarpm-trade-ledger
// @version      1.4.0
// @description  Unified trade ledger with fee-adjusted P&L, sell alerts, and TornW3B fair value
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      weav3r.dev
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-trade-ledger-v1.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/torn-trade-ledger-v1.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.4.0';
  const API_KEY = '###PDA-APIKEY###';

  // ─── Store ──────────────────────────────────────────────────────────────────
  const Store = {
    get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ─── TradeStore ─────────────────────────────────────────────────────────────
  const TradeStore = {
    list() {
      return Store.get('torn_trades') ?? [];
    },

    _save(trades) {
      Store.set('torn_trades', trades);
    },

    add(record) {
      const trades = this.list();
      if (trades.some(t => t.id === record.id)) return;
      trades.push({ ...record, schemaVersion: 1 });
      this._save(trades);
    },

    update(id, fields) {
      const trades = this.list();
      const idx = trades.findIndex(t => t.id === id);
      if (idx === -1) return;
      trades[idx] = { ...trades[idx], ...fields };
      this._save(trades);
    },

    partialClose(id, sellEvent) {
      const trades = this.list();
      const idx = trades.findIndex(t => t.id === id);
      if (idx === -1) return;
      const t = trades[idx];
      const newRemaining = t.remainingQty - sellEvent.qty;
      trades[idx] = {
        ...t,
        remainingQty: newRemaining,
        sells: [...(t.sells ?? []), sellEvent],
        status: newRemaining <= 0 ? 'closed' : 'partial',
      };
      this._save(trades);
    },

    fullClose(id, sellEvent) {
      const trades = this.list();
      const idx = trades.findIndex(t => t.id === id);
      if (idx === -1) return;
      const t = trades[idx];
      trades[idx] = {
        ...t,
        remainingQty: 0,
        sells: [...(t.sells ?? []), sellEvent],
        status: 'closed',
      };
      this._save(trades);
    },

    getByStatus(...statuses) {
      return this.list().filter(t => statuses.includes(t.status));
    },
  };

  // ─── LogParser ──────────────────────────────────────────────────────────────

  const LogParser = (() => {
    function parseMoney(s) {
      return parseInt(s.replace(/,/g, ''), 10);
    }

    const BUY_PATTERNS = [
      { re: /^You bought (\d+)x (.+?) on \S+'s bazaar at \$([0-9,]+) each/, venue: 'bazaar' },
      { re: /^You bought (\d+)x (.+?) on the item market(?: from \S+)? at \$([0-9,]+) each/, venue: 'item-market' },
      { re: /^You bought (\d+)x (.+?) (?:from|at) the auction(?: house)? at \$([0-9,]+) each/, venue: 'auction' },
    ];

    const SELL_PATTERNS = [
      { re: /^You sold (\d+)x (.+?) on your bazaar(?: to \S+)? at \$([0-9,]+) each/, venue: 'bazaar' },
      { re: /^You sold (\d+)x (.+?) on the item market(?: to \S+)? at \$([0-9,]+) each/, venue: 'item-market' },
      { re: /^You sold (\d+)x (.+?) (?:from|at) the auction(?: house)? at \$([0-9,]+) each/, venue: 'auction' },
    ];

    function parse(entries, patterns, timeKey) {
      if (!Array.isArray(entries)) return [];
      const results = [];
      for (const entry of entries) {
        try {
          const action = entry?.action;
          if (typeof action !== 'string') continue;
          for (const { re, venue } of patterns) {
            const m = action.match(re);
            if (m) {
              results.push({
                itemName: m[2],
                [timeKey === 'openedAt' ? 'buyPrice' : 'price']: parseMoney(m[3]),
                qty: parseInt(m[1], 10),
                [timeKey === 'openedAt' ? 'buyVenue' : 'venue']: venue,
                [timeKey]: (entry.timestamp ?? 0) * 1000,
              });
              break;
            }
          }
        } catch {
          // silently skip malformed entries
        }
      }
      return results;
    }

    return {
      parseBuyCandidates(entries) {
        return parse(entries, BUY_PATTERNS, 'openedAt');
      },
      parseSellEvents(entries) {
        return parse(entries, SELL_PATTERNS, 'closedAt');
      },
    };
  })();

  // ─── LogFetcher ──────────────────────────────────────────────────────────────

  const LogFetcher = {
    fetch() {
      const key = API_KEY !== '###PDA-APIKEY###' ? API_KEY : (Store.get('ldgr_apikey') ?? '');
      if (!key) return Promise.resolve({ entries: [], error: 'No API key configured' });

      return new Promise(resolve => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://api.torn.com/user/?selections=log&key=${key}`,
          onload(resp) {
            let d;
            try { d = JSON.parse(resp.responseText); } catch { return resolve({ entries: [], error: 'Invalid API response' }); }
            if (d.error) {
              if (d.error.code === 2 || d.error.code === 13) {
                Store.set('ldgr_apikey', null);
              }
              return resolve({ entries: [], error: `API error ${d.error.code}: ${d.error.error}` });
            }
            const raw = d.log ?? {};
            const entries = Object.values(raw).map(e => ({
              action: e.title ?? '',
              timestamp: e.timestamp ?? 0,
            }));
            resolve({ entries, error: null });
          },
          onerror() {
            resolve({ entries: [], error: 'Network error' });
          },
        });
      });
    },
  };

  // ─── W3BFetcher ─────────────────────────────────────────────────────────────

  const W3BFetcher = {
    fetch(itemNames) {
      if (!itemNames.length) return Promise.resolve({});
      return new Promise(resolve => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'https://weav3r.dev/api/marketplace',
          onload(resp) {
            try {
              const d = JSON.parse(resp.responseText);
              const allItems = d.items ?? [];
              const nameSet = new Set(itemNames.map(n => n.toLowerCase()));
              const result = {};
              for (const item of allItems) {
                const name = item.item_name;
                if (name && nameSet.has(name.toLowerCase())) {
                  const p50 = item.bazaar_average ?? item.market_price ?? null;
                  if (p50 != null) result[name] = { p50 };
                }
              }
              resolve(result);
            } catch {
              resolve({});
            }
          },
          onerror() { resolve({}); },
        });
      });
    },
  };

  // ─── MigrationRunner ────────────────────────────────────────────────────────
  (function runMigration() {
    if (Store.get('ldgr_migrated')) return;
    const oldTrades = Store.get('st_trades');
    if (!Array.isArray(oldTrades) || !oldTrades.length) {
      Store.set('ldgr_migrated', true);
      return;
    }
    for (const t of oldTrades) {
      const id = `migrated_${t.name}_${t.buyDate}`;
      const isClosed = t.sellPrice != null;
      TradeStore.add({
        id,
        schemaVersion: 1,
        source: 'snipe-tracker',
        itemId: t.itemId ?? null,
        itemName: t.name,
        buyPrice: t.buyPrice,
        qty: t.qty,
        remainingQty: isClosed ? 0 : t.qty,
        buyVenue: 'bazaar',
        sellTarget: null,
        fairValueAtOpen: null,
        floodPlay: false,
        notes: '',
        openedAt: t.buyDate,
        status: isClosed ? 'closed' : 'open',
        sells: isClosed
          ? [{ qty: t.qty, price: t.sellPrice, venue: 'bazaar', closedAt: t.sellDate ?? t.buyDate }]
          : [],
        alertFired: false,
      });
    }
    Store.set('ldgr_migrated', true);
  })();

  // ─── MEM ────────────────────────────────────────────────────────────────────
  const MEM = {
    trades:         [],
    scanResults:    null,
    fairValues:     {},
    fetchError:     null,
    lastW3BPoll:    0,
    panelOpen:      !(Store.get('ldgr_collapsed') ?? true),
    showClosed:     false,
    addFormOpen:    false,
    sellFormOpenId: null,
    addFormErrors:  {},
    sellFormErrors: {},
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function feeRateFor(venue) {
    if (venue === 'bazaar') return 0;
    if (venue === 'item-market') return 0.05;
    if (venue === 'auction') return 0.03;
    return 0;
  }

  function calcPnl(trade) {
    const sells = trade.sells ?? [];
    const totalQtySold = sells.reduce((s, e) => s + e.qty, 0);
    const netSell = sells.reduce((s, e) => s + e.price * e.qty * (1 - feeRateFor(e.venue)), 0);
    return netSell - trade.buyPrice * totalQtySold;
  }

  function deployedCapital(trades) {
    return trades
      .filter(t => t.status === 'open' || t.status === 'partial')
      .reduce((s, t) => s + t.buyPrice * t.remainingQty, 0);
  }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(Math.round(n));
    const sign = n < 0 ? '-' : '';
    return sign + '$' + abs.toLocaleString();
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString();
  }

  function genId() {
    return `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function btnStyle(color) {
    const map = {
      green: 'background:#166534;color:#4ade80;border:1px solid #166534;',
      gray:  'background:#374151;color:#d1d5db;border:1px solid #374151;',
      blue:  'background:#1e3a5f;color:#60a5fa;border:1px solid #1e3a5f;',
    };
    return `cursor:pointer;padding:3px 8px;border-radius:4px;font-size:11px;${map[color] ?? map.gray}`;
  }

  function inputStyle(hasError) {
    const border = hasError ? '#ef4444' : '#334155';
    return `background:#0f172a;color:#e0e0e0;border:1px solid ${border};border-radius:4px;padding:3px 6px;font-size:12px;width:100%;box-sizing:border-box;`;
  }

  function errSpan(msg) {
    return msg ? `<span style="color:#ef4444;font-size:10px;">${msg}</span>` : '';
  }

  // ─── NavIcon ─────────────────────────────────────────────────────────────────

  function injectNavIcon() {
    if (document.getElementById('ldgr-nav-icon')) return;
    const selectors = [
      '.torn-nav--icon-list',
      '#top-page-links-list',
      '.nav-tabs',
      'ul[class*="nav"]',
    ];
    let mount = null;
    for (const sel of selectors) {
      mount = document.querySelector(sel);
      if (mount) break;
    }
    if (!mount) {
      console.warn('[TradeLedger] No nav mount point found');
      return;
    }
    const li = document.createElement('li');
    li.id = 'ldgr-nav-icon';
    li.title = 'Trade Ledger';
    li.style.cssText = 'cursor:pointer;list-style:none;display:inline-flex;align-items:center;padding:4px 8px;font-size:16px;';
    li.textContent = '📒';
    li.addEventListener('click', () => {
      MEM.panelOpen = !MEM.panelOpen;
      Store.set('ldgr_collapsed', !MEM.panelOpen);
      render();
      if (MEM.panelOpen) pollW3B();
    });
    mount.appendChild(li);
  }

  // ─── Panel HTML builders ─────────────────────────────────────────────────────

  function buildKeySection() {
    if (API_KEY !== '###PDA-APIKEY###') return '';
    const storedKey = Store.get('ldgr_apikey');
    if (storedKey) {
      const masked = '●'.repeat(6) + storedKey.slice(-4);
      return `
        <div style="background:#0f172a;border:1px solid #1e3a5f;border-radius:6px;padding:8px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:#94a3b8;">API key: <span style="font-family:monospace;">${masked}</span></span>
          <button id="ldgr-clear-key" style="${btnStyle('gray')}">Clear key</button>
        </div>
      `;
    }
    return `
      <div id="ldgr-key-section" style="background:#0f172a;border:1px solid #1e3a5f;border-radius:6px;padding:12px;margin-bottom:12px;">
        <p style="color:#94a3b8;font-size:11px;margin:0 0 8px;">A Torn API key is required to scan your transaction log.</p>
        <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px;">
          <thead>
            <tr style="color:#64748b;border-bottom:1px solid #1e3a5f;">
              <th style="padding:3px 6px;text-align:left;">Data Storage</th>
              <th style="padding:3px 6px;text-align:left;">Data Sharing</th>
              <th style="padding:3px 6px;text-align:left;">Purpose of Use</th>
              <th style="padding:3px 6px;text-align:left;">Key Storage &amp; Sharing</th>
              <th style="padding:3px 6px;text-align:left;">Key Access Level</th>
            </tr>
          </thead>
          <tbody>
            <tr style="color:#e0e0e0;">
              <td style="padding:3px 6px;">Local only</td>
              <td style="padding:3px 6px;">Nobody</td>
              <td style="padding:3px 6px;">Read transaction log</td>
              <td style="padding:3px 6px;">Not shared</td>
              <td style="padding:3px 6px;">Standard/Full</td>
            </tr>
          </tbody>
        </table>
        <div style="display:flex;gap:8px;align-items:center;">
          <input id="ldgr-key-input" type="password" placeholder="Enter API key" style="${inputStyle(false)};max-width:220px;">
          <button id="ldgr-save-key" style="${btnStyle('blue')}">Save key</button>
        </div>
        <div id="ldgr-key-error" style="color:#ef4444;font-size:10px;margin-top:4px;min-height:14px;"></div>
      </div>
    `;
  }

  function buildAddForm() {
    const e = MEM.addFormErrors;
    return `
      <form id="ldgr-add-form" style="background:#0f172a;border:1px solid #1e3a5f;border-radius:6px;padding:12px;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Item name *</label>
            <input id="af-name" type="text" style="${inputStyle(e.name)}" placeholder="e.g. Xanax">
            ${errSpan(e.name)}
          </div>
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Buy venue *</label>
            <select id="af-venue" style="${inputStyle(e.venue)}">
              <option value="">Select…</option>
              <option value="item-market">Item market</option>
              <option value="bazaar">Bazaar</option>
              <option value="auction">Auction</option>
              <option value="manual">Manual</option>
            </select>
            ${errSpan(e.venue)}
          </div>
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Buy price (per unit) *</label>
            <input id="af-price" type="number" min="1" style="${inputStyle(e.price)}" placeholder="0">
            ${errSpan(e.price)}
          </div>
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Qty *</label>
            <input id="af-qty" type="number" min="1" step="1" style="${inputStyle(e.qty)}" placeholder="0">
            ${errSpan(e.qty)}
          </div>
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Sell target (per unit)</label>
            <input id="af-target" type="number" min="1" style="${inputStyle(e.target)}" placeholder="optional">
            ${errSpan(e.target)}
          </div>
          <div>
            <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Fair value at open</label>
            <input id="af-fv" type="number" min="1" style="${inputStyle(e.fv)}" placeholder="optional">
            ${errSpan(e.fv)}
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:11px;">
            <input type="checkbox" id="af-flood"> Flood play
          </label>
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block;margin-bottom:3px;color:#94a3b8;font-size:11px;">Notes</label>
          <input id="af-notes" type="text" style="${inputStyle(false)}" placeholder="optional">
        </div>
        <div style="display:flex;gap:8px;">
          <button type="submit" style="${btnStyle('green')}">Add trade</button>
          <button type="button" id="af-cancel" style="${btnStyle('gray')}">Cancel</button>
        </div>
      </form>
    `;
  }

  function buildSellForm(tradeId, remainingQty) {
    const se = MEM.sellFormErrors;
    return `
      <form id="ldgr-sell-form-${tradeId}" style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;padding:8px 6px;background:#0f172a;">
        <div style="min-width:90px;">
          <label style="display:block;color:#94a3b8;font-size:10px;margin-bottom:2px;">Qty sold * (max ${remainingQty})</label>
          <input id="sf-qty-${tradeId}" type="number" min="1" max="${remainingQty}" step="1"
            style="${inputStyle(se.qty)}">
          ${errSpan(se.qty)}
        </div>
        <div style="min-width:100px;">
          <label style="display:block;color:#94a3b8;font-size:10px;margin-bottom:2px;">Sell price (per unit) *</label>
          <input id="sf-price-${tradeId}" type="number" min="1"
            style="${inputStyle(se.price)}">
          ${errSpan(se.price)}
        </div>
        <div style="min-width:120px;">
          <label style="display:block;color:#94a3b8;font-size:10px;margin-bottom:2px;">Sell venue *</label>
          <select id="sf-venue-${tradeId}" style="${inputStyle(se.venue)}">
            <option value="">Select…</option>
            <option value="item-market">Item market</option>
            <option value="bazaar">Bazaar</option>
            <option value="auction">Auction</option>
          </select>
          ${errSpan(se.venue)}
        </div>
        <div style="display:flex;gap:6px;align-items:flex-end;padding-bottom:2px;margin-top:16px;">
          <button type="submit" style="${btnStyle('green')}">Log sell</button>
          <button type="button" class="ldgr-cancel-sell" data-id="${tradeId}" style="${btnStyle('gray')}">Cancel</button>
        </div>
      </form>
    `;
  }

  function buildMktValueCell(itemName, fairValueAtOpen) {
    const live = MEM.fairValues[itemName];
    if (live) {
      return `<td style="padding:4px 6px;color:#4ade80;">${fmtMoney(live.p50)}</td>`;
    }
    if (fairValueAtOpen) {
      return `<td style="padding:4px 6px;color:#64748b;" title="stale — TornW3B unavailable">${fmtMoney(fairValueAtOpen)}&thinsp;*</td>`;
    }
    return `<td style="padding:4px 6px;">—</td>`;
  }

  function buildOpenRow(t) {
    const statusColor = t.status === 'partial' ? '#fb923c' : '#4ade80';
    const statusLabel = t.status === 'partial' ? 'partial' : 'open';
    const sellFormOpen = MEM.sellFormOpenId === t.id;

    return `
      <tr style="border-bottom:1px solid #1e293b;" data-id="${t.id}">
        <td style="padding:4px 6px;">${t.itemName}<br><span style="color:${statusColor};font-size:10px;">${statusLabel}</span></td>
        <td style="padding:4px 6px;color:#94a3b8;">${t.source}</td>
        <td style="padding:4px 6px;">${fmtMoney(t.buyPrice)}</td>
        <td style="padding:4px 6px;">${t.qty} / ${t.remainingQty}</td>
        <td style="padding:4px 6px;">${t.buyVenue}</td>
        <td style="padding:4px 6px;">${t.sellTarget ? fmtMoney(t.sellTarget) : '—'}</td>
        <td style="padding:4px 6px;">${t.fairValueAtOpen ? fmtMoney(t.fairValueAtOpen) : '—'}</td>
        ${buildMktValueCell(t.itemName, t.fairValueAtOpen)}
        <td style="padding:4px 6px;text-align:center;">${t.floodPlay ? '✓' : ''}</td>
        <td style="padding:4px 6px;">${fmtDate(t.openedAt)}</td>
        <td style="padding:4px 6px;">—</td>
        <td style="padding:4px 6px;">
          <button class="ldgr-log-sell" data-id="${t.id}" style="${btnStyle('blue')}">Log sell</button>
        </td>
      </tr>
      ${sellFormOpen ? `<tr><td colspan="12">${buildSellForm(t.id, t.remainingQty)}</td></tr>` : ''}
    `;
  }

  function buildClosedRow(t) {
    const pnl = calcPnl(t);
    const pnlColor = pnl >= 0 ? '#4ade80' : '#f87171';
    const totalQtySold = (t.sells ?? []).reduce((s, e) => s + e.qty, 0);
    const lastClosedAt = (t.sells ?? []).reduce((max, e) => Math.max(max, e.closedAt ?? 0), 0);
    return `
      <tr style="border-bottom:1px solid #1e293b;color:#6b7280;">
        <td style="padding:4px 6px;">${t.itemName}<br><span style="font-size:10px;">closed</span></td>
        <td style="padding:4px 6px;">${t.source}</td>
        <td style="padding:4px 6px;">${fmtMoney(t.buyPrice)}</td>
        <td style="padding:4px 6px;">${totalQtySold}</td>
        <td style="padding:4px 6px;">${t.buyVenue}</td>
        <td style="padding:4px 6px;">—</td>
        <td style="padding:4px 6px;">—</td>
        <td style="padding:4px 6px;">—</td>
        <td style="padding:4px 6px;text-align:center;">${t.floodPlay ? '✓' : ''}</td>
        <td style="padding:4px 6px;">${fmtDate(lastClosedAt || t.openedAt)}</td>
        <td style="padding:4px 6px;color:${pnlColor};font-weight:bold;">${fmtMoney(pnl)}</td>
        <td style="padding:4px 6px;"></td>
      </tr>
    `;
  }

  function buildTable(trades) {
    if (!trades.length) return '';
    const rows = trades.map(t => (t.status === 'closed' ? buildClosedRow(t) : buildOpenRow(t))).join('');
    return `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="color:#94a3b8;border-bottom:1px solid #1e3a5f;text-align:left;">
              <th style="padding:4px 6px;">Item</th>
              <th style="padding:4px 6px;">Source</th>
              <th style="padding:4px 6px;">Buy $</th>
              <th style="padding:4px 6px;">Qty/Rem</th>
              <th style="padding:4px 6px;">Venue</th>
              <th style="padding:4px 6px;">Target</th>
              <th style="padding:4px 6px;">FV@Open</th>
              <th style="padding:4px 6px;">Mkt Value</th>
              <th style="padding:4px 6px;">Flood</th>
              <th style="padding:4px 6px;">Date</th>
              <th style="padding:4px 6px;">P&amp;L</th>
              <th style="padding:4px 6px;"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // ─── Event wiring ─────────────────────────────────────────────────────────────

  function wireKeySection() {
    document.getElementById('ldgr-clear-key')?.addEventListener('click', () => {
      Store.set('ldgr_apikey', null);
      render();
    });

    document.getElementById('ldgr-save-key')?.addEventListener('click', () => {
      const val = document.getElementById('ldgr-key-input')?.value?.trim() ?? '';
      const errEl = document.getElementById('ldgr-key-error');
      if (!val) {
        if (errEl) errEl.textContent = 'Key cannot be empty';
        return;
      }
      Store.set('ldgr_apikey', val);
      render();
    });
  }

  function wireAddForm() {
    document.getElementById('af-cancel')?.addEventListener('click', () => {
      MEM.addFormOpen = false;
      MEM.addFormErrors = {};
      render();
    });

    document.getElementById('ldgr-add-form')?.addEventListener('submit', evt => {
      evt.preventDefault();
      const errors = {};

      const name = document.getElementById('af-name').value.trim();
      const venue = document.getElementById('af-venue').value;
      const priceRaw = document.getElementById('af-price').value;
      const qtyRaw = document.getElementById('af-qty').value;
      const targetRaw = document.getElementById('af-target').value.trim();
      const fvRaw = document.getElementById('af-fv').value.trim();
      const flood = document.getElementById('af-flood').checked;
      const notes = document.getElementById('af-notes').value.trim();

      if (!name) errors.name = 'Required';
      if (!venue) errors.venue = 'Required';

      const price = parseFloat(priceRaw);
      if (!priceRaw || isNaN(price) || price <= 0) errors.price = 'Must be a positive number';

      const qty = parseInt(qtyRaw, 10);
      if (!qtyRaw || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) errors.qty = 'Must be a positive whole number';

      const target = targetRaw ? parseFloat(targetRaw) : null;
      if (targetRaw && (isNaN(target) || target <= 0)) errors.target = 'Must be a positive number';

      const fv = fvRaw ? parseFloat(fvRaw) : null;
      if (fvRaw && (isNaN(fv) || fv <= 0)) errors.fv = 'Must be a positive number';

      if (Object.keys(errors).length) {
        MEM.addFormErrors = errors;
        render();
        return;
      }

      TradeStore.add({
        id: genId(),
        schemaVersion: 1,
        source: 'manual',
        itemId: null,
        itemName: name,
        buyPrice: price,
        qty,
        remainingQty: qty,
        buyVenue: venue,
        sellTarget: target,
        fairValueAtOpen: fv,
        floodPlay: flood,
        notes,
        openedAt: Date.now(),
        status: 'open',
        sells: [],
        alertFired: false,
      });

      MEM.addFormOpen = false;
      MEM.addFormErrors = {};
      render();
    });
  }

  function wireSellButtons() {
    document.querySelectorAll('.ldgr-log-sell').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        MEM.sellFormOpenId = MEM.sellFormOpenId === id ? null : id;
        MEM.sellFormErrors = {};
        render();
      });
    });

    document.querySelectorAll('.ldgr-cancel-sell').forEach(btn => {
      btn.addEventListener('click', () => {
        MEM.sellFormOpenId = null;
        MEM.sellFormErrors = {};
        render();
      });
    });

    document.querySelectorAll('[id^="ldgr-sell-form-"]').forEach(form => {
      const tradeId = form.id.replace('ldgr-sell-form-', '');
      form.addEventListener('submit', evt => {
        evt.preventDefault();
        const trade = MEM.trades.find(t => t.id === tradeId);
        if (!trade) return;

        const errors = {};
        const qtyRaw = document.getElementById(`sf-qty-${tradeId}`).value;
        const priceRaw = document.getElementById(`sf-price-${tradeId}`).value;
        const venue = document.getElementById(`sf-venue-${tradeId}`).value;

        const qty = parseInt(qtyRaw, 10);
        if (!qtyRaw || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
          errors.qty = 'Must be a positive whole number';
        } else if (qty > trade.remainingQty) {
          errors.qty = `Max ${trade.remainingQty}`;
        }

        const price = parseFloat(priceRaw);
        if (!priceRaw || isNaN(price) || price <= 0) errors.price = 'Must be a positive number';

        if (!venue) errors.venue = 'Required';

        if (Object.keys(errors).length) {
          MEM.sellFormErrors = errors;
          render();
          return;
        }

        const sellEvent = { qty, price, venue, closedAt: Date.now() };
        if (qty >= trade.remainingQty) {
          TradeStore.fullClose(tradeId, sellEvent);
        } else {
          TradeStore.partialClose(tradeId, sellEvent);
        }

        MEM.sellFormOpenId = null;
        MEM.sellFormErrors = {};
        render();
      });
    });
  }

  // ─── W3B poll ────────────────────────────────────────────────────────────────

  async function pollW3B() {
    const active = TradeStore.getByStatus('open', 'partial');
    const itemNames = [...new Set(active.map(t => t.itemName))];
    if (!itemNames.length) return;
    const result = await W3BFetcher.fetch(itemNames);
    if (Object.keys(result).length) {
      Object.assign(MEM.fairValues, result);
      MEM.lastW3BPoll = Date.now();
      render();
    }
  }

  // ─── render ──────────────────────────────────────────────────────────────────

  function render() {
    MEM.trades = TradeStore.list();

    let panel = document.getElementById('ldgr-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ldgr-panel';
      panel.style.cssText = [
        'position:fixed;top:50px;right:12px;width:min(700px,calc(100vw - 24px));max-height:85vh;overflow-y:auto',
        'background:#16213e;color:#e0e0e0;border:1px solid #0f3460;border-radius:8px',
        'padding:16px;z-index:99999;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,.6)',
      ].join(';');
      document.body.appendChild(panel);
    }

    if (!MEM.panelOpen) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    const activeTrades = MEM.trades.filter(t => t.status !== 'closed');
    const closedTrades = MEM.trades.filter(t => t.status === 'closed');
    const displayed = MEM.showClosed ? [...activeTrades, ...closedTrades] : activeTrades;
    const capital = deployedCapital(MEM.trades);
    const isEmpty = displayed.length === 0;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong style="font-size:14px;">📒 Trade Ledger <span style="color:#64748b;font-size:11px;">v${SCRIPT_VERSION}</span></strong>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="ldgr-add-btn" style="${btnStyle('green')}">${MEM.addFormOpen ? '✕ Cancel' : '+ Add trade'}</button>
          <button id="ldgr-close-panel" style="${btnStyle('gray')}">✕</button>
        </div>
      </div>

      ${MEM.fetchError ? `<div style="color:#f87171;margin-bottom:8px;font-size:11px;">⚠ ${MEM.fetchError}</div>` : ''}

      ${buildKeySection()}

      ${MEM.addFormOpen ? buildAddForm() : ''}

      ${isEmpty && !MEM.addFormOpen
        ? `<div style="color:#64748b;text-align:center;padding:32px 0;">No trades recorded. Click "+ Add trade" to get started.</div>`
        : buildTable(displayed)}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #0f3460;">
        <label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;">
          <input type="checkbox" id="ldgr-show-closed" ${MEM.showClosed ? 'checked' : ''}>
          Show closed (${closedTrades.length})
        </label>
        <span style="font-size:12px;">Deployed capital: <strong style="color:#4ade80;">${fmtMoney(capital)}</strong></span>
      </div>
    `;

    // Core panel events
    document.getElementById('ldgr-close-panel').addEventListener('click', () => {
      MEM.panelOpen = false;
      Store.set('ldgr_collapsed', true);
      render();
    });
    document.getElementById('ldgr-add-btn').addEventListener('click', () => {
      MEM.addFormOpen = !MEM.addFormOpen;
      MEM.addFormErrors = {};
      render();
    });
    document.getElementById('ldgr-show-closed').addEventListener('change', evt => {
      MEM.showClosed = evt.target.checked;
      render();
    });

    wireKeySection();
    if (MEM.addFormOpen) wireAddForm();
    wireSellButtons();
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  injectNavIcon();
  render();
  pollW3B();
  setInterval(pollW3B, 5 * 60 * 1000);

})();
