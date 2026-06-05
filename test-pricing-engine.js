// node test-pricing-engine.js
// Tests for the pricing engine pure functions (issue #170 redesign).
// Copy each function body here; keep in sync with the IIFE implementation.

'use strict';

// ── ARMOR_SCORING (source of truth — mirrors the IIFE constant) ───────────────

const ARMOR_SCORING = {
  Riot    : { baseBonusPct: 20, highTierThreshold: 26 },
  Assault : { baseBonusPct: 20, highTierThreshold: 26 },
  Dune    : { baseBonusPct: 30, highTierThreshold: 37 },
};

// ── Functions under test ──────────────────────────────────────────────────────

function isNearBase(listing, armorSet) {
  const scoring = ARMOR_SCORING[armorSet];
  if (!scoring) return false;
  if (listing.qualityPct == null || listing.bonusPct == null) return false;
  return listing.qualityPct <= 20 && listing.bonusPct <= scoring.baseBonusPct + 2;
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

function calcProfitMatrix(bid, resalePrice, marketFee, mugBuffer) {
  const marketNet    = Math.round(resalePrice * (1 - marketFee));
  const bazaarClean  = resalePrice - bid;
  const bazaarMugged = Math.round(resalePrice * (1 - mugBuffer)) - bid;
  const marketClean  = marketNet - bid;
  const marketMugged = Math.round(marketNet  * (1 - mugBuffer)) - bid;
  return { bazaarClean, bazaarMugged, marketClean, marketMugged };
}

function findNearestComp(listing, allComps, bonusWeight = 1.0) {
  if (!allComps.length) return null;
  let nearest = null;
  let minDist = Infinity;
  for (const comp of allComps) {
    const qDiff = (listing.qualityPct ?? 0) - (comp.qualityPct ?? 0);
    const bDiff = (listing.bonusPct   ?? 0) - (comp.bonusPct   ?? 0);
    const dist  = Math.sqrt(qDiff * qDiff + (bonusWeight * bDiff) * (bonusWeight * bDiff));
    if (dist < minDist) { minDist = dist; nearest = comp; }
  }
  return nearest;
}

function calcNonFloorMaxBid(resalePrice, targetProfitPct, marketFee) {
  return Math.round(resalePrice * (1 - marketFee - targetProfitPct));
}

function addBidNoise(baseBid) {
  return baseBid + Math.floor(Math.random() * 1_000_000);
}

function calcSuggestedBid(currentBid, maxBid, lean = 0.30) {
  return Math.round(currentBid + lean * (maxBid - currentBid));
}

// ── auctionPlan (mirror of the IIFE method — keep in sync) ────────────────────
function _median(arr) {
  const xs = (arr || []).filter(n => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
function auctionPlan(args) {
  const a = args || {};
  const s = a.settings || {};
  const prices = ((a.comps) || [])
    .map(c => Number(c && c.price))
    .filter(p => Number.isFinite(p) && p > 0);
  const resale = Number(a.bazaarResale);
  if (!prices.length || !(Number.isFinite(resale) && resale > 0)) return null;
  const tax    = s.tax    != null ? s.tax    : 0.05;
  const mug    = s.mug    != null ? s.mug    : 0.10;
  const margin = s.margin != null ? s.margin : 0.05;
  const floor   = Math.round(Math.min(...prices));
  const typical = Math.round(_median(prices));
  const maxBid  = Math.round(resale * (1 - tax - mug - margin));
  return { floor, typical, maxBid,
           verdict: maxBid < floor ? 'pass' : 'buy', count: prices.length };
}

function isFloorPositioned(listing, floorCluster) {
  if (!floorCluster.isValid || floorCluster.floorPrice == null) return false;
  return listing.price <= floorCluster.floorPrice * 1.12;
}

// ── widenedBand (mirror of the IIFE method — keep in sync) ────────────────────
const WIDE_BAND_BUFFER = 0.30;
function widenedBand(args) {
  const a = args || {};
  const prices = ((a.comps) || [])
    .map(c => Number(c && c.price))
    .filter(p => Number.isFinite(p) && p > 0);
  if (!prices.length) return null;
  const buffer = Number.isFinite(Number(a.buffer)) ? Number(a.buffer) : WIDE_BAND_BUFFER;
  const median = _median(prices);
  const obsMin = Math.min(...prices);
  const obsMax = Math.max(...prices);
  const lo = Math.max(0, Math.min(Math.round(median * (1 - buffer)), obsMin));
  const hi = Math.max(Math.round(median * (1 + buffer)), obsMax);
  return { median: Math.round(median), lo, hi, count: prices.length, buffer };
}

// ── resolveItemClass (mirror of the IIFE fn — keep in sync) ───────────────────
const WEAPON_TYPES = ['primary', 'secondary', 'melee'];
const ARMOR_TYPES  = ['armor', 'defensive'];
function isWeaponType(type) { return WEAPON_TYPES.indexOf(type) !== -1; }
function isArmorType(type)  { return ARMOR_TYPES.indexOf(type)  !== -1; }
function resolveItemClass(cls) {
  if (!cls) return null;
  if (cls.isTrash) return 'trashBB';
  if (isArmorType(cls.type)) {
    if (cls.armorSet === 'Riot' || cls.armorSet === 'Dune') return 'duneRiotArmor';
    if (cls.armorSet === 'Assault') return 'assaultArmor';
    if (cls.rarity === 'orange') return 'orangeArmor';
    if (cls.rarity === 'red')    return 'redArmor';
    if (cls.rarity === 'yellow') return 'assaultArmor';
    return null;
  }
  if (isWeaponType(cls.type)) {
    if (cls.rarity === 'yellow') return 'yellowWeapon';
    if (cls.rarity === 'orange') return 'orangeWeapon';
    if (cls.rarity === 'red')    return 'redWeapon';
    return null;
  }
  return null;
}

// ── resolveMarketAnchor (mirror of the IIFE fn — keep in sync) ────────────────
function resolveMarketAnchor(listings, targetBonus) {
  const valid = (Array.isArray(listings) ? listings : [])
    .map(l => ({ price: Number(l && l.price), bonus: Number(l && l.bonusValue) }))
    .filter(l => Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.bonus));
  if (!valid.length) return { anchor: null, tier: null, tiers: [], fallback: null };

  const globalFloor = Math.min(...valid.map(l => l.price));

  const floorByBucket = new Map();
  for (const l of valid) {
    const k = Math.round(l.bonus);
    const cur = floorByBucket.get(k);
    if (cur == null || l.price < cur) floorByBucket.set(k, l.price);
  }
  const tiers = [...floorByBucket.entries()]
    .map(([bonus, floor]) => ({ thresholdBonus: bonus, floor }))
    .sort((a, b) => a.thresholdBonus - b.thresholdBonus);

  const tb = Number(targetBonus);
  if (!Number.isFinite(tb)) {
    return { anchor: globalFloor, tier: tiers[0], tiers, fallback: null };
  }
  const tbk = Math.round(tb);

  let tier = tiers.find(t => t.thresholdBonus === tbk) || null;
  let fallback = null;
  if (!tier) {
    for (const t of tiers) {
      if (tier == null
          || Math.abs(t.thresholdBonus - tbk) < Math.abs(tier.thresholdBonus - tbk)) {
        tier = t;
      }
    }
    fallback = tier ? tier.thresholdBonus : null;
  }

  let anchor = tier.floor;
  for (const l of valid) {
    if (Math.round(l.bonus) > tbk && l.price < anchor) anchor = l.price;
  }

  return { anchor, tier, tiers, fallback };
}

// ── isNearBase ────────────────────────────────────────────────────────────────

// ── calcProfitMatrix ──────────────────────────────────────────────────────────

console.log('\ncalcProfitMatrix — Behavior 1: bazaarClean = resalePrice − bid (no fee)');
{
  // bid=60M, resale=100M, fee=0.05, mug=0.05
  // bazaarClean = 100M − 60M = 40M
  const m = calcProfitMatrix(60_000_000, 100_000_000, 0.05, 0.05);
  assertEq('bazaarClean', m.bazaarClean, 40_000_000);
}

console.log('\ncalcProfitMatrix — Behavior 2: all four cells');
{
  // bid=60M, resale=100M, fee=0.05, mug=0.05
  // bazaarClean  = 100M − 60M = 40M
  // bazaarMugged = round(100M×0.95) − 60M = 95M − 60M = 35M
  // marketClean  = round(100M×0.95) − 60M = 95M − 60M = 35M
  // marketMugged = round(95M×0.95) − 60M  = 90_250_000 − 60M = 30_250_000
  const m = calcProfitMatrix(60_000_000, 100_000_000, 0.05, 0.05);
  assertEq('bazaarClean',  m.bazaarClean,  40_000_000);
  assertEq('bazaarMugged', m.bazaarMugged, 35_000_000);
  assertEq('marketClean',  m.marketClean,  35_000_000);
  assertEq('marketMugged', m.marketMugged, 30_250_000);
}

console.log('\ncalcProfitMatrix — Behavior 3: mugBuffer=0 → mugged rows equal clean rows');
{
  const m = calcProfitMatrix(60_000_000, 100_000_000, 0.05, 0);
  assertEq('bazaarMugged === bazaarClean', m.bazaarMugged, m.bazaarClean);
  assertEq('marketMugged === marketClean', m.marketMugged, m.marketClean);
}

console.log('\ncalcProfitMatrix — Behavior 4: negative net (overbid) is preserved');
{
  // bid=98M, resale=100M, fee=0.05, mug=0 → marketClean = 95M − 98M = −3M
  const m = calcProfitMatrix(98_000_000, 100_000_000, 0.05, 0);
  assertEq('marketClean is negative', m.marketClean, -3_000_000);
}

// ── findNearestComp ───────────────────────────────────────────────────────────

console.log('\nfindNearestComp — Behavior 1: returns the closest comp by quality+bonus distance');
{
  const listing = { qualityPct: 50, bonusPct: 25 };
  const comps = [
    { price: 80_000_000, qualityPct: 70, bonusPct: 30 },  // dist = sqrt(400+25) ≈ 20.6
    { price: 60_000_000, qualityPct: 52, bonusPct: 26 },  // dist = sqrt(4+1)    ≈ 2.2  ← nearest
    { price: 90_000_000, qualityPct: 90, bonusPct: 40 },  // dist = sqrt(1600+225) ≈ 42.7
  ];
  const result = findNearestComp(listing, comps);
  assertEq('returns nearest comp price', result?.price, 60_000_000);
}

console.log('\nfindNearestComp — Behavior 2: empty comps → null');
{
  const result = findNearestComp({ qualityPct: 50, bonusPct: 25 }, []);
  assert('returns null', result === null);
}

console.log('\nfindNearestComp — Behavior 3: single comp → returns it');
{
  const comp = { price: 70_000_000, qualityPct: 60, bonusPct: 28 };
  const result = findNearestComp({ qualityPct: 50, bonusPct: 25 }, [comp]);
  assertEq('returns the only comp', result?.price, 70_000_000);
}

console.log('\nfindNearestComp — Behavior 4: bonusWeight amplifies bonus axis distance');
{
  const listing = { qualityPct: 50, bonusPct: 25 };
  // compA: qualDiff=5, bonusDiff=1 → default dist=sqrt(25+1)≈5.1; weighted(2) dist=sqrt(25+4)≈5.4
  // compB: qualDiff=6, bonusDiff=0 → default dist=6; weighted(2) dist=6
  // With bonusWeight=2: compA dist≈5.4, compB dist=6 → compA still nearest
  // But with bonusWeight=10: compA dist=sqrt(25+100)≈11.2, compB dist=6 → compB nearest
  const compA = { price: 70_000_000, qualityPct: 55, bonusPct: 26 };
  const compB = { price: 80_000_000, qualityPct: 56, bonusPct: 25 };
  const resultDefault = findNearestComp(listing, [compA, compB], 1.0);
  const resultHighWeight = findNearestComp(listing, [compA, compB], 10.0);
  assertEq('bonusWeight=1 → compA nearest (lower total dist)', resultDefault?.price,    70_000_000);
  assertEq('bonusWeight=10 → compB nearest (bonus axis penalised)', resultHighWeight?.price, 80_000_000);
}

console.log('\nfindNearestComp — Behavior 5: null qualityPct/bonusPct treated as 0 in distance');
{
  const listing = { qualityPct: null, bonusPct: null };
  const comps = [
    { price: 60_000_000, qualityPct: 5,  bonusPct: 3  },  // dist=sqrt(25+9)≈5.8
    { price: 70_000_000, qualityPct: 10, bonusPct: 10 },  // dist=sqrt(100+100)≈14.1
  ];
  const result = findNearestComp(listing, comps);
  assertEq('picks comp closer to 0,0', result?.price, 60_000_000);
}

// ── calcNonFloorMaxBid ────────────────────────────────────────────────────────

console.log('\ncalcNonFloorMaxBid — Behavior 1: standard case');
{
  // resale=100M, targetProfitPct=0.10, marketFee=0.05
  // maxBid = 100M × (1 − 0.05 − 0.10) = 100M × 0.85 = 85M
  assertEq('returns 85M', calcNonFloorMaxBid(100_000_000, 0.10, 0.05), 85_000_000);
}

console.log('\ncalcNonFloorMaxBid — Behavior 2: zero target profit (fee only)');
{
  // maxBid = 100M × (1 − 0.05 − 0) = 95M
  assertEq('returns 95M', calcNonFloorMaxBid(100_000_000, 0, 0.05), 95_000_000);
}

console.log('\ncalcNonFloorMaxBid — Behavior 3: mug buffer is NOT subtracted');
{
  // Confirm that passing a mugBuffer separately has no effect — not part of this function's contract.
  // maxBid with targetProfitPct=0.15, marketFee=0.05 → 100M × 0.80 = 80M
  assertEq('returns 80M (no mug deduction)', calcNonFloorMaxBid(100_000_000, 0.15, 0.05), 80_000_000);
}

console.log('\ncalcNonFloorMaxBid — Behavior 4: fractional result is rounded');
{
  // 75M × (1 − 0.05 − 0.10) = 75M × 0.85 = 63_750_000
  assertEq('rounds correctly', calcNonFloorMaxBid(75_000_000, 0.10, 0.05), 63_750_000);
}

// ── addBidNoise ───────────────────────────────────────────────────────────────

console.log('\naddBidNoise — Behavior 1: result is >= baseBid');
{
  const result = addBidNoise(71_000_000);
  assert('result >= baseBid', result >= 71_000_000);
}

console.log('\naddBidNoise — Behavior 2: result is < baseBid + 1_000_000');
{
  const result = addBidNoise(71_000_000);
  assert('result < baseBid + 1M', result < 72_000_000);
}

console.log('\naddBidNoise — Behavior 3: noise is integer (no fractional dollars)');
{
  const result = addBidNoise(71_000_000);
  assert('result is integer', Number.isInteger(result));
}

// ── calcSuggestedBid ──────────────────────────────────────────────────────────

console.log('\ncalcSuggestedBid — Behavior 1: 30% into gap with default lean');
{
  // currentBid=50M, maxBid=100M → 50M + 0.30×50M = 65M
  assertEq('returns 65M', calcSuggestedBid(50_000_000, 100_000_000), 65_000_000);
}

console.log('\ncalcSuggestedBid — Behavior 2: custom lean');
{
  // currentBid=60M, maxBid=100M, lean=0.5 → 80M
  assertEq('returns 80M', calcSuggestedBid(60_000_000, 100_000_000, 0.5), 80_000_000);
}

console.log('\ncalcSuggestedBid — Behavior 3: currentBid already at maxBid → returns maxBid');
{
  assertEq('returns maxBid', calcSuggestedBid(100_000_000, 100_000_000), 100_000_000);
}

console.log('\ncalcSuggestedBid — Behavior 4: fractional result is rounded');
{
  // 50M + 0.30×33M = 59.9M → rounds to 59_900_000
  assertEq('rounds correctly', calcSuggestedBid(50_000_000, 83_000_000), 59_900_000);
}

// ── isFloorPositioned ─────────────────────────────────────────────────────────

console.log('\nisFloorPositioned — Behavior 1: listing price within cluster range');
{
  const cluster = { floorPrice: 100_000_000, isValid: true };
  assert('returns true', isFloorPositioned({ price: 105_000_000 }, cluster) === true);
}

console.log('\nisFloorPositioned — Behavior 2: listing at exact cluster ceiling (floorPrice × 1.12)');
{
  const cluster = { floorPrice: 100_000_000, isValid: true };
  assert('returns true at boundary', isFloorPositioned({ price: 112_000_000 }, cluster) === true);
}

console.log('\nisFloorPositioned — Behavior 3: listing one dollar above cluster ceiling');
{
  const cluster = { floorPrice: 100_000_000, isValid: true };
  assert('returns false', isFloorPositioned({ price: 112_000_001 }, cluster) === false);
}

console.log('\nisFloorPositioned — Behavior 4: invalid cluster (isValid=false) → false');
{
  const cluster = { floorPrice: 100_000_000, isValid: false };
  assert('returns false', isFloorPositioned({ price: 105_000_000 }, cluster) === false);
}

// ── isNearBase ────────────────────────────────────────────────────────────────

console.log('\nisNearBase — Behavior 1: clear near-base Riot listing');
{
  // qualityPct=15, bonusPct=21 (baseBonusPct=20, threshold=22) → true
  assert('returns true', isNearBase({ qualityPct: 15, bonusPct: 21 }, 'Riot') === true);
}

console.log('\nisNearBase — Behavior 2: bonusPct exactly at threshold (baseBonusPct + 2)');
{
  assert('returns true at boundary', isNearBase({ qualityPct: 10, bonusPct: 22 }, 'Riot') === true);
}

console.log('\nisNearBase — Behavior 3: bonusPct one above threshold');
{
  assert('returns false', isNearBase({ qualityPct: 10, bonusPct: 23 }, 'Riot') === false);
}

console.log('\nisNearBase — Behavior 4: qualityPct exactly at threshold (20)');
{
  assert('returns true at boundary', isNearBase({ qualityPct: 20, bonusPct: 21 }, 'Riot') === true);
}

console.log('\nisNearBase — Behavior 5: qualityPct one above threshold');
{
  assert('returns false', isNearBase({ qualityPct: 21, bonusPct: 21 }, 'Riot') === false);
}

console.log('\nisNearBase — Behavior 6: null qualityPct → false');
{
  assert('returns false', isNearBase({ qualityPct: null, bonusPct: 21 }, 'Riot') === false);
}

console.log('\nisNearBase — Behavior 7: null bonusPct → false');
{
  assert('returns false', isNearBase({ qualityPct: 15, bonusPct: null }, 'Riot') === false);
}

console.log('\nisNearBase — Behavior 8: Dune set uses its own baseBonusPct (30)');
{
  assert('bonusPct=32 true for Dune',  isNearBase({ qualityPct: 10, bonusPct: 32 }, 'Dune') === true);
  assert('bonusPct=33 false for Dune', isNearBase({ qualityPct: 10, bonusPct: 33 }, 'Dune') === false);
}

console.log('\nauctionPlan — Behavior 1: healthy flip → buy, max clamped off bazaar');
{
  // comps clear 540–600m (typ 565m); bazaar resale 785m → max 785×0.80 = 628m.
  const p = auctionPlan({
    comps: [{ price: 540e6 }, { price: 560e6 }, { price: 570e6 }, { price: 600e6 }],
    bazaarResale: 785e6,
  });
  assertEq('floor = cheapest comp', p.floor, 540e6);
  assertEq('typical = comp median', p.typical, 565e6);
  assertEq('maxBid = bazaar × 0.80', p.maxBid, 628e6);
  assertEq('verdict buy (maxBid ≥ floor)', p.verdict, 'buy');
}

console.log('\nauctionPlan — Behavior 2: auction clears above ceiling → pass');
{
  // The reported bug: comps clear 701–823m but bazaar resale only 785m.
  // max = 785×0.80 = 628m < floor 701m → no margin → pass.
  const p = auctionPlan({
    comps: [{ price: 701e6 }, { price: 750e6 }, { price: 823e6 }],
    bazaarResale: 785e6,
  });
  assertEq('maxBid stays below resale', p.maxBid, 628e6);
  assert('maxBid is below the comp floor', p.maxBid < p.floor);
  assertEq('verdict pass', p.verdict, 'pass');
}

console.log('\nauctionPlan — Behavior 3: degenerate inputs → null');
{
  assert('no comps → null', auctionPlan({ comps: [], bazaarResale: 100e6 }) === null);
  assert('no resale → null', auctionPlan({ comps: [{ price: 10e6 }], bazaarResale: 0 }) === null);
  assert('unpriced comps → null', auctionPlan({ comps: [{ price: 0 }, { price: -5 }], bazaarResale: 100e6 }) === null);
}

console.log('\nauctionPlan — Behavior 4: custom friction knobs widen the ceiling');
{
  // Drop margin to 0 → max = bazaar × (1 − 0.05 − 0.10) = 0.85.
  const p = auctionPlan({
    comps: [{ price: 100e6 }],
    bazaarResale: 1000e6,
    settings: { margin: 0 },
  });
  assertEq('maxBid = bazaar × 0.85', p.maxBid, 850e6);
}

console.log('\nwidenedBand — Behavior 1: median ± 30% with a real spread');
{
  // prices 100,120,200 → median 120; ±30% → 84..156; observed min/max 100/200
  // widen so band brackets reality: lo = min(84,100)=84; hi = max(156,200)=200.
  const b = widenedBand({ comps: [{ price: 100 }, { price: 120 }, { price: 200 }] });
  assertEq('median', b.median, 120);
  assertEq('lo = buffer floor (below observed min)', b.lo, 84);
  assertEq('hi = observed max (wider than buffer)', b.hi, 200);
  assertEq('count', b.count, 3);
}

console.log('\nwidenedBand — Behavior 2: single comp still yields a band that brackets it');
{
  // one comp at 200 → median 200; ±30% → 140..260; observed min/max both 200.
  const b = widenedBand({ comps: [{ price: 200 }] });
  assertEq('lo', b.lo, 140);
  assertEq('hi', b.hi, 260);
  assert('band brackets the lone comp', b.lo <= 200 && 200 <= b.hi);
}

console.log('\nwidenedBand — Behavior 3: empty / unpriced → null');
{
  assert('no comps → null', widenedBand({ comps: [] }) === null);
  assert('unpriced → null', widenedBand({ comps: [{ price: 0 }, { price: -1 }] }) === null);
}

console.log('\nwidenedBand — Behavior 4: custom buffer widens the band');
{
  // median 100, buffer 0.5 → 50..150; observed min/max both 100.
  const b = widenedBand({ comps: [{ price: 100 }], buffer: 0.5 });
  assertEq('lo', b.lo, 50);
  assertEq('hi', b.hi, 150);
}

console.log('\nresolveItemClass — Behavior 1: instance rarity routes orange/red weapons');
{
  // A weapon dict carries no per-instance rarity; the caller overrides cls.rarity
  // with the glow rarity before routing. Orange glow → orangeWeapon, red → red.
  assertEq('orange weapon', resolveItemClass({ type: 'primary', rarity: 'orange' }), 'orangeWeapon');
  assertEq('red weapon',    resolveItemClass({ type: 'melee',   rarity: 'red' }),    'redWeapon');
  assertEq('yellow weapon', resolveItemClass({ type: 'secondary', rarity: 'yellow' }), 'yellowWeapon');
}

console.log('\nresolveItemClass — Behavior 2: weapon with no rarity → null (caller falls back)');
{
  assert('no rarity → null', resolveItemClass({ type: 'primary', rarity: null }) === null);
}

console.log('\nresolveItemClass — Behavior 3: orange/red armor route by rarity');
{
  assertEq('orange armor', resolveItemClass({ type: 'armor', rarity: 'orange' }), 'orangeArmor');
  assertEq('red armor (EOD)', resolveItemClass({ type: 'armor', rarity: 'red' }), 'redArmor');
}

console.log('\nresolveMarketAnchor — Behavior 1: a small <10% step no longer merges the candidate down a bracket');
{
  // The reported bug: 26% lists at 290m, the 25% floor at 270m (+7.4%, under the
  // old 10% jump gate). The old tiering merged 26% onto the 25% floor → 270m.
  // Now the candidate anchors on its own bucket → 290m.
  const listings = [
    { price: 270e6, bonusValue: 25 }, { price: 290e6, bonusValue: 26 },
    { price: 400e6, bonusValue: 27 }, { price: 445e6, bonusValue: 28 },
  ];
  const r = resolveMarketAnchor(listings, 26);
  assertEq('anchors on the 26% bucket, not the 25% floor', r.anchor, 290e6);
  assertEq('no fallback (own bucket present)', r.fallback, null);
}

console.log('\nresolveMarketAnchor — Behavior 2: non-linear curve — each bucket keeps its own empirical floor');
{
  // A steep high-end step and a flat low-end step coexist; both read truthfully.
  const listings = [
    { price: 100e6, bonusValue: 25 }, { price: 105e6, bonusValue: 26 }, // flat (+5%)
    { price: 300e6, bonusValue: 34 }, { price: 320e6, bonusValue: 35 }, // steep
  ];
  assertEq('flat entry bucket', resolveMarketAnchor(listings, 26).anchor, 105e6);
  assertEq('steep high bucket', resolveMarketAnchor(listings, 35).anchor, 320e6);
}

console.log('\nresolveMarketAnchor — Behavior 3: undercut guard — a cheaper, stronger piece wins the anchor');
{
  // A 27% listed BELOW the 26% floor is the smarter buy → anchor on it.
  const r = resolveMarketAnchor(
    [{ price: 290e6, bonusValue: 26 }, { price: 285e6, bonusValue: 27 }], 26);
  assertEq('anchors on the cheaper 27%', r.anchor, 285e6);
}

console.log('\nresolveMarketAnchor — Behavior 4: a cheaper WEAKER piece never pulls the anchor down');
{
  // A 25% at 270m below the 26% floor is a lower tier, not a better buy — ignored.
  const r = resolveMarketAnchor(
    [{ price: 270e6, bonusValue: 25 }, { price: 290e6, bonusValue: 26 }], 26);
  assertEq('stays on the 26% floor', r.anchor, 290e6);
}

console.log('\nresolveMarketAnchor — Behavior 5: empty own bucket → nearest bonus, flagged');
{
  // No 26% listed → nearest is 25% (tie distance 1 each way, lower wins).
  const r = resolveMarketAnchor(
    [{ price: 270e6, bonusValue: 25 }, { price: 400e6, bonusValue: 27 }], 26);
  assertEq('falls back to nearest bucket floor', r.anchor, 270e6);
  assertEq('reports the fallback bonus', r.fallback, 25);
}

console.log('\nresolveMarketAnchor — Behavior 6: fractional bonuses bucket by rounding');
{
  // 25.9 and 26.1 both round to 26 and share one bucket (cheapest wins).
  const r = resolveMarketAnchor(
    [{ price: 295e6, bonusValue: 25.9 }, { price: 288e6, bonusValue: 26.1 }], 26);
  assertEq('cheapest of the rounded-26 bucket', r.anchor, 288e6);
}

console.log('\nresolveMarketAnchor — Behavior 7: no bonus on target → global floor; empty → null');
{
  const r = resolveMarketAnchor(
    [{ price: 270e6, bonusValue: 25 }, { price: 290e6, bonusValue: 26 }], NaN);
  assertEq('global cheapest when target bonus unknown', r.anchor, 270e6);
  assert('no listings → null anchor', resolveMarketAnchor([], 26).anchor === null);
}

console.log('\n── summary ──────────────────────────────────────────────────────────────────');
console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
