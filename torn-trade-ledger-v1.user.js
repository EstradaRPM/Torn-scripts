// ==UserScript==
// @name         Torn Trade Ledger
// @namespace    estradarpm-trade-ledger
// @version      1.1.0
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

  const SCRIPT_VERSION = '1.1.0';
  const API_KEY = '###PDA-APIKEY###';

  // ─── Store ──────────────────────────────────────────────────────────────────
  // ldgr_ prefix = ledger-private; torn_ prefix = shared across scripts
  const Store = {
    get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ─── TradeStore ─────────────────────────────────────────────────────────────
  // Owns all CRUD for torn_trades. Status transitions: open → partial → closed.
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

  // ─── MEM ────────────────────────────────────────────────────────────────────
  const MEM = {
    trades:      [],
    scanResults: null,
    fairValues:  {},
    fetchError:  null,
    lastW3BPoll: 0,
    panelOpen:   false,
    showClosed:  false,
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  const FEE_RATE = { bazaar: 0, 'item-market': 0.05, auction: 0.03, manual: 0 };

  function calcPnL(trade) {
    const sells = trade.sells ?? [];
    const net = sells.reduce((acc, s) => acc + s.price * s.qty * (1 - (FEE_RATE[s.venue] ?? 0)), 0);
    const totalQtySold = sells.reduce((acc, s) => acc + s.qty, 0);
    return net - trade.buyPrice * totalQtySold;
  }

  function fmt$(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(Math.round(n)).toLocaleString();
    return (n < 0 ? '-$' : '$') + abs;
  }

  function fmtDate(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString();
  }

  // ─── MigrationRunner ────────────────────────────────────────────────────────
  // Runs once: converts st_trades (Snipe Tracker schema) → torn_trades on first load.
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

  // ─── NavIcon ─────────────────────────────────────────────────────────────────
  const NavIcon = {
    mount() {
      if (document.getElementById('ldgr-icon-btn')) return;

      const selectors = [
        '#header-root .icons-bar',
        '#header-root ul.icon-list',
        '#header-root',
      ];

      let mountPoint = null;
      for (const sel of selectors) {
        mountPoint = document.querySelector(sel);
        if (mountPoint) break;
      }

      if (!mountPoint) {
        console.warn('[TradeLedger] No nav tray mount point found; icon not injected');
        return;
      }

      const item = document.createElement('li');
      item.id = 'ldgr-nav-item';
      item.style.cssText = 'list-style:none;display:inline-block;vertical-align:middle;';
      item.innerHTML = `<button id="ldgr-icon-btn" title="Trade Ledger" style="
        background:none;border:none;cursor:pointer;padding:4px 6px;
        font-size:14px;line-height:1;color:inherit;
      ">📒</button>`;
      mountPoint.appendChild(item);

      document.getElementById('ldgr-icon-btn').addEventListener('click', () => {
        MEM.panelOpen = !MEM.panelOpen;
        Store.set('ldgr_collapsed', !MEM.panelOpen);
        render();
      });
    },
  };

  // ─── render ──────────────────────────────────────────────────────────────────
  function render() {
    let panel = document.getElementById('ldgr-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'ldgr-panel';
      Object.assign(panel.style, {
        position: 'fixed',
        top: '50px',
        right: '8px',
        width: '660px',
        maxHeight: '80vh',
        overflowY: 'auto',
        background: '#1e1e2e',
        color: '#cdd6f4',
        border: '1px solid #45475a',
        borderRadius: '6px',
        zIndex: '10000',
        fontFamily: 'sans-serif',
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      });
      document.body.appendChild(panel);
    }

    if (!MEM.panelOpen) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';

    const openPartial = MEM.trades.filter(t => t.status === 'open' || t.status === 'partial');
    const closed = MEM.trades.filter(t => t.status === 'closed');
    const deployedCapital = openPartial.reduce((acc, t) => acc + t.buyPrice * t.remainingQty, 0);
    const displayTrades = MEM.showClosed ? [...openPartial, ...closed] : openPartial;

    let tableRows = '';
    if (displayTrades.length === 0) {
      tableRows = `<tr><td colspan="10" style="text-align:center;padding:16px;color:#585b70;">
        No trades recorded
      </td></tr>`;
    } else {
      for (const t of displayTrades) {
        if (t.status === 'closed') {
          const pnl = calcPnL(t);
          const pnlColor = pnl >= 0 ? '#a6e3a1' : '#f38ba8';
          const totalSold = (t.sells ?? []).reduce((acc, s) => acc + s.qty, 0);
          const lastSell = (t.sells ?? []).slice(-1)[0];
          tableRows += `<tr style="opacity:0.6;">
            <td style="padding:4px 6px;">${t.itemName}</td>
            <td colspan="6" style="padding:4px 6px;font-style:italic;color:#585b70;">closed</td>
            <td style="padding:4px 6px;color:${pnlColor};font-weight:bold;">${fmt$(pnl)}</td>
            <td style="padding:4px 6px;">${totalSold}</td>
            <td style="padding:4px 6px;">${fmtDate(lastSell?.closedAt)}</td>
          </tr>`;
        } else {
          tableRows += `<tr>
            <td style="padding:4px 6px;">${t.itemName}</td>
            <td style="padding:4px 6px;">${t.source}</td>
            <td style="padding:4px 6px;">${fmt$(t.buyPrice)}</td>
            <td style="padding:4px 6px;">${t.qty}</td>
            <td style="padding:4px 6px;">${t.remainingQty}</td>
            <td style="padding:4px 6px;">${t.buyVenue}</td>
            <td style="padding:4px 6px;">${t.sellTarget != null ? fmt$(t.sellTarget) : '—'}</td>
            <td style="padding:4px 6px;">${t.fairValueAtOpen != null ? fmt$(t.fairValueAtOpen) : '—'}</td>
            <td style="padding:4px 6px;">${t.floodPlay ? '⚡' : ''}</td>
            <td style="padding:4px 6px;">${fmtDate(t.openedAt)}</td>
          </tr>`;
        }
      }
    }

    panel.innerHTML = `
      <div style="padding:8px 12px;border-bottom:1px solid #45475a;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:bold;font-size:13px;">Trade Ledger</span>
        <label style="cursor:pointer;font-size:11px;user-select:none;">
          <input id="ldgr-show-closed" type="checkbox" ${MEM.showClosed ? 'checked' : ''} style="margin-right:4px;">
          Show closed
        </label>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#313244;text-align:left;white-space:nowrap;">
              <th style="padding:4px 6px;">Item</th>
              <th style="padding:4px 6px;">Source</th>
              <th style="padding:4px 6px;">Buy $</th>
              <th style="padding:4px 6px;">Qty</th>
              <th style="padding:4px 6px;">Rem</th>
              <th style="padding:4px 6px;">Venue</th>
              <th style="padding:4px 6px;">Target</th>
              <th style="padding:4px 6px;">FV / P&L</th>
              <th style="padding:4px 6px;">⚡ / Sold</th>
              <th style="padding:4px 6px;">Date</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
      <div style="padding:8px 12px;border-top:1px solid #45475a;font-size:11px;color:#a6adc8;">
        Deployed capital: <strong style="color:#cdd6f4;">${fmt$(deployedCapital)}</strong>
      </div>
    `;

    document.getElementById('ldgr-show-closed')?.addEventListener('change', e => {
      MEM.showClosed = e.target.checked;
      render();
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    const collapsed = Store.get('ldgr_collapsed');
    MEM.panelOpen = collapsed === null ? false : !collapsed;
    MEM.trades = TradeStore.list();
    NavIcon.mount();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
