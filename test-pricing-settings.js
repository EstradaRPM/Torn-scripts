// node test-pricing-settings.js
// Tests for the #330 intel->engine settings bridge. Mirrors test-advconfig.js:
// requires the shipped .user.js directly (ADR-0002 seam) so the real code is
// exercised, reads PricingEngine off __RwthPure, and asserts external behavior
// only — feed an intel object, assert the resolved friction settings; feed a
// non-default margin/mug, assert the bid moves the right way.

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

const { PricingEngine } = globalThis.__RwthPure;

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

// ── resolveSettings — percent->fraction conversion ────────────────────────────
// Intel stores integer percents; the engine wants fractions. The conversion
// lives only in resolveSettings.

console.log('\nresolveSettings — integer percents convert to fractions');
{
  const s = PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 5 });
  assertEq('mugBuffer 10 -> mug 0.10', s.mug, 0.10);
  assertEq('marginTarget 5 -> margin 0.05', s.margin, 0.05);
  assertEq('tax is the fixed 5% default', s.tax, 0.05);
  assert('default deduction is ~0.80 (~20% cut)',
    Math.abs((1 - s.tax - s.mug - s.margin) - 0.80) < 1e-9);
}

console.log('\nresolveSettings — non-default percents convert too');
{
  const s = PricingEngine.resolveSettings({ mugBuffer: 20, marginTarget: 15 });
  assertEq('mugBuffer 20 -> mug 0.20', s.mug, 0.20);
  assertEq('marginTarget 15 -> margin 0.15', s.margin, 0.15);
}

// ── resolveSettings — missing keys fall back to engine defaults ───────────────

console.log('\nresolveSettings — missing keys fall back to engine defaults');
{
  for (const bad of [undefined, null, {}, 'nope', 42]) {
    const s = PricingEngine.resolveSettings(bad);
    assertEq(`tax default 0.05 for ${JSON.stringify(bad)}`, s.tax, 0.05);
    assertEq(`mug default 0.10 for ${JSON.stringify(bad)}`, s.mug, 0.10);
    assertEq(`margin default 0.05 for ${JSON.stringify(bad)}`, s.margin, 0.05);
  }
  const partial = PricingEngine.resolveSettings({ mugBuffer: 25 });
  assertEq('present key honored while missing one falls back', partial.mug, 0.25);
  assertEq('missing marginTarget falls back to 0.05', partial.margin, 0.05);
}

console.log('\nresolveSettings — non-numeric percents fall back, not NaN');
{
  const s = PricingEngine.resolveSettings({ mugBuffer: 'x', marginTarget: undefined });
  assertEq('garbage mugBuffer falls back to 0.10', s.mug, 0.10);
  assertEq('missing marginTarget falls back to 0.05', s.margin, 0.05);
}

console.log('\nresolveSettings — an explicit 0 is honored, not treated as missing');
{
  const s = PricingEngine.resolveSettings({ mugBuffer: 0, marginTarget: 0 });
  assertEq('mugBuffer 0 -> mug 0 (no cushion)', s.mug, 0);
  assertEq('marginTarget 0 -> margin 0 (no profit reserve)', s.margin, 0);
}

console.log('\nresolveSettings — carries a compClampRatio for the engine');
{
  const s = PricingEngine.resolveSettings({});
  assert('compClampRatio is a positive number', typeof s.compClampRatio === 'number' && s.compClampRatio > 0);
}

// ── auctionPlan honors a non-default margin/mug ───────────────────────────────
// Guards against re-introducing the disconnect: the resolved friction must move
// the max bid. comps are kept well under typical*ratio so the #328 clamp never
// fires and we measure the friction cut alone.

const PLAN_COMPS = [{ price: 700 }, { price: 750 }, { price: 800 }]; // median 750, min 700
const RESALE = 1000;

console.log('\nauctionPlan — a higher profit goal lowers the max bid');
{
  const base = PricingEngine.auctionPlan({ comps: PLAN_COMPS, bazaarResale: RESALE,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 5 }) });
  const greedy = PricingEngine.auctionPlan({ comps: PLAN_COMPS, bazaarResale: RESALE,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 15 }) });
  assertEq('default 20% cut -> maxBid 800', base.maxBid, 800);
  assertEq('30% cut -> maxBid 700', greedy.maxBid, 700);
  assert('higher profit goal lowers maxBid', greedy.maxBid < base.maxBid);
  assert('neither bid was comp-clamped', base.clamped === false && greedy.clamped === false);
}

console.log('\nauctionPlan — a higher mug cushion lowers the max bid');
{
  const base = PricingEngine.auctionPlan({ comps: PLAN_COMPS, bazaarResale: RESALE,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 5 }) });
  const cautious = PricingEngine.auctionPlan({ comps: PLAN_COMPS, bazaarResale: RESALE,
    settings: PricingEngine.resolveSettings({ mugBuffer: 20, marginTarget: 5 }) });
  assertEq('higher cushion -> 30% cut -> maxBid 700', cautious.maxBid, 700);
  assert('higher mug cushion lowers maxBid', cautious.maxBid < base.maxBid);
}

console.log('\nauctionPlan — the assault zero-friction override takes no cut');
{
  const plan = PricingEngine.auctionPlan({ comps: PLAN_COMPS, bazaarResale: RESALE,
    settings: { tax: 0, mug: 0, margin: 0 } });
  // typical (750) * default ratio (1.5) = 1125 >= 1000, so the comp clamp does
  // not mask the no-cut result: maxBid is the full resale anchor.
  assertEq('zero friction -> maxBid equals the resale anchor', plan.maxBid, RESALE);
  assertEq('zero-friction plan is not comp-clamped', plan.clamped, false);
}

// ── deductionChain honors a non-default margin/mug ────────────────────────────

console.log('\ndeductionChain — a higher profit goal lowers the buy max');
{
  const base = PricingEngine.deductionChain({ anchor: 1000,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 5 }) });
  const greedy = PricingEngine.deductionChain({ anchor: 1000,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 15 }) });
  assertEq('default 20% cut -> buyMax 800', base.buyMax, 800);
  assertEq('30% cut -> buyMax 700', greedy.buyMax, 700);
  assert('higher profit goal lowers buyMax', greedy.buyMax < base.buyMax);
}

console.log('\ndeductionChain — a higher mug cushion lowers the buy max');
{
  const base = PricingEngine.deductionChain({ anchor: 1000,
    settings: PricingEngine.resolveSettings({ mugBuffer: 10, marginTarget: 5 }) });
  const cautious = PricingEngine.deductionChain({ anchor: 1000,
    settings: PricingEngine.resolveSettings({ mugBuffer: 20, marginTarget: 5 }) });
  assert('higher mug cushion lowers buyMax', cautious.buyMax < base.buyMax);
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
