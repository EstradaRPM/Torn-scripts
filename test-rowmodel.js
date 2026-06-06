// node test-rowmodel.js
// Tests for RowModel.forItem (issues #336 slice a, #338 slice b) — the pure
// per-row projection a ledger row renders:
// { status, buy, ask, net, roiPct, roiKind, age, belowCost }. Mirrors
// test-ledgerstats.js's plain-assert style and loads the shipped .user.js
// directly (ADR-0002 seam) so the real code is exercised. External behavior
// only: feed an item + injected now, assert the projection.

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

const { RowModel } = globalThis.__RwthPure;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assertEq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function held(over = {})   { return { status: 'held',   itemName: 'Item', buyPrice: 1000, buyTimestamp: NOW - 3 * DAY, ...over }; }
function listed(over = {}) { return { status: 'listed', itemName: 'Item', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW - 3 * DAY, ...over }; }
function sold(over = {})   {
  return {
    status: 'sold', itemName: 'Item', buyPrice: 1000, listPrice: 1500,
    saleNet: 1450, saleFees: 50,
    buyTimestamp: NOW - 5 * DAY, soldTimestamp: NOW, ...over,
  };
}

// ── held: buy present, ask + net are not-set ──────────────────────────────────

console.log('\nheld row');
{
  const m = RowModel.forItem(held(), NOW);
  assertEq('status held', m.status, 'held');
  assertEq('buy = buyPrice', m.buy, 1000);
  assertEq('ask null (no listPrice)', m.ask, null);
  assertEq('net null (not sold)', m.net, null);
  assertEq('age = buy-anchored span', m.age, 3);
  assertEq('held: no ROI kind', m.roiKind, null);
  assertEq('held: roiPct null', m.roiPct, null);
  assertEq('held: not below cost', m.belowCost, false);
}

// ── listed: buy + ask present, net not-set ────────────────────────────────────

console.log('\nlisted row');
{
  const m = RowModel.forItem(listed(), NOW);
  assertEq('status listed', m.status, 'listed');
  assertEq('buy present', m.buy, 1000);
  assertEq('ask = listPrice', m.ask, 1500);
  assertEq('net null (not sold)', m.net, null);
  assertEq('age buy-anchored', m.age, 3);
  assertEq('listed: projected ROI kind', m.roiKind, 'projected');
  assertEq('listed: projected ROI off (ask-buy)/buy', m.roiPct, 0.5);
  assertEq('listed above cost: not below cost', m.belowCost, false);
}

// ── sold: all three legs present ──────────────────────────────────────────────

console.log('\nsold row');
{
  const m = RowModel.forItem(sold(), NOW);
  assertEq('status sold', m.status, 'sold');
  assertEq('buy present', m.buy, 1000);
  assertEq('ask = listPrice still present', m.ask, 1500);
  assertEq('net = saleNet', m.net, 1450);
  assertEq('age buy-anchored (now - buy, not sold span)', m.age, 5);
  assertEq('sold: realized ROI kind', m.roiKind, 'realized');
  assertEq('sold: realized ROI off (net-buy)/buy', m.roiPct, 0.45);
  assertEq('sold: never below cost', m.belowCost, false);
}

// ── below-cost: a listed ask below buy flags belowCost (loud loss marker) ──────

console.log('\nlisted below cost');
{
  const m = RowModel.forItem(listed({ listPrice: 800 }), NOW);
  assertEq('ask reflects the low list price', m.ask, 800);
  assertEq('buy unchanged', m.buy, 1000);
  assertEq('ask < buy -> belowCost true', m.belowCost, true);
  assertEq('still projected (listed)', m.roiKind, 'projected');
  assertEq('projected ROI is the negative margin', m.roiPct, -0.2);

  const mEq = RowModel.forItem(listed({ listPrice: 1000 }), NOW);
  assertEq('ask == buy -> NOT below cost', mEq.belowCost, false);
  assertEq('ask == buy -> ROI 0', mEq.roiPct, 0);

  const mHeldLow = RowModel.forItem(held({ listPrice: 800 }), NOW);
  assertEq('held with a stray low list price -> never below cost', mHeldLow.belowCost, false);

  const mSoldLow = RowModel.forItem(sold({ listPrice: 800, saleNet: 700 }), NOW);
  assertEq('sold -> never below cost (realized, not a live ask)', mSoldLow.belowCost, false);
}

// ── ROI is null (no kind, no NaN) when there is no basis or the leg is missing ─

console.log('\nROI null cases');
{
  const mNoAsk = RowModel.forItem(listed({ listPrice: null }), NOW);
  assertEq('listed missing ask -> roiKind null', mNoAsk.roiKind, null);
  assertEq('listed missing ask -> roiPct null', mNoAsk.roiPct, null);

  const mNoNet = RowModel.forItem(sold({ saleNet: null }), NOW);
  assertEq('sold missing net -> roiKind null', mNoNet.roiKind, null);
  assertEq('sold missing net -> roiPct null', mNoNet.roiPct, null);

  const mZeroBuy = RowModel.forItem(listed({ buyPrice: 0 }), NOW);
  assertEq('zero buy -> roiPct null (no divide-by-zero)', mZeroBuy.roiPct, null);
  assertEq('zero buy -> roiKind null', mZeroBuy.roiKind, null);

  const mNoBuy = RowModel.forItem(listed({ buyPrice: null }), NOW);
  assertEq('absent buy -> roiPct null', mNoBuy.roiPct, null);
  assertEq('absent buy -> roiKind null', mNoBuy.roiKind, null);
  assert('zero/absent buy never yields NaN ROI',
    [mZeroBuy.roiPct, mNoBuy.roiPct].every(v => v === null || Number.isFinite(v)));
}

// ── not-set discipline: null / '' never coerced to 0 ──────────────────────────

console.log('\nnot-set discipline');
{
  const mAsk = RowModel.forItem(listed({ listPrice: null }), NOW);
  assertEq('null listPrice -> ask null, not 0', mAsk.ask, null);

  const mEmpty = RowModel.forItem(listed({ listPrice: '' }), NOW);
  assertEq("'' listPrice -> ask null (not coerced)", mEmpty.ask, null);

  const mNet = RowModel.forItem(sold({ saleNet: null }), NOW);
  assertEq('null saleNet -> net null, not 0', mNet.net, null);

  const mBuy = RowModel.forItem(held({ buyPrice: null }), NOW);
  assertEq('null buyPrice -> buy null, not 0', mBuy.buy, null);

  const mZero = RowModel.forItem(held({ buyPrice: 0 }), NOW);
  assertEq('finite 0 buy stays 0 (a real value, not a sentinel)', mZero.buy, 0);
}

// ── age edge cases: non-finite / out-of-order never negative ───────────────────

console.log('\nage guards');
{
  const mNoStamp = RowModel.forItem(held({ buyTimestamp: null }), NOW);
  assertEq('non-finite buy stamp -> age null', mNoStamp.age, null);

  const mFuture = RowModel.forItem(held({ buyTimestamp: NOW + 2 * DAY }), NOW);
  assertEq('out-of-order stamp -> age null (never negative)', mFuture.age, null);

  const mNaN = RowModel.forItem(held({ buyTimestamp: NaN }), NOW);
  assertEq('NaN stamp -> age null', mNaN.age, null);

  const mSame = RowModel.forItem(held({ buyTimestamp: NOW }), NOW);
  assertEq('same instant -> age 0', mSame.age, 0);

  const mBadNow = RowModel.forItem(held(), NaN);
  assertEq('non-finite now -> age null', mBadNow.age, null);
}

// ── partial / garbage records never throw or yield NaN ─────────────────────────

console.log('\npartial records');
{
  const m = RowModel.forItem({ status: 'held' }, NOW);
  assertEq('bare item: buy null', m.buy, null);
  assertEq('bare item: ask null', m.ask, null);
  assertEq('bare item: net null', m.net, null);
  assertEq('bare item: age null', m.age, null);

  assertEq('bare item: roiPct null', m.roiPct, null);
  assertEq('bare item: roiKind null', m.roiKind, null);
  assertEq('bare item: not below cost', m.belowCost, false);

  const mNull = RowModel.forItem(null, NOW);
  assertEq('null item: status undefined, no throw', mNull.status, undefined);
  assert('no NaN in any leg', [mNull.buy, mNull.ask, mNull.net, mNull.age, mNull.roiPct]
    .every(v => v === null || Number.isFinite(v)));
  assertEq('null item: not below cost', mNull.belowCost, false);

  const mStr = RowModel.forItem(held({ buyPrice: '1000' }), NOW);
  assertEq('numeric-string buyPrice -> null (strings are not finite numbers)', mStr.buy, null);
}

// ── aging band span values (consumed by a later slice, but age must be exact) ──

console.log('\nage spans');
{
  assertEq('13 days', RowModel.forItem(held({ buyTimestamp: NOW - 13 * DAY }), NOW).age, 13);
  assertEq('30 days', RowModel.forItem(held({ buyTimestamp: NOW - 30 * DAY }), NOW).age, 30);
}

// ── summary ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
