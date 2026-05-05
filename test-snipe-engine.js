// node test-snipe-engine.js
// Tests for the snipe tracker pure functions (issue #175 / PRD #173).
// Copy each function body here; keep in sync with the IIFE implementation.

'use strict';

// ── Constants (mirror the IIFE) ───────────────────────────────────────────────

const BLOCK_VALUE_PCT = 0.10; // volume block threshold = 10% of available capital

// ── Functions under test ──────────────────────────────────────────────────────

function computeAvailableCapital(vaultAmount, vaultFloorPct) {
  return vaultAmount * (1 - vaultFloorPct / 100);
}

function detectVolumeBlock(listings, abovePrice, blockValueThreshold) {
  const tiers = new Map();
  for (const l of listings) {
    if (l.price <= abovePrice) continue;
    tiers.set(l.price, (tiers.get(l.price) ?? 0) + l.quantity);
  }
  for (const [price, quantity] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
    if (price * quantity >= blockValueThreshold) return { price, quantity };
  }
  return null;
}

function computeSmartSellPosition(listings, snipePrice, availableCapital, trend) {
  const above = listings.filter(l => l.price > snipePrice).sort((a, b) => a.price - b.price);
  if (!above.length) return null;

  const blockValueThreshold = availableCapital * BLOCK_VALUE_PCT;

  if (trend === 'falling') {
    return above[0].price;
  }

  const block = detectVolumeBlock(above, snipePrice, blockValueThreshold);
  if (block) {
    return block.price - 1;
  }

  // P75 fallback of the full listing set
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  const p75idx = Math.floor(sorted.length * 0.75);
  const p75 = sorted[Math.min(p75idx, sorted.length - 1)].price;
  return Math.max(p75, above[0].price);
}

function calcWeightedScore(grossProfit, roi, baseROI) {
  return grossProfit * Math.min(roi / baseROI, 1.0);
}

function calcMugScenario(sellTarget, qty, buyPrice, mugPct) {
  const muggedNet = sellTarget * qty * (1 - mugPct / 100) - buyPrice * qty;
  return { muggedNet, isLoss: muggedNet < 0 };
}

function computeFairValue(listings) {
  if (!listings.length) return { p25: null, p50: null, p75: null };
  const sorted = [...listings].sort((a, b) => a.price - b.price);
  const n = sorted.length;
  return {
    p25: sorted[Math.floor(n * 0.25)].price,
    p50: sorted[Math.floor(n * 0.50)].price,
    p75: sorted[Math.floor(n * 0.75)].price,
  };
}

function computePollResult(mergedListings, item, availableCapital, snapshots, trend) {
  const { p25, p50, p75 } = computeFairValue(mergedListings.slice(0, 20));
  const iqr          = p75 - p25;
  const outlierFloor = Math.round(p25 - 1.5 * iqr);
  const outlierExcluded = mergedListings[0].price < outlierFloor && mergedListings[0].quantity < 100;
  const fairValue    = p50;

  const marketFlood = mergedListings.find(l => l.quantity >= 100 && l.price < fairValue) ?? null;

  const firstNonOutlierPrice = mergedListings.find(l => l.price >= outlierFloor)?.price ?? p25;
  const isFloodPlay = marketFlood != null
    && marketFlood.price <= firstNonOutlierPrice * 1.05
    && fairValue >= marketFlood.price * (1 + item.threshold / 100);

  const historicalFVs = (snapshots ?? [])
    .filter(s => s.fairValue != null)
    .map(s => s.fairValue)
    .sort((a, b) => a - b);
  let historicalMedian = null, historicalLow = null, historicalHigh = null;
  if (historicalFVs.length >= 3) {
    const mid = Math.floor(historicalFVs.length / 2);
    historicalMedian = historicalFVs.length % 2 !== 0
      ? historicalFVs[mid]
      : Math.round((historicalFVs[mid - 1] + historicalFVs[mid]) / 2);
    historicalLow  = historicalFVs[0];
    historicalHigh = historicalFVs[historicalFVs.length - 1];
  }

  const recommendedSellTarget = computeSmartSellPosition(
    mergedListings, mergedListings[0].price, availableCapital, trend ?? 'flat'
  );

  return {
    fairValue,
    p25,
    p75,
    outlierExcluded,
    outlierFloor,
    lowestListed:    mergedListings[0]?.price ?? null,
    lowestListedQty: mergedListings[0]?.price != null
      ? mergedListings.filter(l => l.price === mergedListings[0].price).reduce((s, l) => s + l.quantity, 0)
      : null,
    secondLowest:    mergedListings[1]?.price ?? null,
    listings:        mergedListings,
    marketFlood,
    isFloodPlay,
    historicalMedian,
    historicalLow,
    historicalHigh,
    recommendedSellTarget,
  };
}

function calcSnipeFrequency(snapshots, threshold, windowMs) {
  const cutoff = Date.now() - windowMs;
  const inWindow = snapshots.filter(s => s.ts >= cutoff).sort((a, b) => a.ts - b.ts);
  let count = 0;
  for (let i = 1; i < inWindow.length; i++) {
    const snipeThreshold = inWindow[i].fairValue * (1 - threshold / 100);
    const prev = inWindow[i - 1].lowestMarket ?? inWindow[i - 1].lowestListed;
    const curr = inWindow[i].lowestMarket ?? inWindow[i].lowestListed;
    if (prev != null && curr != null && prev >= snipeThreshold && curr < snipeThreshold) count++;
  }
  return count;
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

// ── computeAvailableCapital ───────────────────────────────────────────────────

console.log('\ncomputeAvailableCapital — Behavior 1: standard 10% floor');
{
  // vault=10_000_000, floor=10 → 10M × 0.90 = 9_000_000
  assertEq('returns 9M', computeAvailableCapital(10_000_000, 10), 9_000_000);
}

console.log('\ncomputeAvailableCapital — Behavior 2: zero vault amount');
{
  assertEq('returns 0', computeAvailableCapital(0, 10), 0);
}

console.log('\ncomputeAvailableCapital — Behavior 3: 100% floor → 0');
{
  assertEq('returns 0', computeAvailableCapital(10_000_000, 100), 0);
}

// ── detectVolumeBlock ─────────────────────────────────────────────────────────

console.log('\ndetectVolumeBlock — Behavior 1: empty listings → null');
{
  assert('returns null', detectVolumeBlock([], 100_000, 1_000_000) === null);
}

console.log('\ndetectVolumeBlock — Behavior 2: all listings at or below abovePrice → null');
{
  const listings = [
    { price: 80_000, quantity: 100 },
    { price: 100_000, quantity: 50 },
  ];
  // abovePrice=100_000 → neither qualifies (≤ not >)
  assert('returns null', detectVolumeBlock(listings, 100_000, 1_000_000) === null);
}

console.log('\ndetectVolumeBlock — Behavior 3: listings above abovePrice but none meet threshold → null');
{
  // price=200_000 × qty=4 = 800_000 < threshold=1_000_000
  const listings = [{ price: 200_000, quantity: 4 }];
  assert('returns null', detectVolumeBlock(listings, 100_000, 1_000_000) === null);
}

console.log('\ndetectVolumeBlock — Behavior 4: first qualifying tier mid-list returned');
{
  const listings = [
    { price: 110_000, quantity: 5 },   // 550_000 < 1_000_000 — skip
    { price: 200_000, quantity: 6 },   // 1_200_000 ≥ 1_000_000 — first hit
    { price: 300_000, quantity: 10 },  // would also qualify, but not first
  ];
  const result = detectVolumeBlock(listings, 100_000, 1_000_000);
  assertEq('returns price of first qualifying tier', result?.price, 200_000);
  assertEq('returns quantity of first qualifying tier', result?.quantity, 6);
}

console.log('\ndetectVolumeBlock — Behavior 5: first listing above abovePrice qualifies immediately');
{
  const listings = [{ price: 150_000, quantity: 10 }]; // 1_500_000 ≥ 1_000_000
  const result = detectVolumeBlock(listings, 100_000, 1_000_000);
  assertEq('returns that listing', result?.price, 150_000);
}

console.log('\ndetectVolumeBlock — Behavior 6: duplicate-price listings are aggregated before threshold check');
{
  // Two listings at 200_000 × 3 each = 600_000 each — individually below 1_000_000.
  // Aggregated: 200_000 × 6 = 1_200_000 ≥ 1_000_000 → should qualify.
  const listings = [
    { price: 200_000, quantity: 3 },
    { price: 200_000, quantity: 3 },
  ];
  const result = detectVolumeBlock(listings, 100_000, 1_000_000);
  assertEq('aggregated price', result?.price, 200_000);
  assertEq('aggregated quantity', result?.quantity, 6);
}

// ── computeSmartSellPosition ──────────────────────────────────────────────────

console.log('\ncomputeSmartSellPosition — Behavior 1: no listings above snipePrice → null');
{
  const listings = [{ price: 100_000, quantity: 10 }];
  assert('returns null', computeSmartSellPosition(listings, 100_000, 10_000_000, 'stable') === null);
}

console.log('\ncomputeSmartSellPosition — Behavior 2: falling trend → floor-anchored (first listing above snipePrice)');
{
  // snipePrice=100_000, listings above: 110_000 and 200_000
  // falling → return first above = 110_000
  const listings = [
    { price:  80_000, quantity:  5 },
    { price: 110_000, quantity:  3 },
    { price: 200_000, quantity: 50 }, // 200k×50=10M would qualify as block, but trend overrides
  ];
  assertEq('returns floor price', computeSmartSellPosition(listings, 100_000, 10_000_000, 'falling'), 110_000);
}

console.log('\ncomputeSmartSellPosition — Behavior 3: rising trend → just below first volume block');
{
  // availableCapital=10M, BLOCK_VALUE_PCT=0.10 → threshold=1_000_000
  // snipePrice=100_000; listings above: 110_000×5=550_000 (miss), 200_000×6=1_200_000 (hit)
  // rising → return block.price - 1 = 199_999
  const listings = [
    { price: 110_000, quantity:  5 },
    { price: 200_000, quantity:  6 },
  ];
  assertEq('returns block price - 1', computeSmartSellPosition(listings, 100_000, 10_000_000, 'rising'), 199_999);
}

console.log('\ncomputeSmartSellPosition — Behavior 4: stable trend → same block-anchored result as rising');
{
  const listings = [
    { price: 110_000, quantity:  5 },
    { price: 200_000, quantity:  6 },
  ];
  assertEq('returns block price - 1', computeSmartSellPosition(listings, 100_000, 10_000_000, 'stable'), 199_999);
}

console.log('\ncomputeSmartSellPosition — Behavior 5: no volume block qualifies → P75 fallback (≥ first above snipePrice)');
{
  // availableCapital=10M → threshold=1_000_000
  // All listings above snipePrice: 150_000×2=300_000, 180_000×3=540_000 — none qualify
  // P75 of full set [80k,150k,180k,180k,180k] at idx=3 → 180_000; > above[0]=150_000 ✓
  const listings = [
    { price:  80_000, quantity: 1 },
    { price: 150_000, quantity: 2 },
    { price: 180_000, quantity: 3 },
  ];
  const result = computeSmartSellPosition(listings, 100_000, 10_000_000, 'stable');
  assert('result is a number', typeof result === 'number');
  assert('result > snipePrice', result > 100_000);
}

console.log('\ncomputeSmartSellPosition — Behavior 6: result is never at or below snipePrice');
{
  // Ensure the invariant holds even when the P75 fallback is applied
  const listings = [
    { price: 105_000, quantity: 1 },
    { price: 106_000, quantity: 1 },
  ];
  const result = computeSmartSellPosition(listings, 100_000, 10_000_000, 'rising');
  assert('result > snipePrice', result > 100_000);
}

// ── calcWeightedScore ─────────────────────────────────────────────────────────

console.log('\ncalcWeightedScore — Behavior 1: grossProfit=0 → 0 regardless of roi');
{
  assertEq('returns 0', calcWeightedScore(0, 50, 2), 0);
}

console.log('\ncalcWeightedScore — Behavior 2: roi >= baseROI → full weight (returns grossProfit)');
{
  // roi=5, baseROI=2 → min(5/2,1)=1 → score = 100_000 × 1 = 100_000
  assertEq('returns grossProfit', calcWeightedScore(100_000, 5, 2), 100_000);
}

console.log('\ncalcWeightedScore — Behavior 3: roi < baseROI → partial weight');
{
  // roi=1, baseROI=2 → min(0.5,1)=0.5 → score = 100_000 × 0.5 = 50_000
  assertEq('returns scaled score', calcWeightedScore(100_000, 1, 2), 50_000);
}

console.log('\ncalcWeightedScore — Behavior 4: negative roi → negative score (not a positive rank)');
{
  // roi=-1, baseROI=2 → min(-0.5,1)=-0.5 → score = 100_000 × -0.5 = -50_000
  assertEq('returns negative score', calcWeightedScore(100_000, -1, 2), -50_000);
}

// ── calcMugScenario ───────────────────────────────────────────────────────────

console.log('\ncalcMugScenario — Behavior 1: standard case — positive net after mugging');
{
  // sellTarget=200_000, qty=10, buyPrice=150_000, mugPct=15
  // muggedNet = 200_000×10×0.85 − 150_000×10 = 1_700_000 − 1_500_000 = 200_000
  const r = calcMugScenario(200_000, 10, 150_000, 15);
  assertEq('muggedNet', r.muggedNet, 200_000);
  assertEq('isLoss false', r.isLoss, false);
}

console.log('\ncalcMugScenario — Behavior 2: isLoss true when muggedNet is negative');
{
  // sellTarget=100_000, qty=5, buyPrice=120_000, mugPct=15
  // muggedNet = 100_000×5×0.85 − 120_000×5 = 425_000 − 600_000 = −175_000
  const r = calcMugScenario(100_000, 5, 120_000, 15);
  assertEq('muggedNet', r.muggedNet, -175_000);
  assertEq('isLoss true', r.isLoss, true);
}

console.log('\ncalcMugScenario — Behavior 3: mugPct=0 → net equals gross profit (no mug)');
{
  // sellTarget=200_000, qty=10, buyPrice=150_000, mugPct=0
  // muggedNet = 200_000×10×1.0 − 150_000×10 = 2_000_000 − 1_500_000 = 500_000
  const r = calcMugScenario(200_000, 10, 150_000, 0);
  assertEq('muggedNet equals gross profit', r.muggedNet, 500_000);
  assertEq('isLoss false', r.isLoss, false);
}

console.log('\ncalcMugScenario — Behavior 4: mugPct=100 → full wipe, net = −cost');
{
  // sellTarget=200_000, qty=10, buyPrice=150_000, mugPct=100
  // muggedNet = 200_000×10×0 − 150_000×10 = 0 − 1_500_000 = −1_500_000
  const r = calcMugScenario(200_000, 10, 150_000, 100);
  assertEq('muggedNet = −cost', r.muggedNet, -1_500_000);
  assertEq('isLoss true', r.isLoss, true);
}

console.log('\ncalcMugScenario — Behavior 5: isLoss false when muggedNet is exactly 0');
{
  // Find inputs where muggedNet = 0:
  // sellTarget×qty×(1-mugPct/100) = buyPrice×qty
  // 100_000×1×0.85 = 85_000; buyPrice×1 = 85_000
  const r = calcMugScenario(100_000, 1, 85_000, 15);
  assertEq('muggedNet = 0', r.muggedNet, 0);
  assertEq('isLoss false at break-even', r.isLoss, false);
}

// ── calcSnipeFrequency ────────────────────────────────────────────────────────

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const WINDOW = 7 * DAY;

console.log('\ncalcSnipeFrequency — Behavior 1: empty snapshots → 0');
{
  assertEq('returns 0', calcSnipeFrequency([], 10, WINDOW), 0);
}

console.log('\ncalcSnipeFrequency — Behavior 2: no threshold crossings → 0');
{
  // snapshot fairValue=100_000, threshold=10 → snipeThreshold=90_000
  // All snapshots have lowestListed well above 90_000 — no crossing ever occurs
  const snapshots = [
    { ts: NOW - 5 * DAY, fairValue: 100_000, lowestListed: 95_000 },
    { ts: NOW - 4 * DAY, fairValue: 100_000, lowestListed: 96_000 },
    { ts: NOW - 3 * DAY, fairValue: 100_000, lowestListed: 97_000 },
  ];
  assertEq('returns 0', calcSnipeFrequency(snapshots, 10, WINDOW), 0);
}

console.log('\ncalcSnipeFrequency — Behavior 3: multiple crossings counted correctly');
{
  // snipeThreshold = 100_000 × 0.90 = 90_000
  // Crossings at transitions: 95k→88k (cross), 92k→88k (already below, no cross), 93k→88k (cross)
  const snapshots = [
    { ts: NOW - 6 * DAY, fairValue: 100_000, lowestListed: 95_000 },  // above
    { ts: NOW - 5 * DAY, fairValue: 100_000, lowestListed: 88_000 },  // ← crossing 1
    { ts: NOW - 4 * DAY, fairValue: 100_000, lowestListed: 92_000 },  // above again
    { ts: NOW - 3 * DAY, fairValue: 100_000, lowestListed: 88_000 },  // ← crossing 2
    { ts: NOW - 2 * DAY, fairValue: 100_000, lowestListed: 88_000 },  // still below — no new crossing
  ];
  assertEq('returns 2', calcSnipeFrequency(snapshots, 10, WINDOW), 2);
}

console.log('\ncalcSnipeFrequency — Behavior 4: snapshots outside window excluded');
{
  // snipeThreshold = 90_000. One crossing inside window, one outside.
  const snapshots = [
    { ts: NOW - 8 * DAY, fairValue: 100_000, lowestListed: 95_000 },         // outside window
    { ts: NOW - 7 * DAY - 1, fairValue: 100_000, lowestListed: 88_000 },     // outside window — would be crossing but excluded
    { ts: NOW - 3 * DAY, fairValue: 100_000, lowestListed: 95_000 },         // inside window, above
    { ts: NOW - 2 * DAY, fairValue: 100_000, lowestListed: 88_000 },         // inside window ← crossing
  ];
  assertEq('returns 1 (only in-window crossing)', calcSnipeFrequency(snapshots, 10, WINDOW), 1);
}

console.log('\ncalcSnipeFrequency — Behavior 5: sustained snipe (stays below) counts as one crossing, not many');
{
  // snipeThreshold = 90_000. Price drops below and stays below for 3 polls.
  const snapshots = [
    { ts: NOW - 5 * DAY, fairValue: 100_000, lowestListed: 95_000 },  // above
    { ts: NOW - 4 * DAY, fairValue: 100_000, lowestListed: 85_000 },  // ← crossing 1
    { ts: NOW - 3 * DAY, fairValue: 100_000, lowestListed: 84_000 },  // still below — no new crossing
    { ts: NOW - 2 * DAY, fairValue: 100_000, lowestListed: 83_000 },  // still below — no new crossing
  ];
  assertEq('returns 1', calcSnipeFrequency(snapshots, 10, WINDOW), 1);
}

console.log('\ncalcSnipeFrequency — Behavior 6: per-snapshot fairValue — crossing threshold shifts with fairValue drift');
{
  // snapshot[i].fairValue is used per crossing check, not a global value
  // At day-5→4: fairValue=100_000 → threshold=90_000; price 95k→88k → crossing
  // At day-3→2: fairValue=80_000  → threshold=72_000;  price 92k→75k → crossing (75k < 72k is false — no cross)
  // At day-2→1: fairValue=80_000  → threshold=72_000;  price 75k→70k → crossing (70k < 72k is true — crossing)
  const snapshots = [
    { ts: NOW - 5 * DAY, fairValue: 100_000, lowestListed: 95_000 },  // above 90k
    { ts: NOW - 4 * DAY, fairValue: 100_000, lowestListed: 88_000 },  // ← crossing 1 (threshold=90k)
    { ts: NOW - 3 * DAY, fairValue: 80_000,  lowestListed: 92_000 },  // above 72k
    { ts: NOW - 2 * DAY, fairValue: 80_000,  lowestListed: 75_000 },  // above 72k — no crossing
    { ts: NOW - 1 * DAY, fairValue: 80_000,  lowestListed: 70_000 },  // ← crossing 2 (threshold=72k)
  ];
  assertEq('returns 2 (each crossing uses its own fairValue)', calcSnipeFrequency(snapshots, 10, WINDOW), 2);
}

console.log('\ncalcSnipeFrequency — Behavior 7: lowestMarket preferred over lowestListed when present');
{
  // snipeThreshold = 100_000 × 0.90 = 90_000
  // prev lowestMarket=95k, curr lowestMarket=88k → crossing via lowestMarket
  // lowestListed values would also cross, but we verify lowestMarket is used first
  const snapshots = [
    { ts: NOW - 2 * DAY, fairValue: 100_000, lowestMarket: 95_000, lowestListed: 95_000 },
    { ts: NOW - 1 * DAY, fairValue: 100_000, lowestMarket: 88_000, lowestListed: 91_000 },  // lowestListed above threshold
  ];
  assertEq('returns 1 (crossing via lowestMarket, not lowestListed)', calcSnipeFrequency(snapshots, 10, WINDOW), 1);
}

console.log('\ncalcSnipeFrequency — Behavior 8: legacy snapshots missing fairValue do not crash or distort count');
{
  // Snapshots pre-dating the fairValue field: fairValue is undefined → snipeThreshold=NaN → comparisons are false
  const snapshots = [
    { ts: NOW - 2 * DAY, lowestListed: 95_000 },  // no fairValue (legacy)
    { ts: NOW - 1 * DAY, lowestListed: 88_000 },  // no fairValue (legacy)
  ];
  assertEq('returns 0 (no crash, no distortion)', calcSnipeFrequency(snapshots, 10, WINDOW), 0);
}

// ── computePollResult ─────────────────────────────────────────────────────────

console.log('\ncomputePollResult — Flood detected: qty ≥ 100, at floor, FV above threshold');
{
  // fairValue (p50 of 20 cheapest) ≈ 1_000_000; flood at 800_000 with qty 200
  // threshold 10% → snipe threshold = 900_000; flood price 800_000 < 900_000 ✓
  // floor = cheapest non-outlier price = 800_000; flood ≤ floor × 1.05 ✓
  // FV 1_000_000 ≥ 800_000 × 1.10 = 880_000 ✓
  const listings = [
    { price: 800_000, quantity: 200 },  // flood listing
    ...Array.from({ length: 19 }, (_, i) => ({ price: 950_000 + i * 5_000, quantity: 1 })),
  ];
  const item     = { itemId: 1, threshold: 10 };
  const result   = computePollResult(listings, item, 10_000_000, [], 'flat');
  assert('isFloodPlay is true', result.isFloodPlay === true);
  assert('marketFlood is not null', result.marketFlood !== null);
  assert('marketFlood.price = 800_000', result.marketFlood.price === 800_000);
}

console.log('\ncomputePollResult — No flood when qty < 100');
{
  const listings = [
    { price: 800_000, quantity: 50 },   // small quantity — not a flood
    ...Array.from({ length: 19 }, (_, i) => ({ price: 950_000 + i * 5_000, quantity: 1 })),
  ];
  const item   = { itemId: 1, threshold: 10 };
  const result = computePollResult(listings, item, 10_000_000, [], 'flat');
  assert('isFloodPlay is false (qty < 100)', result.isFloodPlay === false);
  assert('marketFlood is null', result.marketFlood === null);
}

console.log('\ncomputePollResult — Sell target set to block price - 1 when volume block exists');
{
  // cheapest listing at 800_000; block of 200 units at 900_000 = 180_000_000 value
  // availableCapital = 1_000_000; blockThreshold = 100_000; block qualifies
  const listings = [
    { price: 800_000, quantity: 1 },
    { price: 900_000, quantity: 200 },  // volume block
    { price: 950_000, quantity: 1 },
    { price: 1_000_000, quantity: 1 },
  ];
  const item   = { itemId: 1, threshold: 10 };
  const result = computePollResult(listings, item, 1_000_000, [], 'flat');
  assert('recommendedSellTarget = block price - 1', result.recommendedSellTarget === 899_999);
}

console.log('\ncomputePollResult — Sell target falls back to P75 when no volume block');
{
  // 4 listings sorted: 800_000, 850_000, 900_000, 950_000; each qty=1
  // availableCapital = 10_000_000 → blockThreshold = 1_000_000
  // Max tier value = 950_000 × 1 = 950_000 < 1_000_000 → no block qualifies
  // P75 index = floor(4 × 0.75) = 3 → p75 = 950_000; above[0] = 850_000
  // max(950_000, 850_000) = 950_000
  const listings = [
    { price: 800_000, quantity: 1 },
    { price: 850_000, quantity: 1 },
    { price: 900_000, quantity: 1 },
    { price: 950_000, quantity: 1 },
  ];
  const item   = { itemId: 1, threshold: 10 };
  const result = computePollResult(listings, item, 10_000_000, [], 'flat');
  assert('recommendedSellTarget = P75 fallback', result.recommendedSellTarget === 950_000);
}

// ── LogParser ────────────────────────────────────────────────────────────────

function LogParser(logText) {
  if (!logText || !logText.trim()) return [];

  const lines   = logText.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const buyM = lines[i].match(/^You bought (\d+)x (.+?) on .+? at \$([0-9,]+) each/);
    if (!buyM) continue;

    const quantity      = parseInt(buyM[1], 10);
    const itemName      = buyM[2].trim();
    const purchasePrice = parseInt(buyM[3].replace(/,/g, ''), 10);

    let timestamp = null;
    const next = lines[i + 1] ?? '';
    const tsM  = next.match(/^(\d{2}:\d{2}:\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2,4})$/);
    if (tsM) {
      const [, time, mm, dd, yy] = tsM;
      const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
      const t    = new Date(`${year}-${mm}-${dd}T${time}`).getTime();
      if (!isNaN(t)) { timestamp = t; i++; }
    }

    entries.push({ itemId: null, itemName, purchasePrice, quantity, timestamp });
  }

  return entries;
}

// ── SellTargetEngine ─────────────────────────────────────────────────────────

function SellTargetEngine(bazaarAverage, marketValue, aggressiveness) {
  if (bazaarAverage == null && marketValue == null) return null;
  if (bazaarAverage != null && marketValue != null) {
    if (aggressiveness === 'conservative') return bazaarAverage;
    if (aggressiveness === 'aggressive')   return marketValue;
    return Math.round((bazaarAverage + marketValue) / 2);
  }
  const ref   = marketValue ?? bazaarAverage;
  const scale = aggressiveness === 'conservative' ? 0.90
              : aggressiveness === 'aggressive'   ? 1.00
              : 0.95;
  return Math.round(ref * scale);
}

console.log('\nSellTargetEngine — Behavior 1: conservative → bazaarAverage');
{
  assertEq('returns bazaarAverage', SellTargetEngine(80_000, 100_000, 'conservative'), 80_000);
}

console.log('\nSellTargetEngine — Behavior 2: aggressive → marketValue');
{
  assertEq('returns marketValue', SellTargetEngine(80_000, 100_000, 'aggressive'), 100_000);
}

console.log('\nSellTargetEngine — Behavior 3: moderate → rounded midpoint');

{
  // (80_000 + 100_000) / 2 = 90_000 — even, no rounding needed
  assertEq('even midpoint', SellTargetEngine(80_000, 100_000, 'moderate'), 90_000);
  // (80_000 + 101_000) / 2 = 90_500 — rounds to 90_500
  assertEq('odd midpoint rounds correctly', SellTargetEngine(80_000, 101_000, 'moderate'), 90_500);
}

console.log('\nSellTargetEngine — Behavior 4: equal references → same value across all modes');
{
  assertEq('conservative', SellTargetEngine(90_000, 90_000, 'conservative'), 90_000);
  assertEq('aggressive',   SellTargetEngine(90_000, 90_000, 'aggressive'),   90_000);
  assertEq('moderate',     SellTargetEngine(90_000, 90_000, 'moderate'),     90_000);
}

console.log('\nSellTargetEngine — Behavior 5: zero values → 0');
{
  assertEq('conservative zero', SellTargetEngine(0, 0, 'conservative'), 0);
  assertEq('aggressive zero',   SellTargetEngine(0, 0, 'aggressive'),   0);
  assertEq('moderate zero',     SellTargetEngine(0, 0, 'moderate'),     0);
}

console.log('\nSellTargetEngine — Behavior 6: bazaarAverage null → percentage tiers on marketValue');
{
  assertEq('conservative null baz',   SellTargetEngine(null,      100_000, 'conservative'),  90_000);
  assertEq('conservative undef baz',  SellTargetEngine(undefined, 100_000, 'conservative'),  90_000);
  assertEq('moderate null baz',       SellTargetEngine(null,      100_000, 'moderate'),       95_000);
  assertEq('aggressive null baz',     SellTargetEngine(null,      100_000, 'aggressive'),    100_000);
}

console.log('\nSellTargetEngine — Behavior 7: marketValue null → percentage tiers on bazaarAverage');
{
  assertEq('conservative null mkt',  SellTargetEngine(80_000, null,      'conservative'), 72_000);
  assertEq('moderate null mkt',      SellTargetEngine(80_000, null,      'moderate'),     76_000);
  assertEq('aggressive null mkt',    SellTargetEngine(80_000, null,      'aggressive'),   80_000);
  assertEq('aggressive undef mkt',   SellTargetEngine(80_000, undefined, 'aggressive'),   80_000);
}

// ── LogParser ────────────────────────────────────────────────────────────────

console.log('\nLogParser — Behavior 1: empty string → []');
{
  assertEq('returns empty array', LogParser('').length, 0);
}

console.log('\nLogParser — Behavior 2: whitespace-only → []');
{
  assertEq('returns empty array', LogParser('   \n  \n  ').length, 0);
}

console.log('\nLogParser — Behavior 3: bazaar purchase — all fields extracted');
{
  const log = [
    "You bought 26x Tribulus Omanense on PittH's bazaar at $69,000 each for a total of $1,794,000",
    '19:29:33 - 01/05/26',
  ].join('\n');
  const result = LogParser(log);
  assertEq('one entry', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Tribulus Omanense');
  assertEq('quantity', result[0].quantity, 26);
  assertEq('purchasePrice (unit price)', result[0].purchasePrice, 69_000);
  assertEq('itemId is null', result[0].itemId, null);
  assert('timestamp is a number', typeof result[0].timestamp === 'number');
  assert('timestamp is positive', result[0].timestamp > 0);
}

console.log('\nLogParser — Behavior 4: item market purchase → parsed same as bazaar');
{
  const log = [
    'You bought 31x Tribulus Omanense on the item market from Dismas_Hart at $69,357 each for a total of $2,150,067',
    '19:21:36 - 01/05/26',
  ].join('\n');
  const result = LogParser(log);
  assertEq('one entry', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Tribulus Omanense');
  assertEq('quantity', result[0].quantity, 31);
  assertEq('purchasePrice', result[0].purchasePrice, 69_357);
  assert('timestamp is a number', typeof result[0].timestamp === 'number');
}

console.log('\nLogParser — Behavior 5: "You sold" line → skipped');
{
  const log = [
    'You sold 38x Tribulus Omanense on your bazaar to Fairfax1991 at $70,428 each for a total of $2,676,264',
    '19:15:00 - 01/05/26',
  ].join('\n');
  assertEq('returns empty array', LogParser(log).length, 0);
}

console.log('\nLogParser — Behavior 6: malformed line → skipped, no throw');
{
  const log = 'Random text with no price or bought keyword\nAnother garbage line';
  let threw = false;
  let result;
  try { result = LogParser(log); } catch { threw = true; }
  assert('did not throw', !threw);
  assertEq('returns empty array', result.length, 0);
}

console.log('\nLogParser — Behavior 7: missing timestamp line → timestamp null, entry included');
{
  // No line follows the buy line
  const log = "You bought 5x Xanax on PittH's bazaar at $48,000,000 each for a total of $240,000,000";
  const result = LogParser(log);
  assertEq('one entry', result.length, 1);
  assertEq('itemName', result[0].itemName, 'Xanax');
  assertEq('purchasePrice', result[0].purchasePrice, 48_000_000);
  assertEq('timestamp is null', result[0].timestamp, null);
}

console.log('\nLogParser — Behavior 8: multiple entries → all returned in order');
{
  const log = [
    "You bought 26x Tribulus Omanense on PittH's bazaar at $69,000 each for a total of $1,794,000",
    '19:29:33 - 01/05/26',
    'You bought 31x Tribulus Omanense on the item market from Dismas_Hart at $69,357 each for a total of $2,150,067',
    '19:21:36 - 01/05/26',
  ].join('\n');
  const result = LogParser(log);
  assertEq('two entries', result.length, 2);
  assertEq('first quantity', result[0].quantity, 26);
  assertEq('second quantity', result[1].quantity, 31);
}

console.log('\nLogParser — Behavior 9: sold line between two buys → sold skipped, both buys returned');
{
  const log = [
    "You bought 10x Xanax on PittH's bazaar at $48,000,000 each for a total of $480,000,000",
    '10:00:00 - 01/05/26',
    'You sold 38x Tribulus Omanense on your bazaar to Fairfax1991 at $70,428 each for a total of $2,676,264',
    '09:55:00 - 01/05/26',
    "You bought 5x Melatonin on PittH's bazaar at $1,000 each for a total of $5,000",
    '09:50:00 - 01/05/26',
  ].join('\n');
  const result = LogParser(log);
  assertEq('two entries (sold skipped)', result.length, 2);
  assertEq('first itemName', result[0].itemName, 'Xanax');
  assertEq('second itemName', result[1].itemName, 'Melatonin');
}

// ── parseBazaarResponse ───────────────────────────────────────────────────────

function parseBazaarResponse(d) {
  const map = {};
  for (const item of (d.items ?? [])) {
    map[item.item_id] = item.bazaar_average ?? null;
  }
  return map;
}

console.log('\nparseBazaarResponse — Behavior 1: normal response → itemId keys mapped to bazaar_average');
{
  const d = { items: [
    { item_id: 123, bazaar_average: 50_000 },
    { item_id: 456, bazaar_average: 120_000 },
  ]};
  const result = parseBazaarResponse(d);
  assertEq('item 123', result[123], 50_000);
  assertEq('item 456', result[456], 120_000);
}

console.log('\nparseBazaarResponse — Behavior 2: bazaar_average of 0 → stores 0, not null');
{
  const d = { items: [{ item_id: 1, bazaar_average: 0 }] };
  assertEq('stores 0', parseBazaarResponse(d)[1], 0);
}

console.log('\nparseBazaarResponse — Behavior 3: bazaar_average null → stores null');
{
  const d = { items: [{ item_id: 1, bazaar_average: null }] };
  assertEq('stores null', parseBazaarResponse(d)[1], null);
}

console.log('\nparseBazaarResponse — Behavior 4: bazaar_average missing → stores null');
{
  const d = { items: [{ item_id: 1, item_name: 'Tribulus' }] };
  assertEq('stores null', parseBazaarResponse(d)[1], null);
}

console.log('\nparseBazaarResponse — Behavior 5: empty items array → empty object');
{
  const result = parseBazaarResponse({ items: [] });
  assertEq('key count', Object.keys(result).length, 0);
}

console.log('\nparseBazaarResponse — Behavior 6: missing items key → empty object');
{
  const result = parseBazaarResponse({});
  assertEq('key count', Object.keys(result).length, 0);
}

// ── parseItemsResponse ────────────────────────────────────────────────────────

function parseItemsResponse(d) {
  const map = {};
  for (const [id, v] of Object.entries(d.items ?? {})) {
    map[parseInt(id, 10)] = v.market_value ?? null;
  }
  return map;
}

console.log('\nparseItemsResponse — Behavior 1: string keys → numeric keys, market_value preserved');
{
  const d = { items: {
    '123': { name: 'Foo', market_value: 45_000 },
    '456': { name: 'Bar', market_value: 90_000 },
  }};
  const result = parseItemsResponse(d);
  assertEq('item 123', result[123], 45_000);
  assertEq('item 456', result[456], 90_000);
}

console.log('\nparseItemsResponse — Behavior 2: market_value null → stores null');
{
  const d = { items: { '1': { name: 'Foo', market_value: null } } };
  assertEq('stores null', parseItemsResponse(d)[1], null);
}

console.log('\nparseItemsResponse — Behavior 3: market_value missing → stores null');
{
  const d = { items: { '1': { name: 'Foo' } } };
  assertEq('stores null', parseItemsResponse(d)[1], null);
}

console.log('\nparseItemsResponse — Behavior 4: empty items object → empty object');
{
  const result = parseItemsResponse({ items: {} });
  assertEq('key count', Object.keys(result).length, 0);
}

console.log('\nparseItemsResponse — Behavior 5: missing items key → empty object');
{
  const result = parseItemsResponse({});
  assertEq('key count', Object.keys(result).length, 0);
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n── summary ──────────────────────────────────────────────────────────────────');
console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
