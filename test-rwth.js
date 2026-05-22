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
