// Physically reclaim table space with VACUUM FULL — e.g. after dropping the
// `raw` column, whose 98 MB stays on disk until the table is rewritten.
// Run: node auction-db/vacuum.mjs
//
// VACUUM cannot run inside a transaction block, so it can't go through the
// Supabase SQL editor or the transaction pooler (both wrap statements in a
// transaction — that's the "VACUUM cannot run inside a transaction block"
// error). node-postgres issues simple queries in autocommit with no implicit
// BEGIN/COMMIT, so VACUUM FULL goes through here over a DIRECT connection.
//
// Setup (one time):
//   1. cd auction-db && npm install        (installs `pg`, see package.json)
//   2. Add SUPABASE_DB_URL to secrets.local.json — the *Direct connection*
//      string from Supabase: Settings -> Database -> Connection string ->
//      Direct connection (host db.<ref>.supabase.co, port 5432, NOT the 6543
//      pooler). It already includes the password.
//   3. node auction-db/vacuum.mjs
//
// VACUUM FULL takes an ACCESS EXCLUSIVE lock (the table is unreadable for the
// duration) and needs roughly the table's size in free disk to write the
// rewritten copy. At ~200 MB that's seconds and well within the 2 GB disk.

import pg from 'pg';
import { loadSecrets } from './lib.mjs';

const TABLE = 'public.auctions';

function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

async function sizeBytes(client) {
  const r = await client.query(`select pg_total_relation_size($1) as bytes`, [TABLE]);
  return Number(r.rows[0].bytes);
}

async function main() {
  const secrets = loadSecrets();
  const connectionString = secrets.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('Missing SUPABASE_DB_URL in secrets.local.json — paste the Direct');
    console.error('connection string from Supabase (Settings -> Database -> Connection');
    console.error('string -> Direct connection, port 5432).');
    process.exit(1);
  }

  // Supabase requires SSL; the direct cert is not in Node's trust store, so skip
  // verification for this one-off admin connection.
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const before = await sizeBytes(client);
    console.log(`before: ${fmtBytes(before)} (${TABLE})`);
    console.log('running VACUUM FULL — table is locked until it finishes...');
    const t0 = Date.now();
    await client.query(`VACUUM FULL ${TABLE}`);
    const after = await sizeBytes(client);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`after:  ${fmtBytes(after)}  (reclaimed ${fmtBytes(before - after)} in ${secs}s)`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
