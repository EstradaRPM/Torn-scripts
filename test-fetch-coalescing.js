// node test-fetch-coalescing.js
// Focused harness for RWTH in-flight request coalescing. Requires the shipped
// userscript through __RwthPure and counts mocked transports.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function makeMockStorage() {
  const data = {};
  return {
    get length() { return Object.keys(data).length; },
    key: i => Object.keys(data)[i] || null,
    getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};
localStorage.setItem('rwth_settings', JSON.stringify({ apiKey: 'TEST_KEY' }));
localStorage.setItem('rwth_items_dict', JSON.stringify({
  ts: Date.now(),
  byName: {
    'Enfield SA-80': { id: 123, name: 'Enfield SA-80', type: 'primary', rarity: null },
    'enfield sa-80': { id: 123, name: 'Enfield SA-80', type: 'primary', rarity: null },
  },
}));

require('./TORN-RW-trading-hub.user.js');

const { Cache, ListingsFetcher, SupabaseClient } = globalThis.__RwthPure;

function resetCaches() {
  Cache.clear();
  ListingsFetcher.clear();
  if (SupabaseClient._inflight) SupabaseClient._inflight.clear();
}

test('SupabaseClient coalesces identical concurrent searches', async () => {
  resetCaches();
  let calls = 0;
  globalThis.__RWTH_GM = (opts) => {
    calls++;
    setTimeout(() => opts.onload({
      status: 200,
      responseText: JSON.stringify([
        {
          item_name: 'Enfield SA-80',
          price: 1000,
          quality: 12,
          sold_at_epoch: 1710000000,
          bonus_id: 10,
          bonus_title: 'Deadeye',
          bonus_value: 25,
          bonuses: [{ id: 10, value: 25 }],
          rarity: 'yellow',
        },
      ]),
    }), 5);
  };

  const query = {
    item_name: 'Enfield SA-80',
    bonus1_id: 10,
    rarity: 'yellow',
    sort_by: 'timestamp',
    sort_order: 'desc',
    limit: 20,
    offset: 0,
  };
  const [a, b] = await Promise.all([
    SupabaseClient.search(query),
    SupabaseClient.search(query),
  ]);

  assert.equal(calls, 1);
  assert.equal(a.total, 1);
  assert.deepEqual(b, a);
  assert.equal(SupabaseClient._inflight.size, 0);
});

test('SupabaseClient clears failed in-flight searches for retry', async () => {
  resetCaches();
  let calls = 0;
  globalThis.__RWTH_GM = (opts) => {
    calls++;
    setTimeout(() => opts.onload({ status: 500, responseText: '{}' }), 5);
  };

  const query = { item_name: 'Retry Blade', limit: 20, offset: 0 };
  await assert.rejects(Promise.all([
    SupabaseClient.search(query),
    SupabaseClient.search(query),
  ]), /HTTP 500/);
  assert.equal(calls, 1);
  assert.equal(SupabaseClient._inflight.size, 0);

  await assert.rejects(SupabaseClient.search(query), /HTTP 500/);
  assert.equal(calls, 2);
});

test('ListingsFetcher coalesces identical concurrent item-market fetches', async () => {
  resetCaches();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return {
      async json() {
        return {
          itemmarket: {
            listings: [
              {
                id: 77,
                price: 2000,
                item_details: {
                  rarity: 'yellow',
                  bonuses: [{ name: 'Deadeye', value: 25 }],
                  stats: { quality: 12 },
                },
              },
            ],
          },
        };
      },
    };
  };

  const item = {
    itemId: 123,
    itemName: 'Enfield SA-80',
    type: 'primary',
    rarity: 'yellow',
    bonuses: [{ name: 'Deadeye', value: 25 }],
  };
  const [a, b] = await Promise.all([
    ListingsFetcher.fetch(item),
    ListingsFetcher.fetch(item),
  ]);

  assert.equal(calls, 1);
  assert.equal(a.market.length, 1);
  assert.deepEqual(b, a);
  assert.equal(ListingsFetcher._inflight.size, 0);
});
