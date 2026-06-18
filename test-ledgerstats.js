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

function assertFiniteDeep(label, value) {
  const seen = new Set();
  function walk(v) {
    if (typeof v === 'number') return Number.isFinite(v);
    if (!v || typeof v !== 'object') return true;
    if (seen.has(v)) return true;
    seen.add(v);
    return Object.values(v).every(walk);
  }
  assert(label, walk(value));
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

// ── profit projection forecast (#358) ────────────────────────────────────────

console.log('\nprofitProjection — sold rows stay authoritative');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, listPrice: 999999, saleNet: 1400, soldTimestamp: NOW }),
    sold({ buyPrice: 2000, listPrice: 1, saleNet: 1500, soldTimestamp: NOW + DAY }),
  ], NOW + DAY);
  assertEq('realized cumulative point 1 uses saleNet - buyPrice', s.profitProjection.realized[0].cumulative, 400);
  assertEq('realized cumulative point 2 uses saleNet - buyPrice', s.profitProjection.realized[1].cumulative, 400 - 500);
  assertEq('forecast series includes the realized points', s.profitProjection.series.length, 2);
  assertEq('no listed rows -> no projections', s.profitProjection.projected.length, 0);
}

console.log('\nprofitProjection — listed ask-derived points');
{
  // Sales span 8 days (first at NOW-8d, last at NOW-2d), total realized 1300.
  // Pace = 1300 / 8 elapsed days = 162.5/d.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 1500, buyTimestamp: NOW - 10 * DAY, soldTimestamp: NOW - 8 * DAY }),
    sold({ buyPrice: 1000, saleNet: 1800, buyTimestamp: NOW - 8 * DAY, soldTimestamp: NOW - 2 * DAY }),
    listed({ id: 'future', itemName: 'Future ask', buyPrice: 2000, listPrice: 2600, buyTimestamp: NOW - DAY }),
    listed({ id: 'stale', itemName: 'Stale ask', buyPrice: 3000, listPrice: 3300, buyTimestamp: NOW - 20 * DAY }),
  ], NOW);
  const projected = s.profitProjection.projected;
  assertEq('avg clear time comes from sold rows', s.avgDaysToClear, 4);
  assertEq('two finite listed rows project', projected.length, 2);
  assertEq('future listed profit is ask - buy', projected.find(p => p.id === 'future').profit, 600);
  assertEq('future listed expected sell date is buy + avg clear', projected.find(p => p.id === 'future').t, NOW + 3 * DAY);
  assertEq('stale expected sell date clamps to now', projected.find(p => p.id === 'stale').t, NOW);
  assertEq('stale projection records the clamp basis', projected.find(p => p.id === 'stale').timing, 'avg-clear-clamped');
  assertEq('final forecast adds projected profits to realized baseline',
    s.profitProjection.series[s.profitProjection.series.length - 1].cumulative,
    s.realized + 300 + 600);
  assertEq('listed floor keeps ask profit over avg clear time', Math.round(s.profitProjection.listedDailyProfit), 225);
  assertEq('elapsed days span first sale to now', s.profitProjection.elapsedDays, 8);
  assertEq('paced profit is total realized', s.profitProjection.pacedProfit, 1300);
  assertEq('paced sold count', s.profitProjection.pacedSoldCount, 2);
  assertEq('realized pace = total profit / elapsed days', Math.round(s.profitProjection.realizedDailyProfit), 163);
  assertEq('forecast basis is realized history only', s.profitProjection.forecastBasis, 'history');
  assertEq('daily pace = realizedDaily x 1', s.profitProjection.periods.find(p => p.key === 'day').profit, 163);
  assertEq('weekly pace = realizedDaily x 7', s.profitProjection.periods.find(p => p.key === 'week').profit, 1138);
  assertEq('monthly pace = realizedDaily x 30', s.profitProjection.periods.find(p => p.key === 'month').profit, 4875);
  assertEq('quarterly pace = realizedDaily x 90', s.profitProjection.periods.find(p => p.key === 'quarter').profit, 14625);
  assertEq('yearly pace = realizedDaily x 365', s.profitProjection.periods.find(p => p.key === 'year').profit, 59313);
}

console.log('\nprofitProjection — pace decays as elapsed days grow without a sale');
{
  // Same $1000 of realized profit, viewed at two different "now"s: 18 days and
  // 22 days after the single sale. The monthly pace eases down as days accrue.
  const base = [sold({ buyPrice: 1000, saleNet: 2000, buyTimestamp: NOW - 19 * DAY, soldTimestamp: NOW - 18 * DAY })];
  const at18 = LedgerStats.summarize(base, NOW);
  const at22 = LedgerStats.summarize(base, NOW + 4 * DAY);
  assertEq('elapsed days at first read', at18.profitProjection.elapsedDays, 18);
  assertEq('elapsed days four days later', at22.profitProjection.elapsedDays, 22);
  assertEq('monthly pace at 18 days = 1000/18*30', at18.profitProjection.periods.find(p => p.key === 'month').profit, 1667);
  assertEq('monthly pace at 22 days = 1000/22*30', at22.profitProjection.periods.find(p => p.key === 'month').profit, 1364);
  assert('pace decayed with no new sale',
    at22.profitProjection.realizedDailyProfit < at18.profitProjection.realizedDailyProfit);
}

console.log('\nprofitProjection — realized pace can lift a thin listed floor');
{
  // 5 sales over 4 elapsed days (NOW-6d first, NOW-2d last), total 6300.
  // Pace = 6300 / (NOW - (NOW-6d)) = 6300 / 6 = 1050/d, well above the listed floor.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 2500, soldTimestamp: NOW - 6 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2400, soldTimestamp: NOW - 5 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2300, soldTimestamp: NOW - 4 * DAY }),
    sold({ buyPrice: 1000, saleNet: 2200, soldTimestamp: NOW - 3 * DAY }),
    sold({ buyPrice: 1000, saleNet: 1900, soldTimestamp: NOW - 2 * DAY }),
    listed({ id: 'thin', buyPrice: 1000, listPrice: 1700, buyTimestamp: NOW - DAY }),
  ], NOW);
  assertEq('listed floor is low with one current ask', Math.round(s.profitProjection.listedDailyProfit), 100);
  assertEq('elapsed days span first sale to now', s.profitProjection.elapsedDays, 6);
  assertEq('realized pace = 6300 / 6 elapsed days', Math.round(s.profitProjection.realizedDailyProfit), 1050);
  assertEq('basis is realized history even when listed pipeline exists', s.profitProjection.forecastBasis, 'history');
  assert('realized daily forecast is above the listed floor',
    s.profitProjection.dailyProfit > s.profitProjection.listedDailyProfit);
  assertEq('monthly forecast = pace x 30', s.profitProjection.periods.find(p => p.key === 'month').profit, 31500);
}

console.log('\nprofitProjection — mugLoss reduces realized pace when present');
{
  // Single sale 10 days ago: gross flip 2000, mug 600 → realized 1400 over 10
  // elapsed days = 140/d. Without the mug it would pace at 200/d.
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 3000, mugLoss: 600, soldTimestamp: NOW - 10 * DAY }),
  ], NOW);
  const noMug = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 3000, soldTimestamp: NOW - 10 * DAY }),
  ], NOW);
  assertEq('realized P/L subtracts mugLoss', s.realized, 1400);
  assertEq('cumulative realized point subtracts mugLoss', s.profitProjection.realized[0].cumulative, 1400);
  assertEq('realized pace subtracts mugLoss (1400 / 10 days)', Math.round(s.profitProjection.realizedDailyProfit), 140);
  assertEq('monthly forecast includes mugLoss-adjusted realized P/L', s.profitProjection.periods.find(p => p.key === 'month').profit, 4200);
  assert('mug drags the pace below the no-mug case',
    s.profitProjection.realizedDailyProfit < noMug.profitProjection.realizedDailyProfit);
}

console.log('\nprofitProjection — invalid input stays finite');
{
  const s = LedgerStats.summarize([
    listed({ id: 'missing-ask', buyPrice: 1000, listPrice: null }),
    listed({ id: 'missing-buy', buyPrice: null, listPrice: 1500 }),
    listed({ id: 'bad-ask', buyPrice: 1000, listPrice: Infinity }),
    listed({ id: 'bad-buy', buyPrice: NaN, listPrice: 1500 }),
    listed({ id: 'valid-no-stamp', buyPrice: 1000, listPrice: 1300, buyTimestamp: undefined }),
  ], NOW);
  assertEq('invalid price legs do not create fake zero-profit projections', s.profitProjection.projected.length, 1);
  assertEq('valid no-stamp projection keeps ask-derived profit', s.profitProjection.projected[0].profit, 300);
  assertEq('missing timing falls back to now', s.profitProjection.projected[0].t, NOW);
  assertEq('no clear history uses seven-day pace fallback', s.profitProjection.clearDays, 7);
  assertEq('listed ask alone does not create growth pace', s.profitProjection.periods.find(p => p.key === 'day').profit, 0);
  assertEq('listed ask alone leaves no operating forecast basis', s.profitProjection.forecastBasis, 'none');
  assertFiniteDeep('forecast contains no NaN/Infinity', s.profitProjection);
}

console.log('\nprofitProjection — invalid now still safe');
{
  const s = LedgerStats.summarize([
    listed({ id: 'no-clock', buyPrice: 1000, listPrice: 1500, buyTimestamp: undefined }),
  ], NaN);
  assertEq('projection still exists for finite prices', s.profitProjection.projected.length, 1);
  assertEq('fallback timestamp is finite zero when no time source exists', s.profitProjection.projected[0].t, 0);
  assertFiniteDeep('invalid now does not leak NaN', s.profitProjection);
}

// ── mug-loss headline (mugLossTotal / mugRoiPct) ─────────────────────────────

console.log('\nmug losses — none logged');
{
  const s = LedgerStats.summarize([sold({ buyPrice: 1000, saleNet: 1500 })], NOW);
  assertEq('mugLossTotal 0 when no mugs', s.mugLossTotal, 0);
  assertEq('mugRoiPct 0 when no mugs', s.mugRoiPct, 0);
}

console.log('\nmug losses — surfaced as ROI drag');
{
  const s = LedgerStats.summarize([
    sold({ buyPrice: 1000, saleNet: 3000, mugLoss: 600 }),   // cost 1000, mug 600
    sold({ buyPrice: 1000, saleNet: 1500 }),                  // cost 1000, no mug
  ], NOW);
  assertEq('mugLossTotal sums matched mug cash', s.mugLossTotal, 600);
  // soldCost = 2000 → 600 / 2000 = 30% ROI lost.
  assertEq('mugRoiPct is mugLoss / cost basis', s.mugRoiPct, 30);
  // Equals the gap between gross ROI and the realized ROI it already nets.
  const grossRoi = round1(((3000 - 1000 + 1500 - 1000) / 2000) * 100);
  assertEq('mugRoiPct equals gross ROI minus realized ROI',
    s.mugRoiPct, round1(grossRoi - s.realizedRoiPct));
}

console.log('\nmug losses — empty ledger stays finite');
{
  const s = LedgerStats.summarize([], NOW);
  assertEq('mugLossTotal 0 on empty', s.mugLossTotal, 0);
  assertEq('mugRoiPct 0 on empty (no divide-by-zero)', s.mugRoiPct, 0);
}

function round1(n) { return Math.round(n * 10) / 10; }

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
