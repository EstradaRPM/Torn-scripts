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

// ── cumulative-profit series (hero chart dataset, #309) ──────────────────────

console.log('\ncumulativeProfit — empty / no sold');
{
  assertEq('empty ledger → empty series', LedgerStats.summarize([], NOW).cumulativeProfit.length, 0);
  assertEq('held + listed only → empty series',
    LedgerStats.summarize([held(), listed()], NOW).cumulativeProfit.length, 0);
}

console.log('\ncumulativeProfit — single sold');
{
  const s = LedgerStats.summarize([sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: NOW })], NOW);
  assertEq('one point', s.cumulativeProfit.length, 1);
  assertEq('point keyed by soldTimestamp', s.cumulativeProfit[0].t, NOW);
  assertEq('cumulative = its profit', s.cumulativeProfit[0].cumulative, 500);
}

console.log('\ncumulativeProfit — ordered + accumulated');
{
  // Fed out of time order; series must sort ascending by soldTimestamp.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1300, soldTimestamp: NOW + 2 * DAY }),   // +300 (latest)
    sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: NOW }),             // +500 (earliest)
    sold({ buyPrice: 2000, saleNet: 1200, soldTimestamp: NOW + DAY }),       // -800 (middle)
  ], NOW);
  assertEq('three points', s.cumulativeProfit.length, 3);
  assert('sorted ascending by t',
    s.cumulativeProfit[0].t < s.cumulativeProfit[1].t && s.cumulativeProfit[1].t < s.cumulativeProfit[2].t);
  assertEq('running total p1', s.cumulativeProfit[0].cumulative, 500);
  assertEq('running total p2', s.cumulativeProfit[1].cumulative, 500 - 800);
  assertEq('running total p3', s.cumulativeProfit[2].cumulative, 500 - 800 + 300);
  assertEq('final cumulative == realized', s.cumulativeProfit[2].cumulative, s.realized);
}

console.log('\ncumulativeProfit — drops rows missing soldTimestamp');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1500, soldTimestamp: undefined }),  // no stamp → off-curve
    sold({ buyPrice: 1000, saleNet: 1400, soldTimestamp: NOW }),
  ], NOW);
  assertEq('only the stamped sale plots', s.cumulativeProfit.length, 1);
  assertEq('but both still count as sold', s.soldCount, 2);
}

// ── margin spread buckets (#310) ─────────────────────────────────────────────

function bucketCount(buckets, label) {
  const b = buckets.find(x => x.label === label);
  return b ? b.count : undefined;
}

console.log('\nmarginBuckets — empty / no sold');
{
  const s = LedgerStats.summarize([held(), listed()], NOW);
  assertEq('five buckets even when empty', s.marginBuckets.length, 5);
  assertEq('all zero with no sales', s.marginBuckets.reduce((a, b) => a + b.count, 0), 0);
}

console.log('\nmarginBuckets — populated across ranges');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 800 }),    // -20%  → loss
    sold({ buyPrice: 1000, saleNet: 1100 }),   // +10%  → 0–25
    sold({ buyPrice: 1000, saleNet: 1300 }),   // +30%  → 25–50
    sold({ buyPrice: 1000, saleNet: 1700 }),   // +70%  → 50–100
    sold({ buyPrice: 1000, saleNet: 2500 }),   // +150% → 100+
    sold({ buyPrice: 0, saleNet: 500 }),       // no cost basis → excluded
  ], NOW);
  assertEq('loss bucket', bucketCount(s.marginBuckets, 'loss'), 1);
  assertEq('0–25 bucket', bucketCount(s.marginBuckets, '0–25'), 1);
  assertEq('25–50 bucket', bucketCount(s.marginBuckets, '25–50'), 1);
  assertEq('50–100 bucket', bucketCount(s.marginBuckets, '50–100'), 1);
  assertEq('100+ bucket', bucketCount(s.marginBuckets, '100+'), 1);
  assertEq('zero-cost row excluded from margin', s.marginBuckets.reduce((a, b) => a + b.count, 0), 5);
}

// ── inventory aging buckets (#310) ───────────────────────────────────────────

console.log('\nagingBuckets — empty / no held+listed');
{
  const s = LedgerStats.summarize([sold()], NOW);
  assertEq('five buckets even when empty', s.agingBuckets.length, 5);
  assertEq('all zero with nothing held/listed', s.agingBuckets.reduce((a, b) => a + b.count, 0), 0);
}

console.log('\nagingBuckets — buy-anchored via injected now');
{
  const s = LedgerStats.summarize([
    held({ buyTimestamp: NOW - 1 * DAY }),    // 1d   → 0–3d
    listed({ buyTimestamp: NOW - 5 * DAY }),  // 5d   → 3–7d
    held({ buyTimestamp: NOW - 10 * DAY }),   // 10d  → 7–14d
    listed({ buyTimestamp: NOW - 20 * DAY }), // 20d  → 14–30d
    held({ buyTimestamp: NOW - 45 * DAY }),   // 45d  → 30d+
    sold({ buyTimestamp: NOW - 99 * DAY }),   // sold → not in aging
    held({ buyTimestamp: undefined }),        // no stamp → dropped
  ], NOW);
  assertEq('0–3d', bucketCount(s.agingBuckets, '0–3d'), 1);
  assertEq('3–7d', bucketCount(s.agingBuckets, '3–7d'), 1);
  assertEq('7–14d', bucketCount(s.agingBuckets, '7–14d'), 1);
  assertEq('14–30d', bucketCount(s.agingBuckets, '14–30d'), 1);
  assertEq('30d+', bucketCount(s.agingBuckets, '30d+'), 1);
  assertEq('only held+listed with stamps counted', s.agingBuckets.reduce((a, b) => a + b.count, 0), 5);
}

// ── venue split (#310) ────────────────────────────────────────────────────────

console.log('\nvenueSplit — empty');
{
  const s = LedgerStats.summarize([held(), listed()], NOW);
  assertEq('market count 0', s.venueSplit.market.count, 0);
  assertEq('bazaar count 0', s.venueSplit.bazaar.count, 0);
  assertEq('other count 0', s.venueSplit.other.count, 0);
}

console.log('\nvenueSplit — populated by count and value');
{
  const s = LedgerStats.summarize([
    sold({ soldVenue: 'market', buyPrice: 1000, saleNet: 1500 }),
    sold({ soldVenue: 'market', buyPrice: 1000, saleNet: 2000 }),
    sold({ soldVenue: 'bazaar', buyPrice: 1000, saleNet: 1200 }),
    sold({ soldVenue: null,     buyPrice: 1000, saleNet: 900 }),
  ], NOW);
  assertEq('market count', s.venueSplit.market.count, 2);
  assertEq('market value', s.venueSplit.market.value, 3500);
  assertEq('bazaar count', s.venueSplit.bazaar.count, 1);
  assertEq('bazaar value', s.venueSplit.bazaar.value, 1200);
  assertEq('unknown venue → other', s.venueSplit.other.count, 1);
  assertEq('other value', s.venueSplit.other.value, 900);
}

// ── per-status rollups (#337) ─────────────────────────────────────────────────

console.log('\nbyStatus — empty');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('held count 0', s.byStatus.held.count, 0);
  assertEq('held cost 0', s.byStatus.held.cost, 0);
  assertEq('listed count 0', s.byStatus.listed.count, 0);
  assertEq('listed askValue 0', s.byStatus.listed.askValue, 0);
  assertEq('sold count 0', s.byStatus.sold.count, 0);
}

console.log('\nbyStatus — counts and value totals');
{
  const s = LedgerStats.summarize([
    held({ buyPrice: 1000 }),
    held({ buyPrice: 2500 }),
    listed({ buyPrice: 4000, listPrice: 6000 }),
    listed({ buyPrice: 3000, listPrice: 5000 }),
    sold(),
    sold(),
    sold(),
  ], NOW);
  assertEq('held count', s.byStatus.held.count, 2);
  assertEq('held cost sums buyPrice', s.byStatus.held.cost, 3500);
  assertEq('listed count', s.byStatus.listed.count, 2);
  assertEq('listed askValue sums listPrice', s.byStatus.listed.askValue, 11000);
  assertEq('sold count (status-keyed)', s.byStatus.sold.count, 3);
}

console.log('\nbyStatus — unset listPrice contributes 0, never NaN');
{
  const s = LedgerStats.summarize([
    listed({ buyPrice: 1000, listPrice: null }),       // unset → 0 askValue
    listed({ buyPrice: 1000, listPrice: undefined }),  // unset → 0 askValue
    listed({ buyPrice: 1000, listPrice: 2500 }),       // the only priced one
  ], NOW);
  assertEq('listed count includes unpriced rows', s.byStatus.listed.count, 3);
  assertEq('askValue counts only the finite listPrice', s.byStatus.listed.askValue, 2500);
  assert('askValue finite (no NaN)', Number.isFinite(s.byStatus.listed.askValue));
}

console.log('\nbyStatus — sold count ignores saleNet finiteness');
{
  // soldCount filters by finite saleNet; the chip count is purely status-keyed.
  const s = LedgerStats.summarize([sold({ saleNet: null }), sold({ saleNet: 1400 })], NOW);
  assertEq('soldCount drops the unpriced sale', s.soldCount, 1);
  assertEq('byStatus.sold counts both', s.byStatus.sold.count, 2);
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
