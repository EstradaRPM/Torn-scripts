// Quick health check of the auctions table. Run: node auction-db/check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } =
  JSON.parse(fs.readFileSync(path.join(__dirname, 'secrets.local.json'), 'utf8'));

const base = `${SUPABASE_URL}/rest/v1/auctions`;
const h = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

const countRes = await fetch(`${base}?select=id&limit=1`, { headers: { ...h, Prefer: 'count=exact' } });
const total = countRes.headers.get('content-range')?.split('/')[1];
const oldest = (await (await fetch(`${base}?select=sold_at&order=sold_at.asc&limit=1`, { headers: h })).json())[0]?.sold_at;
const newest = (await (await fetch(`${base}?select=sold_at&order=sold_at.desc&limit=1`, { headers: h })).json())[0]?.sold_at;
const sample = (await (await fetch(`${base}?select=item_name,bonus_title,bonus_value,quality,price,sold_at&order=sold_at.desc&limit=3`, { headers: h })).json());

console.log(`Total rows:  ${total}`);
console.log(`Oldest sale: ${oldest}`);
console.log(`Newest sale: ${newest}`);
console.log('Newest 3 rows:');
for (const r of sample) console.log(`  ${r.item_name} | ${r.bonus_title} ${r.bonus_value} | q${r.quality} | $${r.price} | ${r.sold_at}`);
