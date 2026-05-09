// ==UserScript==
// @name         Torn Trade Ledger
// @namespace    estradarpm-trade-ledger
// @version      1.0.0
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

  const SCRIPT_VERSION = '1.0.0';
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

})();
