// Forward-fill: pull auction sales newer than the newest row already stored.
// Run: node auction-db/poll.mjs
//
// Designed to run on a schedule (e.g. every 4h, or twice a day) or by hand.
// It reads the newest stored sale, then walks the feed newest -> oldest from
// now back to that point, upserting as it goes. The window starts at the
// newest stored second *inclusive* so any same-second sale we missed is caught;
// the boundary row simply re-upserts at no cost.
//
// Volume is ~300 sales/day, so a 4h gap is ~1 page and a 12h gap ~2 pages.
// If the table is empty, run backfill.mjs first — there is no floor to walk to.

import {
  TORN_DELAY_MS, sleep, stats,
  loadSecrets, mapRow, hasBonus, fetchTornPage, upsert, boundaryEpoch,
} from './lib.mjs';

const secrets = loadSecrets();
const now     = Math.floor(Date.now() / 1000);

async function main() {
  const newestStored = await boundaryEpoch(secrets, 'desc');
  if (newestStored == null) {
    console.error('Table is empty — run `node auction-db/backfill.mjs` first.');
    process.exit(1);
  }
  const fromEpoch = newestStored;   // inclusive overlap on the boundary second
  console.log(`Polling for sales since ${new Date(fromEpoch * 1000).toISOString()} -> now`);

  let cursor = now;
  let total  = 0;
  let page   = 0;
  while (true) {
    const rows = await fetchTornPage(secrets, { from: fromEpoch, to: cursor, comment: 'rwth-auction-poll' });
    if (!rows.length) break;
    const kept = rows.map(mapRow).filter(hasBonus);
    await upsert(secrets, kept);
    total += kept.length;
    page  += 1;
    const oldest = Math.min(...rows.map((r) => r.timestamp));
    console.log(
      `page ${page}: +${kept.length}/${rows.length} bonus rows (total ${total}) oldest=${new Date(oldest * 1000).toISOString()}`,
    );
    if (oldest <= fromEpoch) break;   // caught up to existing data
    cursor = oldest - 1;              // step to older records within the new window
    await sleep(TORN_DELAY_MS);
  }
  console.log(`Done. Upserted ${total} auctions over ${page} pages (some overlap re-upserts harmlessly).`);
  console.log(`API summary: ${stats.tornCalls} Torn calls, ${stats.retries} retries, ${stats.rateLimitHits} rate-limit/temp hits.`);
  if (stats.rateLimitHits) {
    console.log('NOTE: Torn throttled us at least once — raise TORN_DELAY_MS to slow the pace.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
