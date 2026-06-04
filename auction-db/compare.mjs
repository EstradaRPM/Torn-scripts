// Dry-run the hub swap: compare comps from the third-party WinterValor Supabase
// (what the hub reads today) against our own auctions table, for the same
// item+bonus queries. Both result sets go through a faithful port of the hub's
// compShape() so we are comparing exactly what the verdict math would see.
//
// Run: node auction-db/compare.mjs
//
// Picks the most common item+primary-bonus combos from our own DB (guaranteed
// data on our side), then for each runs the query against both sources and
// prints n / median / min / max side by side. Read-only — writes nothing.

import { loadSecrets, TABLE } from './lib.mjs';

const secrets = loadSecrets();

// Third-party source the hub reads today (values lifted from the userscript's
// RWTH_API block — they ship in the public script, so not secrets).
const TP_URL = 'https://btrmmuuoofbonmuwrkzg.supabase.co';
const TP_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cm1tdXVvb2Zib25tdXdya3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTEzMTgsImV4cCI6MjA4NDQyNzMxOH0.E-s0k46BORXLICAvxtEpqoM3Qmh4-TRLaJAwXO6wJTY';

const ourHeaders = {
  apikey: secrets.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${secrets.SUPABASE_SERVICE_KEY}`,
};

// ── Faithful port of the hub's compShape() (TORN-RW-trading-hub.user.js) ──────
// Only the fields the verdict math reads. Returns null when there is no price.
function compShape(c) {
  if (!c || typeof c !== 'object') return null;
  const p = Number(c.price != null ? c.price
            : c.final_price != null ? c.final_price
            : c.cost != null ? c.cost
            : c.buyout != null ? c.buyout : NaN);
  if (!Number.isFinite(p)) return null;
  const q = Number(c.quality != null ? c.quality
            : c.qualityPct != null ? c.qualityPct
            : c.stat_quality != null ? c.stat_quality : NaN);
  const tsRaw = c.timestamp != null ? c.timestamp
              : c.sold_at != null ? c.sold_at
              : c.created_at != null ? c.created_at : null;
  let timestamp = null;
  if (tsRaw != null) {
    const n = Number(tsRaw);
    if (Number.isFinite(n) && n > 0) timestamp = n < 1e12 ? n * 1000 : n;
    else { const d = Date.parse(tsRaw); if (Number.isFinite(d)) timestamp = d; }
  }
  const bvFromArray = (Array.isArray(c.bonus_values) && c.bonus_values.length
                       && c.bonus_values[0] && c.bonus_values[0].bonus_value != null)
    ? c.bonus_values[0].bonus_value : null;
  const bvRaw = c.bonusValue != null ? c.bonusValue
              : c.bonus1_value != null ? c.bonus1_value
              : c.bonusPct != null ? c.bonusPct
              : bvFromArray != null ? bvFromArray : null;
  const bv = bvRaw != null ? Number(bvRaw) : NaN;
  return {
    price: p,
    quality: Number.isFinite(q) ? q : 0,
    timestamp,
    bonusValue: Number.isFinite(bv) ? bv : null,
  };
}

// ── Map one of OUR rows into the shape the swapped client would hand the hub ──
// Mirrors the third-party row: item_name, price, quality, timestamp (epoch),
// and bonus_values:[{bonus_id,bonus_value}] derived from our bonuses jsonb.
function ourRowToHubRow(r) {
  const b0 = Array.isArray(r.bonuses) && r.bonuses[0] ? r.bonuses[0] : null;
  return {
    item_name: r.item_name,
    price: r.price,
    quality: r.quality,
    timestamp: r.sold_at_epoch,
    bonus_values: b0 ? [{ bonus_id: b0.id, bonus_value: b0.value }]
                     : (r.bonus_value != null ? [{ bonus_id: r.bonus_id, bonus_value: r.bonus_value }] : []),
  };
}

const median = (xs) => {
  const a = xs.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const fmt = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'));

// Same query the hub sends to search-auctions (fetchComps).
async function fetchThirdParty({ item_name, bonus1_id }) {
  const body = { limit: 20, offset: 0, sort_by: 'timestamp', sort_order: 'desc', item_name };
  if (bonus1_id != null) body.bonus1_id = bonus1_id;
  const res = await fetch(`${TP_URL}/functions/v1/search-auctions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: TP_ANON, Authorization: `Bearer ${TP_ANON}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`third-party HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return (data && data.auctions) || [];
}

// Equivalent query against our table via PostgREST. bonus1_id == primary bonus,
// which we store denormalized as bonus_id (= bonuses[0].id).
async function fetchOurs({ item_name, bonus1_id }) {
  const u = new URL(`${secrets.SUPABASE_URL}/rest/v1/${TABLE}`);
  u.searchParams.set('select', 'item_name,price,quality,sold_at_epoch,bonus_id,bonus_value,bonuses');
  u.searchParams.set('item_name', `eq.${item_name}`);
  if (bonus1_id != null) u.searchParams.set('bonus_id', `eq.${bonus1_id}`);
  u.searchParams.set('order', 'sold_at_epoch.desc');
  u.searchParams.set('limit', '20');
  const res = await fetch(u, { headers: ourHeaders });
  if (!res.ok) throw new Error(`ours HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).map(ourRowToHubRow);
}

// Pick the most common item + primary-bonus combos from our recent rows so the
// comparison always has data on our side.
async function pickCases(n) {
  const u = new URL(`${secrets.SUPABASE_URL}/rest/v1/${TABLE}`);
  u.searchParams.set('select', 'item_name,bonus_id,bonus_title');
  u.searchParams.set('bonus_id', 'not.is.null');
  u.searchParams.set('item_name', 'not.is.null');
  u.searchParams.set('order', 'sold_at_epoch.desc');
  u.searchParams.set('limit', '2000');
  const rows = await (await fetch(u, { headers: ourHeaders })).json();
  const tally = new Map();
  for (const r of rows) {
    const key = `${r.item_name}|${r.bonus_id}|${r.bonus_title}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => {
      const [item_name, bonus_id, bonus_title] = key.split('|');
      return { item_name, bonus1_id: Number(bonus_id), bonus_title };
    });
}

function summarize(rows) {
  const shaped = rows.map(compShape).filter(Boolean);
  const prices = shaped.map((c) => c.price);
  return {
    n: shaped.length,
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    withBonus: shaped.filter((c) => c.bonusValue != null).length,
    withTs: shaped.filter((c) => c.timestamp != null).length,
  };
}

async function main() {
  const cases = await pickCases(8);
  console.log(`Comparing ${cases.length} item+bonus queries: third-party (hub today) vs ours.\n`);
  for (const c of cases) {
    const label = `${c.item_name} [${c.bonus_title} #${c.bonus1_id}]`;
    let tp, ours;
    try { tp = summarize(await fetchThirdParty(c)); }
    catch (e) { tp = { err: e.message }; }
    try { ours = summarize(await fetchOurs(c)); }
    catch (e) { ours = { err: e.message }; }

    console.log(`■ ${label}`);
    if (tp.err) console.log(`    third-party: ERROR ${tp.err}`);
    else console.log(`    third-party: n=${tp.n}  median=${fmt(tp.median)}  range=${fmt(tp.min)}–${fmt(tp.max)}  bonus✓=${tp.withBonus}  ts✓=${tp.withTs}`);
    if (ours.err) console.log(`    ours:        ERROR ${ours.err}`);
    else console.log(`    ours:        n=${ours.n}  median=${fmt(ours.median)}  range=${fmt(ours.min)}–${fmt(ours.max)}  bonus✓=${ours.withBonus}  ts✓=${ours.withTs}`);
    if (!tp.err && !ours.err && tp.median && ours.median) {
      const diff = ((ours.median - tp.median) / tp.median) * 100;
      console.log(`    median delta: ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`);
    }
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
