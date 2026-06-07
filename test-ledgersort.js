// node test-ledgersort.js
// Tests for LedgerSort (#341) — the pure comparator map the ledger bar sorts by.
// Each comparator runs over RowModel output: newest/oldest key on buyTimestamp,
// bestRoi on the mixed projected/realized roiPct, biggestPl on realized P/L
// (sold) vs projected ask-buy (listed). Null keys must sink to the bottom and
// equal keys must keep input order (stable). Loads the shipped .user.js directly
// (ADR-0002 seam), mirroring test-rowmodel.js's plain-assert style.

'use strict';

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

const { LedgerSort, RowModel } = globalThis.__RwthPure;

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

// Each fixture row is tagged with a `name` so a sorted order reads at a glance.
// Build the RowModel projection (what LedgerSort actually compares) but keep the
// tag on the same object — extra fields never affect the comparators.
function row(name, item) { return { name, ...RowModel.forItem(item, NOW) }; }

function order(rows, cmp) { return rows.slice().sort(cmp).map(r => r.name); }

// ── Mixed fixture: held (no ROI/PL), listed (projected), sold (realized) ───────

const held    = row('held',    { status: 'held',   buyPrice: 1000, buyTimestamp: NOW - 10 * DAY });
const listA   = row('listA',   { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW - 5 * DAY });  // +50% proj, +500 pl
const listB   = row('listB',   { status: 'listed', buyPrice: 1000, listPrice: 1200, buyTimestamp: NOW - 2 * DAY });  // +20% proj, +200 pl
const soldHi  = row('soldHi',  { status: 'sold',   buyPrice: 1000, saleNet: 1800, buyTimestamp: NOW - 20 * DAY });   // +80% real, +800 pl
const soldLo  = row('soldLo',  { status: 'sold',   buyPrice: 1000, saleNet: 900,  buyTimestamp: NOW - 30 * DAY });   // -10% real, -100 pl

const mixed = [held, listA, listB, soldHi, soldLo];

// ── newest / oldest key on buyTimestamp; nulls sink ───────────────────────────

console.log('\nnewest / oldest (buyTimestamp)');
{
  assertEq('newest = most recent buy first',
    order(mixed, LedgerSort.newest).join(','), 'listB,listA,held,soldHi,soldLo');
  assertEq('oldest = earliest buy first',
    order(mixed, LedgerSort.oldest).join(','), 'soldLo,soldHi,held,listA,listB');

  const noStamp = row('noStamp', { status: 'held', buyPrice: 1000, buyTimestamp: null });
  assertEq('newest: stampless row sinks to bottom',
    order([noStamp, listA, listB], LedgerSort.newest).join(','), 'listB,listA,noStamp');
  assertEq('oldest: stampless row STILL sinks to bottom (not treated as oldest)',
    order([noStamp, listA, listB], LedgerSort.oldest).join(','), 'listA,listB,noStamp');
}

// ── bestRoi: projected (listed) and realized (sold) interleaved on one scale ───

console.log('\nbestRoi (mixed projected + realized)');
{
  // soldHi +80% > listA +50% > listB +20% > soldLo -10%; held has no ROI -> last.
  assertEq('bestRoi interleaves listed-projected and sold-realized by roiPct',
    order(mixed, LedgerSort.bestRoi).join(','), 'soldHi,listA,listB,soldLo,held');
  assert('held (null roiPct) is last',
    order(mixed, LedgerSort.bestRoi).pop() === 'held');
}

// ── biggestPl: realized P/L (sold) vs projected ask-buy (listed) ──────────────

console.log('\nbiggestPl (realized for sold, projected ask-buy for listed)');
{
  // soldHi +800 > listA +500 > listB +200 > soldLo -100; held has no P/L -> last.
  assertEq('biggestPl mixes realized and projected P/L',
    order(mixed, LedgerSort.biggestPl).join(','), 'soldHi,listA,listB,soldLo,held');

  // A listed row prices its P/L off the live ask, not a realized net it lacks.
  const listBig = row('listBig', { status: 'listed', buyPrice: 1000, listPrice: 5000, buyTimestamp: NOW });
  assertEq('listed ask-buy can outrank a sold realized P/L',
    order([soldHi, listBig], LedgerSort.biggestPl).join(','), 'listBig,soldHi');
}

// ── null sinking is exhaustive across every comparator ────────────────────────

console.log('\nnull keys sink to the bottom (all comparators)');
{
  const heldOnly = [
    row('h1', { status: 'held', buyPrice: 1000, buyTimestamp: NOW - 1 * DAY }),
    row('h2', { status: 'held', buyPrice: 1000, buyTimestamp: NOW - 2 * DAY }),
  ];
  // Held rows have null roiPct and null P/L -> bestRoi/biggestPl keep input order.
  assertEq('bestRoi: all-null keeps input order (stable)',
    order(heldOnly, LedgerSort.bestRoi).join(','), 'h1,h2');
  assertEq('biggestPl: all-null keeps input order (stable)',
    order(heldOnly, LedgerSort.biggestPl).join(','), 'h1,h2');

  // held carries a real buy stamp but null roiPct/PL: it sinks ONLY on the ROI
  // and P/L sorts, while newest/oldest still order it by its (valid) stamp.
  assertEq('bestRoi: null-ROI held sinks below a live listed row',
    order([held, listA], LedgerSort.bestRoi).join(','), 'listA,held');
  assertEq('biggestPl: null-PL held sinks below a live listed row',
    order([held, listA], LedgerSort.biggestPl).join(','), 'listA,held');
  assertEq('newest: held keeps stamp order (older than listA)',
    order([held, listA], LedgerSort.newest).join(','), 'listA,held');
  assertEq('oldest: held keeps stamp order (older than listA -> first)',
    order([held, listA], LedgerSort.oldest).join(','), 'held,listA');
}

// ── stable / deterministic ties ───────────────────────────────────────────────

console.log('\nstable ties (equal keys keep input order)');
{
  // Two listed rows with the SAME projected ROI and P/L and buy stamp.
  const t1 = row('t1', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const t2 = row('t2', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const t3 = row('t3', { status: 'listed', buyPrice: 1000, listPrice: 1500, buyTimestamp: NOW });
  const tied = [t1, t2, t3];
  for (const id of ['newest', 'oldest', 'bestRoi', 'biggestPl']) {
    assertEq(`${id}: equal keys preserve input order`,
      order(tied, LedgerSort[id]).join(','), 't1,t2,t3');
    // Comparator returns exactly 0 for a true tie (relied on for stability).
    assertEq(`${id}: comparator returns 0 on a tie`, LedgerSort[id](t1, t2), 0);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
