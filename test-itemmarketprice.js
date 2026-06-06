// node test-itemmarketprice.js
// Tests for itemMarketListPrice (issue #331) — the pure item-market gross-up.
// Mirrors test-advconfig.js: requires the shipped .user.js directly (ADR-0002
// seam), reads the function off __RwthPure, and asserts external behavior only.
//
// Contract: gross = net / ((1 − fee) × (1 − mug)), snapped to a round number
// whose net is within ~1% of the ask. With mug 0 (the default) the divisor
// collapses to (1 − fee) and the result is byte-identical to the fee-only path.

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

const { itemMarketListPrice } = globalThis.__RwthPure;

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

const FEE = 0.05;

// ── mug 0 is byte-identical to the fee-only path ──────────────────────────────

console.log('\nmug 0 — byte-identical to the fee-only price');
{
  for (const net of [100, 1e6, 12_500_000, 87_300_000, 1, 999, 1.5e9]) {
    const feeOnly = itemMarketListPrice(net);
    assertEq(`net ${net}: explicit mug 0 matches fee-only`, itemMarketListPrice(net, null, 0), feeOnly);
    assertEq(`net ${net}: undefined mug matches fee-only`, itemMarketListPrice(net, null, undefined), feeOnly);
    assertEq(`net ${net}: negative mug clamps to 0`, itemMarketListPrice(net, null, -0.1), feeOnly);
    assertEq(`net ${net}: NaN mug clamps to 0`, itemMarketListPrice(net, null, NaN), feeOnly);
  }
}

// ── a $100 net at 8% cushion grosses up to a higher round number ──────────────

console.log('\nworked example — $100 net, 8% cushion');
{
  assertEq('fee-only $100 nets a clean $105', itemMarketListPrice(100), 105);
  const grossed = itemMarketListPrice(100, null, 0.08);
  assert('8% cushion lists higher than the fee-only price', grossed > 105);
  // gross-up target before snapping is net / ((1−fee)(1−mug)) ≈ 114.42.
  assert('grossed price sits near the ~114 pre-snap target', grossed >= 110 && grossed <= 120);
}

// ── the snapped gross still nets the ask after BOTH fee and mug ────────────────

console.log('\ninvariant — snapped gross nets the ask within 1% after fee + mug');
{
  for (const mug of [0, 0.05, 0.08, 0.1, 0.25]) {
    for (const net of [100, 5e6, 42_000_000, 250_000_000]) {
      const gross = itemMarketListPrice(net, null, mug);
      const netAfter = gross * (1 - FEE) * (1 - mug);
      assert(`net ${net} @ mug ${mug}: post-fee+mug net within 1% of ask`,
        Math.abs(netAfter - net) <= net * 0.01 + 1e-6);
    }
  }
}

// ── a larger cushion never lowers the gross ───────────────────────────────────

console.log('\nmonotonic — a bigger mug cushion never lowers the listing');
{
  for (const net of [100, 7_500_000, 130_000_000]) {
    const a = itemMarketListPrice(net, null, 0);
    const b = itemMarketListPrice(net, null, 0.08);
    const c = itemMarketListPrice(net, null, 0.2);
    assert(`net ${net}: 0 ≤ 8% ≤ 20% cushion grosses are non-decreasing`, a <= b && b <= c);
  }
}

// ── missing / non-positive list price returns null regardless of mug ──────────

console.log('\nguards — missing / non-positive list price returns null');
{
  for (const bad of [null, undefined, 0, -5, NaN, 'nope', {}]) {
    assertEq(`list price ${JSON.stringify(bad)} returns null`, itemMarketListPrice(bad, null, 0.08), null);
  }
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
