// Backfill Torn auction sales into Supabase, back to the start of 2025.
// Run: node auction-db/backfill.mjs
//
// Reads keys from auction-db/secrets.local.json (gitignored). Copy
// secrets.example.json to secrets.local.json and fill in the three values.
//
// Walks the auction feed newest -> oldest using the `to` cursor, stopping
// at the start-of-2025 `from` clamp. Every row is upserted by listing id, so
// re-running is safe and overlapping pages cost nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const secretsPath = path.join(__dirname, 'secrets.local.json');
if (!fs.existsSync(secretsPath)) {
  console.error('Missing auction-db/secrets.local.json — copy secrets.example.json and fill it in.');
  process.exit(1);
}
const { TORN_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } =
  JSON.parse(fs.readFileSync(secretsPath, 'utf8'));

const TABLE         = 'auctions';
const LIMIT         = 100;                       // rows per Torn page
const TORN_DELAY_MS = 700;                       // ~85 req/min, under the 100 cap
const now           = Math.floor(Date.now() / 1000);
// Floor the walk at the start of 2025 (UTC). The resume cursor continues from
// the oldest sale already stored and steps older, so this extends the existing
// data back to Jan 2025 without re-walking the year already on disk.
const fromEpoch     = Math.floor(Date.UTC(2025, 0, 1) / 1000);

// Optional `--max-pages=N` flag: stop after N pages (for a quick smoke test).
// Absent = walk the full year.
const maxPagesArg = process.argv.find((a) => a.startsWith('--max-pages='));
const MAX_PAGES   = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Running tally so we can see exactly what the API did — and whether we ever
// tripped Torn's rate limit (error 5) or a temporary block.
const stats = { tornCalls: 0, rateLimitHits: 0, retries: 0 };

// Retry transient failures (dropped sockets, 5xx) with exponential backoff.
// Errors marked `.permanent` (bad key, 4xx) are rethrown immediately. An error
// carrying `.retryAfterMs` overrides the backoff (used for rate-limit cooldown).
async function withRetry(fn, label, tries = 6) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.permanent || i === tries) throw e;
      stats.retries++;
      const wait = e.retryAfterMs ?? Math.min(30000, 500 * 2 ** i);
      console.warn(`${label} failed (${i}/${tries}): ${e.message} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

// One API auction row -> one DB row.
function mapRow(a) {
  const it      = a.item || {};
  const stats   = it.stats || {};
  const bonuses = Array.isArray(it.bonuses) ? it.bonuses : [];
  const b0      = bonuses[0] || {};
  return {
    id: a.id,
    item_id: it.id ?? null,
    item_uid: it.uid ?? null,
    item_name: it.name ?? null,
    item_type: it.type ?? null,
    sub_type: it.sub_type ?? null,
    seller_id: a.seller?.id ?? null,
    seller_name: a.seller?.name ?? null,
    buyer_id: a.buyer?.id ?? null,
    buyer_name: a.buyer?.name ?? null,
    price: a.price ?? null,
    bids: a.bids ?? null,
    sold_at: a.timestamp ? new Date(a.timestamp * 1000).toISOString() : null,
    sold_at_epoch: a.timestamp ?? null,
    damage: stats.damage ?? null,
    accuracy: stats.accuracy ?? null,
    armor: stats.armor ?? null,
    quality: stats.quality ?? null,
    rarity: it.rarity ?? null,
    bonus_id: b0.id ?? null,
    bonus_title: b0.title ?? null,
    bonus_value: b0.value ?? null,
    bonuses,
    raw: a,
  };
}

async function fetchTornPage(toCursor) {
  const url = new URL('https://api.torn.com/v2/market/auctionhouse');
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('sort', 'DESC');
  url.searchParams.set('from', String(fromEpoch));
  url.searchParams.set('to', String(toCursor));
  url.searchParams.set('key', TORN_API_KEY);
  url.searchParams.set('comment', 'rwth-auction-backfill');
  return withRetry(async () => {
    stats.tornCalls++;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      const code = data.error.code;
      const err  = new Error(`Torn API error ${code}: ${data.error.error}`);
      if ([2, 10, 13, 16].includes(code)) {
        err.permanent = true;                     // key/access problem — retry won't help
      } else if ([5, 8, 9].includes(code)) {
        stats.rateLimitHits++;                    // 5=too many requests, 8=IP block, 9=API down
        err.retryAfterMs = 60_000;                // wait a full minute for the limit window to clear
        console.warn(`RATE LIMIT / temp error ${code}: ${data.error.error} — cooling down 60s`);
      }
      throw err;
    }
    return data.auctionhouse || [];
  }, 'Torn fetch');
}

async function upsert(rows) {
  if (!rows.length) return;
  return withRetry(async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const err = new Error(`Supabase upsert failed ${res.status}: ${await res.text()}`);
      if (res.status >= 400 && res.status < 500) err.permanent = true; // bad request/auth
      throw err;
    }
  }, 'Supabase upsert');
}

// Resume support: start from the oldest sale already stored so a restart
// continues instead of re-walking from now. Best-effort — defaults to now.
async function getResumeCursor() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=sold_at_epoch&order=sold_at_epoch.asc&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return now;
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.sold_at_epoch) return Math.min(now, rows[0].sold_at_epoch - 1);
  } catch { /* fall through */ }
  return now;
}

async function main() {
  console.log(`Backfilling auctions ${new Date(fromEpoch * 1000).toISOString()} -> now`);
  let cursor = await getResumeCursor();
  if (cursor < now) {
    console.log(`Resuming from existing data; oldest stored = ${new Date((cursor + 1) * 1000).toISOString()}`);
  }
  let total  = 0;
  let page   = 0;
  while (true) {
    const rows = await fetchTornPage(cursor);
    if (!rows.length) break;
    await upsert(rows.map(mapRow));
    total += rows.length;
    page  += 1;
    const oldest = Math.min(...rows.map((r) => r.timestamp));
    console.log(
      `page ${page}: +${rows.length} (total ${total}) oldest=${new Date(oldest * 1000).toISOString()}`,
    );
    if (page >= MAX_PAGES) { console.log(`Reached --max-pages=${MAX_PAGES}, stopping early.`); break; }
    if (oldest <= fromEpoch) break;   // hit the one-year floor
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
