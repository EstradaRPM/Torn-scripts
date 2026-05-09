// node test-api-monitor.js
// Tests for the API monitor LogAnalyzer pure functions (issue #222).
// Copy each function body here; keep in sync with the IIFE implementation.

'use strict';

// ── Functions under test ──────────────────────────────────────────────────────

function calcReqPerMin(entries, nowMs) {
  const cutoff = nowMs - 60000;
  const count = entries.filter(e => e.timestamp * 1000 >= cutoff).length;
  return Math.min(Math.max(count, 0), 100);
}

function calcEndpointBreakdown(entries) {
  if (!entries.length) return [];
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.type}||${e.selections}`;
    if (!groups.has(key)) groups.set(key, { type: e.type, selections: e.selections, count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function getRecentEntries(entries, n) {
  return [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, n);
}

function calcHeatLevel(reqPerMin) {
  if (reqPerMin <= 33) return 'low';
  if (reqPerMin <= 66) return 'medium';
  if (reqPerMin <= 90) return 'high';
  return 'critical';
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

// ── calcReqPerMin ─────────────────────────────────────────────────────────────

const NOW_S = Math.floor(Date.now() / 1000);
const NOW_MS = NOW_S * 1000;

console.log('\ncalcReqPerMin — Behavior 1: all entries within last 60s → correct count');
{
  const entries = [
    { timestamp: NOW_S - 10 },
    { timestamp: NOW_S - 30 },
    { timestamp: NOW_S - 59 },
  ];
  assertEq('returns 3', calcReqPerMin(entries, NOW_MS), 3);
}

console.log('\ncalcReqPerMin — Behavior 2: entries spanning the 60s boundary → only recent ones counted');
{
  // NOW_S - 60 is exactly at boundary (60000ms ago); timestamp*1000 must be >= cutoff
  // cutoff = NOW_MS - 60000; entry at NOW_S-60 → timestamp*1000 = NOW_MS-60000 → >= cutoff ✓
  // entry at NOW_S-61 → timestamp*1000 = NOW_MS-61000 → < cutoff ✗
  const entries = [
    { timestamp: NOW_S - 10 },  // recent — in
    { timestamp: NOW_S - 59 },  // recent — in
    { timestamp: NOW_S - 60 },  // exactly at boundary — in (>=)
    { timestamp: NOW_S - 61 },  // just outside — out
    { timestamp: NOW_S - 120 }, // well outside — out
  ];
  assertEq('returns 3 (boundary entry included)', calcReqPerMin(entries, NOW_MS), 3);
}

console.log('\ncalcReqPerMin — Behavior 3: empty array → 0');
{
  assertEq('returns 0', calcReqPerMin([], NOW_MS), 0);
}

console.log('\ncalcReqPerMin — Behavior 4: all entries older than 60s → 0');
{
  const entries = [
    { timestamp: NOW_S - 120 },
    { timestamp: NOW_S - 300 },
    { timestamp: NOW_S - 3600 },
  ];
  assertEq('returns 0', calcReqPerMin(entries, NOW_MS), 0);
}

// ── calcEndpointBreakdown ─────────────────────────────────────────────────────

console.log('\ncalcEndpointBreakdown — Behavior 1: groups by type+selections correctly');
{
  const entries = [
    { type: 'user', selections: 'basic' },
    { type: 'user', selections: 'basic' },
    { type: 'torn', selections: 'items' },
  ];
  const result = calcEndpointBreakdown(entries);
  assertEq('two groups', result.length, 2);
  // highest count first
  assertEq('first group type', result[0].type, 'user');
  assertEq('first group selections', result[0].selections, 'basic');
  assertEq('first group count', result[0].count, 2);
  assertEq('second group type', result[1].type, 'torn');
  assertEq('second group count', result[1].count, 1);
}

console.log('\ncalcEndpointBreakdown — Behavior 2: sorted descending by count');
{
  const entries = [
    { type: 'a', selections: 'x' },
    { type: 'b', selections: 'y' },
    { type: 'b', selections: 'y' },
    { type: 'b', selections: 'y' },
    { type: 'c', selections: 'z' },
    { type: 'c', selections: 'z' },
  ];
  const result = calcEndpointBreakdown(entries);
  assertEq('three groups', result.length, 3);
  assertEq('first count = 3', result[0].count, 3);
  assertEq('second count = 2', result[1].count, 2);
  assertEq('third count = 1', result[2].count, 1);
}

console.log('\ncalcEndpointBreakdown — Behavior 3: empty input → empty array');
{
  const result = calcEndpointBreakdown([]);
  assertEq('returns empty array', result.length, 0);
}

// ── getRecentEntries ──────────────────────────────────────────────────────────

console.log('\ngetRecentEntries — Behavior 1: returns correct n; sorted newest-first');
{
  const entries = [
    { timestamp: 1000 },
    { timestamp: 3000 },
    { timestamp: 2000 },
    { timestamp: 4000 },
  ];
  const result = getRecentEntries(entries, 2);
  assertEq('length = 2', result.length, 2);
  assertEq('first is newest (4000)', result[0].timestamp, 4000);
  assertEq('second is next (3000)', result[1].timestamp, 3000);
}

console.log('\ngetRecentEntries — Behavior 2: n larger than array length → returns all, sorted newest-first');
{
  const entries = [
    { timestamp: 100 },
    { timestamp: 300 },
    { timestamp: 200 },
  ];
  const result = getRecentEntries(entries, 10);
  assertEq('length = 3 (all returned)', result.length, 3);
  assertEq('first is newest (300)', result[0].timestamp, 300);
  assertEq('second (200)', result[1].timestamp, 200);
  assertEq('third (100)', result[2].timestamp, 100);
}

// ── calcHeatLevel ─────────────────────────────────────────────────────────────

console.log('\ncalcHeatLevel — boundary values');
{
  assertEq('0 → low',       calcHeatLevel(0),   'low');
  assertEq('33 → low',      calcHeatLevel(33),  'low');
  assertEq('34 → medium',   calcHeatLevel(34),  'medium');
  assertEq('66 → medium',   calcHeatLevel(66),  'medium');
  assertEq('67 → high',     calcHeatLevel(67),  'high');
  assertEq('90 → high',     calcHeatLevel(90),  'high');
  assertEq('91 → critical', calcHeatLevel(91),  'critical');
  assertEq('100 → critical',calcHeatLevel(100), 'critical');
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log('\n── summary ──────────────────────────────────────────────────────────────────');
console.log(`${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
