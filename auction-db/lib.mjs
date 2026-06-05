// Shared helpers for the auction-db scripts (backfill + poll).
//
// Both walk the same Torn auction feed and write to the same Supabase table,
// so the row mapping, retry/backoff, fetch, and upsert all live here. The only
// difference between the two callers is which time window they walk and where
// they start the cursor.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TABLE         = 'auctions';
export const LIMIT         = 100;               // rows per Torn page
export const TORN_DELAY_MS = 700;               // ~85 req/min, under the 100 cap

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Running tally so callers can print exactly what the API did — and whether we
// ever tripped Torn's rate limit (error 5) or a temporary block.
export const stats = { tornCalls: 0, rateLimitHits: 0, retries: 0 };

export function loadSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.local.json');
  if (!fs.existsSync(secretsPath)) {
    console.error('Missing auction-db/secrets.local.json — copy secrets.example.json and fill it in.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
}

// Retry transient failures (dropped sockets, 5xx) with exponential backoff.
// Errors marked `.permanent` (bad key, 4xx) are rethrown immediately. An error
// carrying `.retryAfterMs` overrides the backoff (used for rate-limit cooldown).
export async function withRetry(fn, label, tries = 6) {
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

// Keep only bonus-bearing rows. The global feed is overwhelmingly null-bonus
// plain/unique items we never price; every RW armor/weapon we DO price carries
// at least one bonus, so this sheds the storage bloat without losing a single
// pricing comp. Applied at persist time only — the walk/cursor math still runs
// over the raw page so pagination is unaffected.
export const hasBonus = (r) => r != null && r.bonus_id != null;

// One API auction row -> one DB row.
export function mapRow(a) {
  const it        = a.item || {};
  const itemStats = it.stats || {};
  const bonuses   = Array.isArray(it.bonuses) ? it.bonuses : [];
  const b0        = bonuses[0] || {};
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
    damage: itemStats.damage ?? null,
    accuracy: itemStats.accuracy ?? null,
    armor: itemStats.armor ?? null,
    quality: itemStats.quality ?? null,
    rarity: it.rarity ?? null,
    bonus_id: b0.id ?? null,
    bonus_title: b0.title ?? null,
    bonus_value: b0.value ?? null,
    bonuses,
  };
}

// Fetch one DESC page of the auction feed for the window [from, to].
export async function fetchTornPage(secrets, { from, to, comment }) {
  const url = new URL('https://api.torn.com/v2/market/auctionhouse');
  url.searchParams.set('limit', String(LIMIT));
  url.searchParams.set('sort', 'DESC');
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(to));
  url.searchParams.set('key', secrets.TORN_API_KEY);
  url.searchParams.set('comment', comment);
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

export async function upsert(secrets, rows) {
  if (!rows.length) return;
  return withRetry(async () => {
    const res = await fetch(`${secrets.SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: secrets.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${secrets.SUPABASE_SERVICE_KEY}`,
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

// Oldest (dir='asc') or newest (dir='desc') sold_at_epoch already stored.
// Returns null when the table is empty or the read fails.
export async function boundaryEpoch(secrets, dir) {
  try {
    const order = dir === 'asc' ? 'sold_at_epoch.asc' : 'sold_at_epoch.desc';
    const url = `${secrets.SUPABASE_URL}/rest/v1/${TABLE}?select=sold_at_epoch&order=${order}&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: secrets.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${secrets.SUPABASE_SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.sold_at_epoch) return rows[0].sold_at_epoch;
  } catch { /* fall through */ }
  return null;
}
