// node test-trade-ledger.js
// Tests for TradeStore (issue #229) and LogParser (issue #232).
// Functions inlined here; keep in sync with the IIFE implementation.

'use strict';

// ── Mock localStorage ─────────────────────────────────────────────────────────

function makeMockStorage() {
  const _data = {};
  return {
    getItem:    k => Object.prototype.hasOwnProperty.call(_data, k) ? _data[k] : null,
    setItem:    (k, v) => { _data[k] = v; },
    removeItem: k => { delete _data[k]; },
    clear:      () => { for (const k of Object.keys(_data)) delete _data[k]; },
  };
}

// ── Store + TradeStore (mirror IIFE) ─────────────────────────────────────────

function makeStore(ls) {
  return {
    get(k)    { try { return JSON.parse(ls.getItem(k)); } catch { return null; } },
    set(k, v) { try { ls.setItem(k, JSON.stringify(v)); } catch {} },
  };
}

function makeTradeStore(Store) {
  return {
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
}

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

function assertEq(label, a, b) {
  if (a === b) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);
    failed++;
  }
}

function makeRecord(overrides = {}) {
  return {
    id: 'trade-1',
    schemaVersion: 1,
    source: 'manual',
    itemId: null,
    itemName: 'Medikit',
    buyPrice: 1000,
    qty: 10,
    remainingQty: 10,
    buyVenue: 'bazaar',
    sellTarget: 1500,
    fairValueAtOpen: 1400,
    floodPlay: false,
    notes: '',
    openedAt: Date.now(),
    status: 'open',
    sells: [],
    alertFired: false,
    ...overrides,
  };
}

function freshStore() {
  const ls = makeMockStorage();
  const Store = makeStore(ls);
  const TradeStore = makeTradeStore(Store);
  return { Store, TradeStore };
}

// ── add — deduplication by id ─────────────────────────────────────────────────

console.log('\nadd — deduplication by id');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 'trade-1' }));
  TradeStore.add(makeRecord({ id: 'trade-1', itemName: 'Different' }));
  const trades = TradeStore.list();
  assertEq('only one record stored', trades.length, 1);
  assertEq('first record wins', trades[0].itemName, 'Medikit');
}

// ── add — schemaVersion always 1 ─────────────────────────────────────────────

console.log('\nadd — schemaVersion set to 1');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ schemaVersion: 99 }));
  assertEq('schemaVersion forced to 1', TradeStore.list()[0].schemaVersion, 1);
}

// ── getByStatus — filtering ───────────────────────────────────────────────────

console.log('\ngetByStatus — filtering');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 'a', status: 'open' }));
  TradeStore.add(makeRecord({ id: 'b', status: 'partial' }));
  TradeStore.add(makeRecord({ id: 'c', status: 'closed' }));

  assertEq('open only', TradeStore.getByStatus('open').length, 1);
  assertEq('partial only', TradeStore.getByStatus('partial').length, 1);
  assertEq('closed only', TradeStore.getByStatus('closed').length, 1);
  assertEq('open + partial', TradeStore.getByStatus('open', 'partial').length, 2);
  assertEq('all three', TradeStore.getByStatus('open', 'partial', 'closed').length, 3);
  assertEq('none matched', TradeStore.getByStatus('unknown').length, 0);
}

// ── partialClose — qty decrement and status transitions ───────────────────────

console.log('\npartialClose — status transitions and qty decrement');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 't1', qty: 10, remainingQty: 10, status: 'open', sells: [] }));

  TradeStore.partialClose('t1', { qty: 4, price: 1500, venue: 'bazaar', closedAt: Date.now() });
  const after1 = TradeStore.list()[0];
  assertEq('remainingQty decremented to 6', after1.remainingQty, 6);
  assertEq('status is partial after first sell', after1.status, 'partial');
  assertEq('sells has 1 entry', after1.sells.length, 1);

  TradeStore.partialClose('t1', { qty: 4, price: 1600, venue: 'bazaar', closedAt: Date.now() });
  const after2 = TradeStore.list()[0];
  assertEq('remainingQty decremented to 2', after2.remainingQty, 2);
  assertEq('status remains partial', after2.status, 'partial');
  assertEq('sells has 2 entries', after2.sells.length, 2);
}

// ── partialClose — closes when remainingQty reaches 0 ────────────────────────

console.log('\npartialClose — auto-closes when remainingQty hits 0');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 't2', qty: 5, remainingQty: 5, status: 'open', sells: [] }));

  TradeStore.partialClose('t2', { qty: 3, price: 1500, venue: 'bazaar', closedAt: Date.now() });
  assertEq('still partial after 3/5', TradeStore.list()[0].status, 'partial');

  TradeStore.partialClose('t2', { qty: 2, price: 1500, venue: 'bazaar', closedAt: Date.now() });
  const final = TradeStore.list()[0];
  assertEq('status is closed when remainingQty = 0', final.status, 'closed');
  assertEq('remainingQty is 0', final.remainingQty, 0);
}

// ── fullClose — final state ───────────────────────────────────────────────────

console.log('\nfullClose — final state');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 'f1', qty: 10, remainingQty: 10, status: 'open', sells: [] }));

  TradeStore.fullClose('f1', { qty: 10, price: 2000, venue: 'item-market', closedAt: Date.now() });
  const t = TradeStore.list()[0];
  assertEq('status is closed', t.status, 'closed');
  assertEq('remainingQty is 0', t.remainingQty, 0);
  assertEq('sells has 1 entry', t.sells.length, 1);
  assertEq('sell price recorded', t.sells[0].price, 2000);
}

// ── open → partial → closed full lifecycle ────────────────────────────────────

console.log('\nopen → partial → closed full lifecycle');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 'lc', qty: 6, remainingQty: 6, status: 'open', sells: [] }));

  assertEq('starts open', TradeStore.list()[0].status, 'open');

  TradeStore.partialClose('lc', { qty: 2, price: 1500, venue: 'bazaar', closedAt: Date.now() });
  assertEq('transitions to partial', TradeStore.list()[0].status, 'partial');

  TradeStore.partialClose('lc', { qty: 2, price: 1600, venue: 'bazaar', closedAt: Date.now() });
  assertEq('remains partial at 2 remaining', TradeStore.list()[0].status, 'partial');

  TradeStore.partialClose('lc', { qty: 2, price: 1700, venue: 'bazaar', closedAt: Date.now() });
  const final = TradeStore.list()[0];
  assertEq('transitions to closed', final.status, 'closed');
  assertEq('remainingQty is 0', final.remainingQty, 0);
  assertEq('all 3 sell events recorded', final.sells.length, 3);
}

// ── update ────────────────────────────────────────────────────────────────────

console.log('\nupdate — merges fields');
{
  const { TradeStore } = freshStore();
  TradeStore.add(makeRecord({ id: 'u1', notes: '' }));

  TradeStore.update('u1', { notes: 'flood play', sellTarget: 2000 });
  const t = TradeStore.list()[0];
  assertEq('notes updated', t.notes, 'flood play');
  assertEq('sellTarget updated', t.sellTarget, 2000);
  assertEq('itemName unchanged', t.itemName, 'Medikit');
}

// ── LogParser (mirror IIFE) ───────────────────────────────────────────────────

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
        // silently skip
      }
    }
    return results;
  }

  return {
    parseBuyCandidates(entries) { return parse(entries, BUY_PATTERNS, 'openedAt'); },
    parseSellEvents(entries)    { return parse(entries, SELL_PATTERNS, 'closedAt'); },
  };
})();

// ── LogParser — parseBuyCandidates ────────────────────────────────────────────

console.log('\nparseBuyCandidates — bazaar');
{
  const entries = [{ action: "You bought 26x Tribulus Omanense on PittH's bazaar at $69,000 each for a total of $1,794,000", timestamp: 1746100000 }];
  const result = LogParser.parseBuyCandidates(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Tribulus Omanense');
  assertEq('buyPrice', result[0].buyPrice, 69000);
  assertEq('qty', result[0].qty, 26);
  assertEq('buyVenue', result[0].buyVenue, 'bazaar');
  assertEq('openedAt epoch ms', result[0].openedAt, 1746100000000);
}

console.log('\nparseBuyCandidates — item market');
{
  const entries = [{ action: 'You bought 31x Tribulus Omanense on the item market from Dismas_Hart at $69,357 each for a total of $2,150,067', timestamp: 1746200000 }];
  const result = LogParser.parseBuyCandidates(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Tribulus Omanense');
  assertEq('buyPrice', result[0].buyPrice, 69357);
  assertEq('qty', result[0].qty, 31);
  assertEq('buyVenue', result[0].buyVenue, 'item-market');
}

console.log('\nparseBuyCandidates — auction');
{
  const entries = [{ action: 'You bought 5x Xanax from the auction house at $50,000 each for a total of $250,000', timestamp: 1746300000 }];
  const result = LogParser.parseBuyCandidates(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Xanax');
  assertEq('buyPrice', result[0].buyPrice, 50000);
  assertEq('buyVenue', result[0].buyVenue, 'auction');
}

console.log('\nparseBuyCandidates — malformed entry skipped');
{
  const entries = [
    { action: 'Some unrecognized log line', timestamp: 1746000000 },
    { action: null, timestamp: 1746000000 },
    { action: "You bought 10x Xanax on Bob's bazaar at $40,000 each for a total of $400,000", timestamp: 1746000001 },
  ];
  const result = LogParser.parseBuyCandidates(entries);
  assertEq('only valid entry returned', result.length, 1);
  assertEq('correct item', result[0].itemName, 'Xanax');
}

console.log('\nparseBuyCandidates — empty array returns empty');
{
  assertEq('empty in, empty out', LogParser.parseBuyCandidates([]).length, 0);
}

// ── LogParser — parseSellEvents ───────────────────────────────────────────────

console.log('\nparseSellEvents — bazaar');
{
  const entries = [{ action: 'You sold 38x Tribulus Omanense on your bazaar to Fairfax1991 at $70,428 each for a total of $2,676,264', timestamp: 1746400000 }];
  const result = LogParser.parseSellEvents(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Tribulus Omanense');
  assertEq('price', result[0].price, 70428);
  assertEq('qty', result[0].qty, 38);
  assertEq('venue', result[0].venue, 'bazaar');
  assertEq('closedAt epoch ms', result[0].closedAt, 1746400000000);
}

console.log('\nparseSellEvents — item market');
{
  const entries = [{ action: 'You sold 10x Xanax on the item market at $55,000 each for a total of $550,000', timestamp: 1746500000 }];
  const result = LogParser.parseSellEvents(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Xanax');
  assertEq('price', result[0].price, 55000);
  assertEq('venue', result[0].venue, 'item-market');
}

console.log('\nparseSellEvents — auction');
{
  const entries = [{ action: 'You sold 2x Blood Bag: A- at the auction house at $1,200,000 each for a total of $2,400,000', timestamp: 1746600000 }];
  const result = LogParser.parseSellEvents(entries);
  assertEq('one result', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Blood Bag: A-');
  assertEq('price', result[0].price, 1200000);
  assertEq('venue', result[0].venue, 'auction');
}

console.log('\nparseSellEvents — malformed entry skipped');
{
  const entries = [
    { action: 'Random noise', timestamp: 1746000000 },
    { action: 'You sold 5x Xanax on your bazaar to Player at $60,000 each for a total of $300,000', timestamp: 1746000001 },
  ];
  const result = LogParser.parseSellEvents(entries);
  assertEq('only valid entry returned', result.length, 1);
}

console.log('\nparseSellEvents — empty array returns empty');
{
  assertEq('empty in, empty out', LogParser.parseSellEvents([]).length, 0);
}

// ── SellAlertEngine (mirror IIFE) ─────────────────────────────────────────────

const SellAlertEngine = {
  checkAlerts(positions, fairValues) {
    return positions.filter(p => {
      if (!p.sellTarget) return false;
      const fv = fairValues[p.itemName];
      if (!fv) return false;
      return fv.p50 >= p.sellTarget && !p.alertFired;
    });
  },
};

console.log('\nSellAlertEngine — checkAlerts');
{
  const pos = [makeRecord({ itemName: 'Xanax', sellTarget: 1500, alertFired: false })];
  const fv = { Xanax: { p50: 1500 } };
  assert('triggers when P50 >= sellTarget and alertFired false', SellAlertEngine.checkAlerts(pos, fv).length === 1);
}
{
  const pos = [makeRecord({ itemName: 'Xanax', sellTarget: 1500, alertFired: true })];
  const fv = { Xanax: { p50: 1500 } };
  assert('does not trigger when alertFired true', SellAlertEngine.checkAlerts(pos, fv).length === 0);
}
{
  const pos = [makeRecord({ itemName: 'Xanax', sellTarget: 1500, alertFired: false })];
  const fv = { Xanax: { p50: 1499 } };
  assert('does not trigger when P50 < sellTarget', SellAlertEngine.checkAlerts(pos, fv).length === 0);
}
{
  const pos = [
    makeRecord({ id: 'a', itemName: 'Xanax',   sellTarget: 1000, alertFired: false }),
    makeRecord({ id: 'b', itemName: 'Medikit',  sellTarget: 500,  alertFired: false }),
    makeRecord({ id: 'c', itemName: 'Armor',    sellTarget: 2000, alertFired: true  }),
  ];
  const fv = { Xanax: { p50: 1200 }, Medikit: { p50: 600 }, Armor: { p50: 3000 } };
  assert('returns multiple triggered positions', SellAlertEngine.checkAlerts(pos, fv).length === 2);
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
