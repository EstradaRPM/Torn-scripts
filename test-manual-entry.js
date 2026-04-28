// node test-manual-entry.js
// Tests for buildManualEntry — the pure entry-construction function for Step K.
// Copy the function body here; it must stay in sync with the IIFE implementation.

'use strict';

function buildManualEntry({ itemName, rarity, qualityPct, bonusPct, bid, result, salePrice }) {
  if (!(bid > 0)) return null;
  const sp = salePrice > 0 ? salePrice : null;
  return {
    id             : Date.now(),
    timestamp      : Date.now(),
    itemName       : itemName ?? '',
    rarity         : rarity   ?? '—',
    qualityPct     : qualityPct != null ? qualityPct : null,
    bonusPct       : bonusPct  != null ? bonusPct   : null,
    tier           : null,
    currentBid     : bid,
    maxOffer       : null,
    roi            : null,
    bbFloor        : null,
    refPrice       : null,
    result         : result    ?? null,
    actualSellPrice: sp,
    actualNet      : (result === 'Won' && sp != null) ? sp - bid : null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

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

function assertNull(label, v)    { assert(label, v === null); }
function assertEq(label, a, b)   { assert(label, a === b); }

// ── Behavior 1: valid required-only submission ────────────────────────────────

console.log('\nBehavior 1: valid required-only submission');
{
  const entry = buildManualEntry({ itemName: 'Riot Helmet', rarity: 'yellow', bid: 50_000_000, result: 'Lost' });
  assert('returns an object', entry !== null && typeof entry === 'object');
  assert('id is a number',    typeof entry?.id === 'number');
  assert('timestamp is a number', typeof entry?.timestamp === 'number');
  assertEq('itemName stored',   entry?.itemName,   'Riot Helmet');
  assertEq('rarity stored',     entry?.rarity,     'yellow');
  assertEq('currentBid stored', entry?.currentBid, 50_000_000);
  assertEq('result stored',     entry?.result,     'Lost');
  assertNull('maxOffer is null',  entry?.maxOffer);
  assertNull('roi is null',       entry?.roi);
  assertNull('bbFloor is null',   entry?.bbFloor);
  assertNull('refPrice is null',  entry?.refPrice);
  assertNull('tier is null',      entry?.tier);
  assertNull('qualityPct null when omitted',  entry?.qualityPct);
  assertNull('bonusPct null when omitted',    entry?.bonusPct);
  assertNull('actualSellPrice null',          entry?.actualSellPrice);
  assertNull('actualNet null',                entry?.actualNet);
}

// ── Behavior 2: bid = 0 rejected ─────────────────────────────────────────────

console.log('\nBehavior 2: bid = 0 rejected');
{
  const entry = buildManualEntry({ itemName: 'Riot Body', rarity: 'yellow', bid: 0, result: 'Won' });
  assertNull('returns null', entry);
}

// ── Behavior 3: bid < 0 rejected ─────────────────────────────────────────────

console.log('\nBehavior 3: bid < 0 rejected');
{
  const entry = buildManualEntry({ itemName: 'Riot Body', rarity: 'yellow', bid: -1, result: 'Won' });
  assertNull('returns null', entry);
}

// ── Behavior 4: Won + salePrice → actualNet = salePrice − bid ────────────────

console.log('\nBehavior 4: Won + salePrice → actualNet');
{
  const entry = buildManualEntry({ itemName: 'Riot Helmet', rarity: 'yellow', bid: 50_000_000, result: 'Won', salePrice: 70_000_000 });
  assertEq('actualSellPrice stored', entry?.actualSellPrice, 70_000_000);
  assertEq('actualNet = salePrice − bid', entry?.actualNet, 20_000_000);
}

// ── Behavior 5: Won + no salePrice → actualNet null ──────────────────────────

console.log('\nBehavior 5: Won + no salePrice → actualNet null');
{
  const entry = buildManualEntry({ itemName: 'Riot Helmet', rarity: 'yellow', bid: 50_000_000, result: 'Won' });
  assertNull('actualSellPrice null', entry?.actualSellPrice);
  assertNull('actualNet null',       entry?.actualNet);
}

// ── Behavior 6: optional quality/bonus stored when provided ──────────────────

console.log('\nBehavior 6: optional fields stored when provided');
{
  const entry = buildManualEntry({ itemName: 'Assault Plate', rarity: 'orange', qualityPct: 82.5, bonusPct: 28, bid: 100_000_000, result: 'Lost' });
  assertEq('qualityPct stored', entry?.qualityPct, 82.5);
  assertEq('bonusPct stored',   entry?.bonusPct,   28);
}

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
