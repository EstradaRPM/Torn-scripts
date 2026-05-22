// node test-rwth.js
// RW Trading Hub test suite (ADR-0002): a Node shim stubs browser globals,
// then requires the shipped .user.js directly so tests exercise real code.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

// ── Browser-global shim ──────────────────────────────────────────────────────
function makeMockStorage() {
  const data = {};
  return {
    getItem:    k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem:    (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear:      () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;            // tells the IIFE to skip DOM bootstrap
globalThis.localStorage = makeMockStorage();
globalThis.document = {};                   // stub; bootstrap is skipped, so unused

require('./TORN-RW-trading-hub.user.js');

// ── Tests ────────────────────────────────────────────────────────────────────
test('__RwthPure seam exists', () => {
  assert.strictEqual(typeof globalThis.__RwthPure, 'object');
  assert.notStrictEqual(globalThis.__RwthPure, null);
});

test('build* tab functions are exposed and return strings', () => {
  const P = globalThis.__RwthPure;
  for (const fn of ['buildLedgerTab', 'buildAdvertiseTab', 'buildSettingsTab']) {
    assert.strictEqual(typeof P[fn], 'function', `${fn} should be exposed`);
    assert.strictEqual(typeof P[fn](), 'string', `${fn}() should return a string`);
  }
});

test('buildContent dispatches on activeTab', () => {
  const { buildContent } = globalThis.__RwthPure;
  assert.match(buildContent({ ui: { activeTab: 'ledger' } }), /rwth-ledger/);
  assert.match(buildContent({ ui: { activeTab: 'advertise' } }), /Advertise/);
  assert.match(buildContent({ ui: { activeTab: 'settings' } }), /data-setting/);
  assert.strictEqual(buildContent({ ui: { activeTab: 'bogus' } }), '');
});

test('buildSettingsTab renders all six fields', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: {} });
  for (const key of ['playerId', 'forumThreadUrl', 'weav3rPricelistUrl',
                      'bannerImageUrl', 'forumHeaderImageUrl', 'apiKey']) {
    assert.match(html, new RegExp(`data-setting="${key}"`), `${key} field should render`);
  }
});

test('buildSettingsTab pre-fills current values', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: { playerId: '987654', apiKey: '###PDA-APIKEY###' } });
  assert.match(html, /value="987654"/);
  assert.match(html, /value="###PDA-APIKEY###"/);
});

test('buildSettingsTab escapes values into the value attribute', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: { forumThreadUrl: 'a"<b&c' } });
  assert.match(html, /value="a&quot;&lt;b&amp;c"/);
});

test('buildSettingsTab tolerates a missing settings object', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  assert.strictEqual(typeof buildSettingsTab({}), 'string');
  assert.strictEqual(typeof buildSettingsTab(), 'string');
});

test('buildSettingsTab renders a Save button', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  assert.match(buildSettingsTab({ settings: {} }), /data-action="save-settings"/);
});

test('buildSettingsTab masks the API key as a password field', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: {} });
  assert.match(html, /type="password" data-setting="apiKey"/);
});

// ── Ledger (slice 3) ─────────────────────────────────────────────────────────
const heldItem = {
  id: 'a1', itemName: 'Diamond Bladed Knife', type: 'weapon',
  bonuses: [{ name: 'Fury', value: 25 }], quality: 80,
  buyPrice: 600000, buyTimestamp: Date.UTC(2026, 4, 1), buySource: 'market',
  status: 'held', saleNet: null,
};
const soldItem = {
  ...heldItem, id: 'b2', status: 'sold', buyPrice: 600000, saleNet: 900000,
};

test('ROI.compute returns saleNet - buyPrice for a sold item', () => {
  const { ROI } = globalThis.__RwthPure;
  assert.strictEqual(ROI.compute(soldItem), 300000);
  assert.strictEqual(ROI.compute({ saleNet: 500, buyPrice: 800 }), -300);
});

test('ROI.compute returns null when the item is not sold', () => {
  const { ROI } = globalThis.__RwthPure;
  assert.strictEqual(ROI.compute(heldItem), null);
  assert.strictEqual(ROI.compute(null), null);
});

test('buildLedgerTab renders an + add button and a status filter', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [], statusFilter: 'all' } });
  assert.match(html, /data-action="add-item"/);
  for (const f of ['all', 'held', 'listed', 'sold']) {
    assert.match(html, new RegExp(`data-filter="${f}"`));
  }
});

test('buildLedgerTab renders a row per item with name, bonus and price', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem], statusFilter: 'all' } });
  assert.match(html, /Diamond Bladed Knife/);
  assert.match(html, /Fury 25%/);
  assert.match(html, /\$600,000/);
  assert.match(html, /data-row-toggle="a1"/);
});

test('buildLedgerTab status filter narrows the visible rows', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem, soldItem], statusFilter: 'sold' } });
  assert.doesNotMatch(html, /data-row-toggle="a1"/);
  assert.match(html, /data-row-toggle="b2"/);
});

test('buildLedgerTab shows ROI in a sold row collapsed line', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [soldItem], statusFilter: 'all' } });
  assert.match(html, /\+\$300,000/);
});

test('buildLedgerTab expanded row exposes mark-listed / edit / delete actions', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [heldItem], statusFilter: 'all', expandedId: 'a1' } });
  assert.match(html, /data-action="mark-listed" data-id="a1"/);
  assert.match(html, /data-action="edit-item" data-id="a1"/);
  assert.match(html, /data-action="delete-item" data-id="a1"/);
});

test('buildLedgerTab renders the add form when editingId is set', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  const html = buildLedgerTab({ ledger: { items: [], statusFilter: 'all', editingId: 'new' } });
  assert.match(html, /data-form="itemName"/);
  assert.match(html, /data-form="buySource"/);
  assert.match(html, /data-action="save-item"/);
});

// ── Auction-win scan (slice 4) ───────────────────────────────────────────────
// A real auction-win log entry as returned by user/?selections=log&log=4320.
const logEntry = {
  id: 'YqMfrL3c7OjpBSkPo8cO',
  timestamp: 1779372185,
  details: { id: 4320, title: 'Auction house item win', category: 'Auctions' },
  data: {
    owner: 3727993,
    item: [{ id: 614, uid: 19121539308, qty: 1 }],
    final_price: 200000001,
    listing_id: 521625,
  },
};

test('parseAuctionWin reads item id and final price from a log entry', () => {
  const { parseAuctionWin } = globalThis.__RwthPure;
  const p = parseAuctionWin(logEntry, { 614: 'Diamond Bladed Knife' });
  assert.strictEqual(p.itemId, 614);
  assert.strictEqual(p.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(p.buyPrice, 200000001);
});

test('parseAuctionWin falls back to "Item #id" with no name map', () => {
  const { parseAuctionWin } = globalThis.__RwthPure;
  assert.strictEqual(parseAuctionWin(logEntry).itemName, 'Item #614');
  assert.strictEqual(parseAuctionWin({}).itemId, null);
  assert.strictEqual(parseAuctionWin({}).buyPrice, 0);
});

test('toScanHits maps the API log array and skips seen entry ids', () => {
  const { toScanHits } = globalThis.__RwthPure;
  const log = [
    logEntry,
    { id: 'EAS', timestamp: 1779368765, data: { item: [{ id: 24 }], final_price: 180000001 } },
  ];
  const hits = toScanHits(log, ['YqMfrL3c7OjpBSkPo8cO'], { 24: 'Pocket Knife' });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].key, 'EAS');
  assert.strictEqual(hits[0].itemId, 24);
  assert.strictEqual(hits[0].itemName, 'Pocket Knife');
  assert.strictEqual(hits[0].buyPrice, 180000001);
  assert.strictEqual(hits[0].buyTimestamp, 1779368765 * 1000);
});

test('toScanHits sorts newest first', () => {
  const { toScanHits } = globalThis.__RwthPure;
  const hits = toScanHits([
    { id: 'old', timestamp: 100, data: { item: [{ id: 1 }] } },
    { id: 'new', timestamp: 900, data: { item: [{ id: 2 }] } },
  ], [], {});
  assert.deepStrictEqual(hits.map(h => h.key), ['new', 'old']);
});

test('buildScanChecklist renders a checklist when scan results exist', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  const html = buildScanChecklist({ ledger: { scanResults: [
    { key: 'e2', itemName: 'Sword', bonusName: null, buyPrice: 200, buyTimestamp: 2e9 },
  ] } });
  assert.match(html, /data-scan-row="e2"/);
  assert.match(html, /data-scan-check/);
  assert.match(html, /data-scan-field="quality"/);
  assert.match(html, /data-action="confirm-scan"/);
});

test('buildScanChecklist is empty with no results', () => {
  const { buildScanChecklist } = globalThis.__RwthPure;
  assert.strictEqual(buildScanChecklist({ ledger: { scanResults: [] } }), '');
  assert.strictEqual(buildScanChecklist({}), '');
});

test('buildLedgerTab renders a Scan button and surfaces fetchError', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  assert.match(buildLedgerTab({ ledger: { items: [] } }), /data-action="scan"/);
  const err = buildLedgerTab({ ledger: { items: [] }, fetchError: 'API error: x' });
  assert.match(err, /rwth-banner/);
  assert.match(err, /API error: x/);
});
