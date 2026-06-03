// node test-availabilityline.js
// Tests for AvailabilityLine (issue #320) — the pure "where my items are"
// composer. Mirrors test-ledgerstats.js / test-advconfig.js: requires the
// shipped .user.js directly (ADR-0002 seam), reads AvailabilityLine off
// __RwthPure, and asserts external behavior only — feed locations + an optional
// override, assert the sentence. Also checks the AdvConfig wiring that turns
// persisted location booleans into the resolved availability sentence.

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

const { AvailabilityLine, AdvConfig } = globalThis.__RwthPure;

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

const BAZAAR = 'Find my items on my bazaar.';
const MARKET = 'Find my items on the item market.';
const CASE   = 'Find my items on my display case.';

// ── 0 selected — empty sentence (the builders hide the line) ──────────────────

console.log('\n0 locations — no sentence');
{
  assertEq('no locations -> empty', AvailabilityLine.compose([]), '');
  assertEq('undefined locations -> empty', AvailabilityLine.compose(undefined), '');
  assertEq('non-array locations -> empty', AvailabilityLine.compose('bazaar'), '');
}

// ── 1 selected — a single phrase ──────────────────────────────────────────────

console.log('\n1 location — single phrase');
{
  assertEq('bazaar only', AvailabilityLine.compose(['bazaar']), BAZAAR);
  assertEq('item market only', AvailabilityLine.compose(['itemMarket']), MARKET);
  assertEq('display case only', AvailabilityLine.compose(['displayCase']), CASE);
}

// ── 2 selected — joined with "and", no comma ──────────────────────────────────

console.log('\n2 locations — joined with "and"');
{
  assertEq('bazaar + item market',
    AvailabilityLine.compose(['bazaar', 'itemMarket']),
    'Find my items on my bazaar and the item market.');
  assertEq('bazaar + display case',
    AvailabilityLine.compose(['bazaar', 'displayCase']),
    'Find my items on my bazaar and my display case.');
  assertEq('item market + display case',
    AvailabilityLine.compose(['itemMarket', 'displayCase']),
    'Find my items on the item market and my display case.');
}

// ── 3 selected — Oxford-comma list ────────────────────────────────────────────

console.log('\n3 locations — Oxford-comma list');
{
  assertEq('all three',
    AvailabilityLine.compose(['bazaar', 'itemMarket', 'displayCase']),
    'Find my items on my bazaar, the item market, and my display case.');
}

// ── selection order is normalized to the canonical order ──────────────────────

console.log('\norder normalized to canonical');
{
  assertEq('reversed input still reads bazaar-first',
    AvailabilityLine.compose(['displayCase', 'itemMarket', 'bazaar']),
    'Find my items on my bazaar, the item market, and my display case.');
  assertEq('two reversed',
    AvailabilityLine.compose(['itemMarket', 'bazaar']),
    'Find my items on my bazaar and the item market.');
}

// ── unknown / duplicate keys are ignored ──────────────────────────────────────

console.log('\nunknown / junk keys ignored');
{
  assertEq('unknown key dropped', AvailabilityLine.compose(['bazaar', 'shed']), BAZAAR);
  assertEq('all-junk -> empty', AvailabilityLine.compose(['shed', 'street']), '');
}

// ── manual override wins over the composed sentence ───────────────────────────

console.log('\nmanual override precedence');
{
  assertEq('override beats a composed 2-location sentence',
    AvailabilityLine.compose(['bazaar', 'itemMarket'], 'Catch me on Discord'),
    'Catch me on Discord');
  assertEq('override works with no locations',
    AvailabilityLine.compose([], 'Message me for stock'),
    'Message me for stock');
  assertEq('override is trimmed',
    AvailabilityLine.compose(['bazaar'], '   Custom wording   '),
    'Custom wording');
}

// ── empty / whitespace override falls back to the composed sentence ───────────

console.log('\nblank / whitespace override falls back to composed');
{
  assertEq('empty override -> composed', AvailabilityLine.compose(['bazaar'], ''), BAZAAR);
  assertEq('whitespace override -> composed', AvailabilityLine.compose(['bazaar'], '   \t\n'), BAZAAR);
  assertEq('null override -> composed', AvailabilityLine.compose(['bazaar'], null), BAZAAR);
  assertEq('undefined override -> composed', AvailabilityLine.compose(['bazaar'], undefined), BAZAAR);
  assertEq('blank override + no locations -> empty', AvailabilityLine.compose([], '   '), '');
}

// ── AdvConfig wiring — persisted location booleans -> resolved sentence ───────
// The resolver normalizes settings.locations into booleans and composes the
// availability sentence (override wins); a fresh install shows no line.

console.log('\nresolver wiring — locations -> availability');
{
  assertEq('fresh install resolves no availability line',
    AdvConfig.resolve({}).availability, '');
  assert('fresh install resolves all locations off',
    !AdvConfig.resolve({}).locations.bazaar
    && !AdvConfig.resolve({}).locations.itemMarket
    && !AdvConfig.resolve({}).locations.displayCase);

  const r = AdvConfig.resolve({ locations: { bazaar: true, displayCase: true } });
  assertEq('two ticked locations compose the sentence',
    r.availability, 'Find my items on my bazaar and my display case.');
  assertEq('resolved locations reflect the booleans (bazaar)', r.locations.bazaar, true);
  assertEq('resolved locations reflect the booleans (itemMarket)', r.locations.itemMarket, false);

  const o = AdvConfig.resolve({ locations: { bazaar: true }, availabilityOverride: 'See my Discord' });
  assertEq('override wins through the resolver', o.availability, 'See my Discord');

  const blanked = AdvConfig.resolve({ locations: { bazaar: true }, availabilityOverride: '   ' });
  assertEq('blank override falls back to the composed sentence',
    blanked.availability, 'Find my items on my bazaar.');

  // A non-boolean / truthy-but-not-true value must not count as selected.
  const loose = AdvConfig.resolve({ locations: { bazaar: 'yes', itemMarket: 1 } });
  assertEq('only strict-true booleans select a location', loose.availability, '');
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
