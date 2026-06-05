// Backfill Torn auction sales into Supabase, back to June 2023.
// Run: node auction-db/backfill.mjs
//
// Reads keys from auction-db/secrets.local.json (gitignored). Copy
// secrets.example.json to secrets.local.json and fill in the three values.
//
// Walks the auction feed newest -> oldest using the `to` cursor, stopping
// at the start-of-2025 `from` clamp. Every row is upserted by listing id, so
// re-running is safe and overlapping pages cost nothing. The cursor resumes
// from the oldest sale already stored, so a restart continues the walk
// instead of re-fetching the year already on disk.

import {
  TORN_DELAY_MS, sleep, stats,
  loadSecrets, mapRow, hasBonus, fetchTornPage, upsert, boundaryEpoch,
} from './lib.mjs';

const secrets   = loadSecrets();
const now       = Math.floor(Date.now() / 1000);
// Floor the walk at June 2023 (UTC) — ~3 years of total history, the depth
// King recommends for thin orange/red sets. Only bonus-bearing rows are kept
// (see hasBonus), so the deep history is the part we actually price, not the
// null-bonus firehose.
const fromEpoch = Math.floor(Date.UTC(2023, 5, 1) / 1000);

// Optional `--max-pages=N` flag: stop after N pages (for a quick smoke test).
// Absent = walk the full range.
const maxPagesArg = process.argv.find((a) => a.startsWith('--max-pages='));
const MAX_PAGES   = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : Infinity;

async function main() {
  console.log(`Backfilling auctions ${new Date(fromEpoch * 1000).toISOString()} -> now`);
  // Resume from the oldest sale already stored so a restart continues the walk.
  const oldestStored = await boundaryEpoch(secrets, 'asc');
  let cursor = oldestStored ? Math.min(now, oldestStored - 1) : now;
  if (cursor < now) {
    console.log(`Resuming from existing data; oldest stored = ${new Date((cursor + 1) * 1000).toISOString()}`);
  }
  let total = 0;
  let page  = 0;
  while (true) {
    const rows = await fetchTornPage(secrets, { from: fromEpoch, to: cursor, comment: 'rwth-auction-backfill' });
    if (!rows.length) break;
    const kept = rows.map(mapRow).filter(hasBonus);
    await upsert(secrets, kept);
    total += kept.length;
    page  += 1;
    const oldest = Math.min(...rows.map((r) => r.timestamp));
    console.log(
      `page ${page}: +${kept.length}/${rows.length} bonus rows (total ${total}) oldest=${new Date(oldest * 1000).toISOString()}`,
    );
    if (page >= MAX_PAGES) { console.log(`Reached --max-pages=${MAX_PAGES}, stopping early.`); break; }
    if (oldest <= fromEpoch) break;   // hit the start-of-2025 floor
    cursor = oldest - 1;              // step to older records
    await sleep(TORN_DELAY_MS);
  }
  console.log(`Done. Upserted ${total} auctions over ${page} pages.`);
  console.log(`API summary: ${stats.tornCalls} Torn calls, ${stats.retries} retries, ${stats.rateLimitHits} rate-limit/temp hits.`);
  if (stats.rateLimitHits) {
    console.log('NOTE: Torn throttled us at least once — raise TORN_DELAY_MS to slow the pace.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
