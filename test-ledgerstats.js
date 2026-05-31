// node test-ledgerstats.js
// Tests for LedgerStats (issue #307) — the pure Ledger-dashboard aggregator.
// Mirrors test-trade-ledger.js's plain-assertion style, but requires the
// shipped .user.js directly (ADR-0002 seam) so the real code is exercised.
// External behavior only: feed items[] + injected now, assert summary outputs.

'use strict';

// ── Browser-global shim (lets the IIFE load under Node, skips DOM bootstrap) ──

function makeMockStorage() {
  const data = {};
  return {
    getItem:    k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem:    (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear:      () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};

require('./TORN-RW-trading-hub.user.js');

const { LedgerStats } = globalThis.__RwthPure;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function assertEq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function held(over = {})   { return { status: 'held',   itemName: 'Item', buyPrice: 1000, buyTimestamp: NOW, ...over }; }
function listed(over = {}) { return { status: 'listed', itemName: 'Item', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW, ...over }; }
function sold(over = {})   {
  return {
    status: 'sold', itemName: 'Item', buyPrice: 1000,
    saleNet: 1500, saleFees: 50,
    buyTimestamp: NOW - 2 * DAY, soldTimestamp: NOW, ...over,
  };
}

// ── empty ledger ──────────────────────────────────────────────────────────────

console.log('\nempty ledger');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('realized 0', s.realized, 0);
  assertEq('realizedRoiPct 0 (no divide-by-zero)', s.realizedRoiPct, 0);
  assertEq('pending 0', s.pending, 0);
  assertEq('capitalDeployed 0', s.capitalDeployed, 0);
  assertEq('winRate 0', s.winRate, 0);
  assertEq('avgDaysToClear 0', s.avgDaysToClear, 0);
  assertEq('feesPaid 0', s.feesPaid, 0);
  assertEq('soldCount 0', s.soldCount, 0);
  assertEq('best null', s.best, null);
  assertEq('worst null', s.worst, null);
  assert('no NaN anywhere', Object.values(s).every(v => typeof v !== 'number' || Number.isFinite(v)));
}

// ── non-array / garbage input never throws ────────────────────────────────────

console.log('\ngarbage input');
{
  const s = LedgerStats.summarize(undefined, NOW);
  assertEq('undefined items → realized 0', s.realized, 0);
  const s2 = LedgerStats.summarize([null, undefined, {}], NOW);
  assertEq('null/empty rows ignored → capitalDeployed 0', s2.capitalDeployed, 0);
}

// ── only held ─────────────────────────────────────────────────────────────────

console.log('\nonly held');
{
  const s = LedgerStats.summarize([held({ buyPrice: 1000 }), held({ buyPrice: 2500 })], NOW);
  assertEq('capitalDeployed sums held buy prices', s.capitalDeployed, 3500);
  assertEq('realized 0 (nothing sold)', s.realized, 0);
  assertEq('pending 0 (nothing listed)', s.pending, 0);
  assertEq('soldCount 0', s.soldCount, 0);
}

// ── only listed ───────────────────────────────────────────────────────────────

console.log('\nonly listed');
{
  const s = LedgerStats.summarize([
    listed({ buyPrice: 1000, listPrice: 1500 }),
    listed({ buyPrice: 2000, listPrice: 2400 }),
  ], NOW);
  assertEq('pending sums (list - cost)', s.pending, (1500 - 1000) + (2400 - 2000));
  assertEq('capitalDeployed counts listed cost', s.capitalDeployed, 3000);
  assertEq('listedCount 2', s.listedCount, 2);
  assertEq('realized 0', s.realized, 0);
}

// ── no sold items (mixed held + listed) ──────────────────────────────────────

console.log('\nno sold items');
{
  const s = LedgerStats.summarize([held({ buyPrice: 500 }), listed({ buyPrice: 1000, listPrice: 1200 })], NOW);
  assertEq('winRate 0 with no sales', s.winRate, 0);
  assertEq('avgDaysToClear 0 with no sales', s.avgDaysToClear, 0);
  assertEq('capitalDeployed held+listed', s.capitalDeployed, 1500);
  assertEq('pending from the listed row', s.pending, 200);
}

// ── a loss-making sale lowers realized P/L and win rate ───────────────────────

console.log('\nloss sale');
{
  const s = LedgerStats.summarize([
    sold({ itemName: 'Win',  buyPrice: 1000, saleNet: 1500 }),  // +500
    sold({ itemName: 'Loss', buyPrice: 2000, saleNet: 1200 }),  // -800
  ], NOW);
  assertEq('realized nets win + loss', s.realized, 500 - 800);
  assertEq('soldCost is total cost basis', s.realizedRoiPct, Math.round((-300 / 3000) * 100 * 10) / 10);
  assertEq('winRate counts only profitable', s.winRate, 50);
  assertEq('best flip is the winner', s.best.name, 'Win');
  assertEq('best profit', s.best.profit, 500);
  assertEq('worst flip is the loss', s.worst.name, 'Loss');
  assertEq('worst profit', s.worst.profit, -800);
}

// ── list price below cost yields negative pending ─────────────────────────────

console.log('\nlist below cost');
{
  const s = LedgerStats.summarize([listed({ buyPrice: 2000, listPrice: 1500 })], NOW);
  assertEq('pending negative', s.pending, -500);
}

// ── missing / non-finite timestamps never produce NaN ────────────────────────

console.log('\nmissing timestamps');
{
  const s = LedgerStats.summarize([
    sold({ buyTimestamp: undefined, soldTimestamp: NOW }),       // no buy stamp
    sold({ buyTimestamp: NOW - DAY, soldTimestamp: undefined }), // no sold stamp
    sold({ buyTimestamp: NOW, soldTimestamp: NOW - DAY }),       // sold before buy (sane filter)
    sold({ buyTimestamp: NOW - 4 * DAY, soldTimestamp: NOW }),   // the one valid span: 4 days
  ], NOW);
  assert('avgDaysToClear finite', Number.isFinite(s.avgDaysToClear));
  assertEq('avgDaysToClear uses only the valid span', s.avgDaysToClear, 4);
  assertEq('all four still count as sold', s.soldCount, 4);
}

// ── missing saleNet excludes the row from realized/sold ───────────────────────

console.log('\nsold row missing saleNet');
{
  const s = LedgerStats.summarize([
    sold({ saleNet: null }),
    sold({ buyPrice: 1000, saleNet: 1400 }),
  ], NOW);
  assertEq('only the priced sale counts', s.soldCount, 1);
  assertEq('realized from the priced sale', s.realized, 400);
}

// ── single sold item ──────────────────────────────────────────────────────────

console.log('\nsingle sold item');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1600, saleFees: 80, buyTimestamp: NOW - 3 * DAY, soldTimestamp: NOW }),
  ], NOW);
  assertEq('realized', s.realized, 600);
  assertEq('realizedRoiPct', s.realizedRoiPct, 60);
  assertEq('winRate 100', s.winRate, 100);
  assertEq('avgDaysToClear', s.avgDaysToClear, 3);
  assertEq('feesPaid', s.feesPaid, 80);
  assertEq('best is the only flip', s.best.profit, 600);
  assertEq('worst is the only flip', s.worst.profit, 600);
}

// ── mixed realistic ledger (held + listed + sold) ─────────────────────────────

console.log('\nmixed realistic ledger');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 5000 }),
    listed({ buyPrice: 10000, listPrice: 13000 }),
    listed({ buyPrice: 8000, listPrice: 7500 }),                 // listed at a loss
    sold({ buyPrice: 12000, saleNet: 15000, saleFees: 300, buyTimestamp: NOW - 2 * DAY, soldTimestamp: NOW }),
    sold({ buyPrice: 9000, saleNet: 8500, saleFees: 200, buyTimestamp: NOW - 6 * DAY, soldTimestamp: NOW }),
  ], NOW);
  assertEq('realized', s.realized, 3000 - 500);
  assertEq('pending', s.pending, 3000 - 500);
  assertEq('capitalDeployed (held + 2 listed)', s.capitalDeployed, 5000 + 10000 + 8000);
  assertEq('feesPaid', s.feesPaid, 500);
  assertEq('winRate', s.winRate, 50);
  assertEq('avgDaysToClear', s.avgDaysToClear, 4);
  assertEq('listedCount', s.listedCount, 2);
  assertEq('soldCount', s.soldCount, 2);
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
