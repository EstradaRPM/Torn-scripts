// node test-rwth.js
// RW Trading Hub test suite (ADR-0002): a Node shim stubs browser globals,
// then requires the shipped .user.js directly so tests exercise real code.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT_PATH = path.join(__dirname, 'TORN-RW-trading-hub.user.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

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
  assert.match(buildContent({ ui: { activeTab: 'advertise' } }), /rwth-advertise/);
  assert.match(buildContent({ ui: { activeTab: 'settings' } }), /data-setting/);
  assert.strictEqual(buildContent({ ui: { activeTab: 'bogus' } }), '');
});

// #324 — the content-bearing link and picture fields moved into the Advertise
// tab; Settings keeps account (playerId/apiKey) + reach (viewCounterUrl).
test('buildSettingsTab renders the account and reach fields', () => {
  const { buildSettingsTab } = globalThis.__RwthPure;
  const html = buildSettingsTab({ settings: {} });
  for (const key of ['playerId', 'viewCounterUrl', 'apiKey']) {
    assert.match(html, new RegExp(`data-setting="${key}"`), `${key} field should render`);
  }
  for (const gone of ['forumThreadUrl', 'weav3rPricelistUrl', 'forumHeaderImageUrl']) {
    assert.doesNotMatch(html, new RegExp(`data-setting="${gone}"`),
                        `${gone} should no longer live in Settings`);
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
  const html = buildSettingsTab({ settings: { viewCounterUrl: 'a"<b&c' } });
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
// An auction-win log entry from /v2/user/log?log=4320 (log is an array;
// each entry carries its own id).
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

// ── Sell logging (slice 5) ───────────────────────────────────────────────────
test('SellParser.parse reads a bazaar sell line (no fees)', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to Apocolypse_ ' +
    'at $84,150,000 each for a total of $84,150,000');
  assert.strictEqual(s.itemName, 'Riot Body');
  assert.strictEqual(s.bonusName, 'Impregnable');
  assert.strictEqual(s.venue, 'bazaar');
  assert.strictEqual(s.buyer, 'Apocolypse_');
  assert.strictEqual(s.saleGross, 84150000);
  assert.strictEqual(s.saleNet, 84150000);
  assert.strictEqual(s.saleFees, 0);
  assert.strictEqual(s.anonymous, false);
});

test('SellParser.parse reads an item-market sell line with fees', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a pair of Combat Boots (Pinpoint) on the item market to Buyer123 ' +
    'at $5,000,000 each for a total of $9,500,000 after $500,000 in fees');
  assert.strictEqual(s.itemName, 'Combat Boots');
  assert.strictEqual(s.bonusName, 'Pinpoint');
  assert.strictEqual(s.venue, 'market');
  assert.strictEqual(s.buyer, 'Buyer123');
  assert.strictEqual(s.saleGross, 5000000);
  assert.strictEqual(s.saleNet, 9500000);
  assert.strictEqual(s.saleFees, 500000);
});

test('SellParser.parse handles the optional "anonymously" word', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Diamond Bladed Knife (Fury) anonymously on the item market ' +
    'at $3,000,000 each for a total of $2,850,000 after $150,000 in fees');
  assert.strictEqual(s.anonymous, true);
  assert.strictEqual(s.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(s.bonusName, 'Fury');
  assert.strictEqual(s.buyer, null);
  assert.strictEqual(s.saleNet, 2850000);
});

test('SellParser.parse handles a sell line with no bonus in parentheses', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Pocket Knife on your bazaar to Tester at $100 each for a total of $100');
  assert.strictEqual(s.itemName, 'Pocket Knife');
  assert.strictEqual(s.bonusName, null);
});

test('SellParser.parse handles a multi-line block', () => {
  const { SellParser } = globalThis.__RwthPure;
  const sells = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1\n' +
    'You sold a pair of Combat Boots (Pinpoint) on the item market to B_ at $2 each for a total of $2');
  assert.strictEqual(sells.length, 2);
  assert.strictEqual(sells[0].itemName, 'Riot Body');
  assert.strictEqual(sells[1].itemName, 'Combat Boots');
});

test('SellParser.parse associates an interleaved timestamp with the next sale', () => {
  const { SellParser } = globalThis.__RwthPure;
  const ts = Date.UTC(2026, 4, 20, 12, 0, 0);
  const sells = SellParser.parse(
    '2026-05-20T12:00:00Z\n' +
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1');
  assert.strictEqual(sells[0].timestamp, ts);
});

test('SellParser.parse leaves timestamp null when none precedes the sale', () => {
  const { SellParser } = globalThis.__RwthPure;
  const [s] = SellParser.parse(
    'You sold a Riot Body (Impregnable) on your bazaar to A_ at $1 each for a total of $1');
  assert.strictEqual(s.timestamp, null);
});

test('SellParser.parse ignores lines that are not sell lines', () => {
  const { SellParser } = globalThis.__RwthPure;
  assert.deepStrictEqual(SellParser.parse('just some random text\nnot a sale'), []);
  assert.deepStrictEqual(SellParser.parse(''), []);
});

const openHeld = {
  id: 'h1', itemName: 'Riot Body', status: 'held',
  bonuses: [{ name: 'Impregnable', value: 10 }], buyPrice: 80000000,
};
const openListed = {
  id: 'l1', itemName: 'Riot Body', status: 'listed',
  bonuses: [{ name: 'Impenetrable', value: 8 }], buyPrice: 70000000,
};

test('matchSell matches an open row by item name', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sell = { itemName: 'Riot Body', bonusName: null };
  assert.strictEqual(matchSell(sell, [openHeld]).id, 'h1');
});

test('matchSell uses bonus name as a tiebreaker', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sell = { itemName: 'Riot Body', bonusName: 'Impenetrable' };
  assert.strictEqual(matchSell(sell, [openHeld, openListed]).id, 'l1');
});

test('matchSell returns null when nothing matches', () => {
  const { matchSell } = globalThis.__RwthPure;
  assert.strictEqual(matchSell({ itemName: 'Unknown Item' }, [openHeld]), null);
  assert.strictEqual(matchSell({ itemName: 'Riot Body' }, []), null);
});

test('matchSell ignores already-sold rows', () => {
  const { matchSell } = globalThis.__RwthPure;
  const sold = { id: 's1', itemName: 'Riot Body', status: 'sold', bonuses: [] };
  assert.strictEqual(matchSell({ itemName: 'Riot Body' }, [sold]), null);
});

// Every non-duplicate sale posts to Recent Transactions (matched ones also
// close their ledger row); duplicates are already logged and skipped.
test('summarizeSells counts parsed / matched / duplicate / recent', () => {
  const { summarizeSells } = globalThis.__RwthPure;
  const s = summarizeSells([
    { matchedId: 'a' }, { matchedId: null }, { matchedId: 'c', duplicate: true },
  ]);
  assert.deepStrictEqual(s, { parsed: 3, matched: 2, duplicate: 1, recent: 2 });
  assert.deepStrictEqual(summarizeSells([]),
                         { parsed: 0, matched: 0, duplicate: 0, recent: 0 });
});

test('buildSellBox renders the paste box by default', () => {
  const { buildSellBox } = globalThis.__RwthPure;
  const html = buildSellBox({ ledger: {} });
  assert.match(html, /data-sell-input/);
  assert.match(html, /data-action="parse-sells"/);
});

test('buildSellBox renders the confirmation summary when a preview is staged', () => {
  const { buildSellBox } = globalThis.__RwthPure;
  const html = buildSellBox({ ledger: { sellPreview: {
    rows: [{ sell: { itemName: 'Riot Body', saleNet: 1 }, matchedId: 'h1' }],
    summaryText: '1 sale parsed, 1 matched, 0 → Recent Transactions',
  } } });
  assert.match(html, /1 sale parsed, 1 matched/);
  assert.match(html, /data-action="commit-sells"/);
  assert.match(html, /data-action="cancel-sells"/);
});

test('buildLedgerTab includes the Log-a-sale box', () => {
  const { buildLedgerTab } = globalThis.__RwthPure;
  assert.match(buildLedgerTab({ ledger: { items: [] } }), /data-sell-input/);
});

// ── Advertise (slice 6) ──────────────────────────────────────────────────────
const listedEnfield = {
  id: 'e1', itemName: 'Enfield SA-80', type: 'weapon', status: 'listed',
  bonuses: [{ name: 'Deadeye', value: 29 }], quality: 70, listPrice: 118000000,
};
const listedRiot = {
  id: 'r1', itemName: 'Riot Body', type: 'armor', status: 'listed',
  bonuses: [], quality: 6.5, listPrice: 78000000,
};

test('AdvertiseGenerator.toChat abbreviates known item names via ITEM_ABBREV', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([listedEnfield], {});
  assert.match(out, /<b>Enfield<\/b>/);
  assert.doesNotMatch(out, /SA-80/);
});

test('AdvertiseGenerator.toChat defaults parens to the bonus, falls back to quality', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.match(AdvertiseGenerator.toChat([listedEnfield], {}), /\(Deadeye 29%\)/);
  assert.match(AdvertiseGenerator.toChat([listedRiot], {}), /\(6\.5% q\)/);
});

test('AdvertiseGenerator.toChat omits links when settings are blank', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([], {});
  assert.doesNotMatch(out, /Bazaar|Forum/);
});

test('buildAdvertiseTab default-checks all listed rows with price input + IMG button', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [listedEnfield, listedRiot] },
    settings: {},
  });
  assert.strictEqual((html.match(/data-adv-check checked/g) || []).length, 2);
  assert.match(html, /data-adv-field="listPrice"/);
  assert.match(html, /data-action="toggle-img"/);
  assert.match(html, /value="118000000"/);
});

test('buildAdvertiseTab honours an explicit selectedIds list', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: ['e1'], transactions: [] },
    ledger: { items: [listedEnfield, listedRiot] },
    settings: {},
  });
  assert.strictEqual((html.match(/data-adv-check checked/g) || []).length, 1);
});

test('buildAdvertiseTab renders the Recent Transactions editor', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [
      { id: 't1', itemName: 'Riot Body', bonusName: 'Impregnable',
        buyer: 'Apocolypse_', price: 84150000, origin: 'paste' },
    ] },
    ledger: { items: [] },
    settings: {},
  });
  assert.match(html, /data-tx-row="t1"/);
  assert.match(html, /value="Apocolypse_"/);
  assert.match(html, /data-action="add-tx"/);
  assert.match(html, /data-action="remove-tx"/);
});

// #316/#325 — the forum title is user-configured shop identity (neutral
// default when blank), so no hard-coded title copy is asserted here.
test('buildAdvertiseTab renders both quick-copy text boxes with copy buttons', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] },
    settings: {},
  });
  assert.match(html, /data-copy-target="rwth-out-title"/);
  assert.match(html, /data-copy-target="rwth-out-chat"/);
});

test('buildAdvertiseTab tolerates a bare call', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  assert.strictEqual(typeof buildAdvertiseTab(), 'string');
});

// ── Advertise HTML outputs (slice 7) ─────────────────────────────
const advItems = [
  { id: 'e1', itemName: 'Enfield SA-80', bonuses: [{ name: 'Deadeye', value: 29 }],
    listPrice: 118000000, gyazoUrl: 'https://i.gyazo.com/abc.jpg' },
  { id: 'r1', itemName: 'Riot Body', bonuses: [], listPrice: 78000000, gyazoUrl: '' },
];
const advTxs = [{ id: 't1', itemName: 'Riot Body', bonusName: 'Impregnable',
                  buyer: 'Apocolypse_', price: 84150000 }];
const advSettings = { playerId: '1171127',
                      bannerImageUrl: 'https://i.gyazo.com/banner.jpg' };


test('toForumHtml injects item screenshots and omits the row when absent', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings);
  assert.strictEqual((html.match(/i\.gyazo\.com\/abc/g) || []).length, 2);
});

// #322 — per-surface picture: forumImageUrl wins for the forum, else the
// shared bannerImageUrl; the image replaces the wordmark/Trading Post header.
test('toForumHtml uses the forum picture override, replacing the wordmark header', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml([], [], { forumImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
  assert.doesNotMatch(html, /Trading Post/);
  const shared = AdvertiseGenerator.toForumHtml([], [], { bannerImageUrl: 'https://i.gyazo.com/shared.jpg' });
  assert.match(shared, /src="https:\/\/i\.gyazo\.com\/shared\.jpg"/);
});

test('toForumHtml omits the Recent Transactions section when there are none', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, [], advSettings);
  assert.doesNotMatch(html, /Recent Transactions/);
});

test('toBazaarHtml uses the Verdana font scheme, not all-Courier', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toBazaarHtml(advSettings);
  assert.match(html, /font-family: Verdana, Geneva, sans-serif/);
  assert.doesNotMatch(html, /Courier/);
});

test('toBazaarHtml renders the bazaar banner and drops it when blank', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.match(AdvertiseGenerator.toBazaarHtml(advSettings), /src="https:\/\/i\.gyazo\.com\/banner\.jpg"/);
  assert.doesNotMatch(AdvertiseGenerator.toBazaarHtml({}), /<img/);
});

test('toSignatureHtml is item-driven and condensed with compact prices', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toSignatureHtml(advItems, advSettings);
  assert.match(html, /Enfield SA-80/);
  assert.match(html, /\$118m/);
  assert.match(html, /\$78m/);
});

// #322 — same per-surface rule for the signature: signatureImageUrl wins,
// else the shared bannerImageUrl drives the header.
test('toSignatureHtml uses the signature override, falling back to the shared banner', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toSignatureHtml(advItems, { signatureImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
  const shared = AdvertiseGenerator.toSignatureHtml(advItems, advSettings);
  assert.match(shared, /src="https:\/\/i\.gyazo\.com\/banner\.jpg"/);
});

// #325 — the three per-surface boxes were unified into one surface switcher:
// segmented Forum/Bazaar/Signature buttons over a single rwth-out-surface
// copy box, plus a Preview/Edit-HTML flip.
test('buildAdvertiseTab renders the surface switcher with one Copy HTML box', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] }, settings: {},
  });
  for (const surface of ['forum', 'bazaar', 'signature']) {
    assert.match(html, new RegExp(`data-action="set-adv-surface" data-surface="${surface}"`));
  }
  assert.match(html, /data-copy-target="rwth-out-surface"/);
  assert.match(html, /data-action="toggle-adv-raw"/);
});

test('buildAdvertiseTab renders a per-item IMG button and opens its popover', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const listed = { id: 'e1', itemName: 'Enfield SA-80', type: 'weapon',
                   status: 'listed', bonuses: [], listPrice: 1 };
  const closed = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [], imgEditId: null },
    ledger: { items: [listed] }, settings: {},
  });
  assert.match(closed, /data-action="toggle-img" data-id="e1"/);
  assert.doesNotMatch(closed, /rwth-img-pop/);
  const open = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [], imgEditId: 'e1' },
    ledger: { items: [listed] }, settings: {},
  });
  assert.match(open, /rwth-img-pop/);
  assert.match(open, /data-adv-field="gyazoUrl"/);
  assert.match(open, /data-action="close-img"/);
});

test('ItemClassifier.classify — Riot Helmet (armor / Riot / yellow / BB-eligible)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'Riot Helmet': { name: 'Riot Helmet', type: 'Defensive', rarity: 'Yellow' },
  };
  const c = ItemClassifier.classify('Riot Helmet', dict);
  assert.strictEqual(c.type, 'defensive');   // routes on Torn's real type field
  assert.strictEqual(c.armorSet, 'Riot');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.isBBFloorEligible, true);
  assert.strictEqual(c.isTrash, false);
});

test('ItemClassifier.classify — Jackhammer (weapon / yellow / shotgun)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    Jackhammer: { name: 'Jackhammer', type: 'Primary', rarity: 'Yellow', weapon_class: 'Shotgun' },
  };
  const c = ItemClassifier.classify('Jackhammer', dict);
  assert.strictEqual(c.type, 'primary');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.weaponBase, 'shotgun');
  assert.strictEqual(c.isTrash, false);
  assert.strictEqual(c.isBBFloorEligible, false);
});

test('ItemClassifier.classify — trash weapon (Lorcin L380 / yellow / isTrash + BB-eligible)', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'Lorcin L380': { name: 'Lorcin L380', type: 'Secondary', rarity: 'Yellow', weapon_class: 'Pistol' },
  };
  const trashSet = new Set(['Lorcin L380']);
  const c = ItemClassifier.classify('Lorcin L380', dict, { trashSet });
  assert.strictEqual(c.type, 'secondary');
  assert.strictEqual(c.rarity, 'yellow');
  assert.strictEqual(c.isTrash, true);
  assert.strictEqual(c.isBBFloorEligible, true);
});

test('ItemClassifier.classify — orange & red weapon samples carry through rarity', () => {
  const { ItemClassifier } = globalThis.__RwthPure;
  const dict = {
    'ArmaLite M-15': { name: 'ArmaLite M-15', type: 'Primary', rarity: 'Orange', weapon_class: 'Rifle' },
    'Nail Bomb':     { name: 'Nail Bomb',     type: 'Primary', rarity: 'Red',    weapon_class: 'Heavy Artillery' },
  };
  const o = ItemClassifier.classify('ArmaLite M-15', dict);
  assert.strictEqual(o.rarity, 'orange');
  assert.strictEqual(o.weaponBase, 'rifle');
  const r = ItemClassifier.classify('Nail Bomb', dict);
  assert.strictEqual(r.rarity, 'red');
  assert.strictEqual(r.weaponBase, 'heavy artillery');
});

test('formatClassTag — armor with set, plain weapon, trash, double-bonus', () => {
  const { formatClassTag } = globalThis.__RwthPure;
  assert.strictEqual(formatClassTag({ type: 'defensive', armorSet: 'Riot', rarity: 'yellow' }),
                     '[Riot · yellow]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'yellow' }), '[Yellow weapon]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'yellow', isTrash: true }),
                     '[trash · yellow]');
  assert.strictEqual(formatClassTag({ type: 'primary', rarity: 'red' }, 2),
                     '[Red weapon · 2 bonuses]');
});

test('WEAPON_CATEGORY constant is removed', () => {
  assert.ok(!/\bWEAPON_CATEGORY\b/.test(SCRIPT_SOURCE), 'WEAPON_CATEGORY references must be gone');
});

test('bootstrap does not eagerly warm BB rate or item dictionary', () => {
  const start = SCRIPT_SOURCE.indexOf('function bootstrap()');
  const end = SCRIPT_SOURCE.indexOf('if (!TEST)', start);
  assert.notStrictEqual(start, -1, 'bootstrap function should exist');
  assert.notStrictEqual(end, -1, 'bootstrap block should precede TEST gate');
  const bootstrapBlock = SCRIPT_SOURCE.slice(start, end);
  assert.doesNotMatch(bootstrapBlock, /fetchBBRate\(/);
  assert.doesNotMatch(bootstrapBlock, /fetchItemsDict\(/);
  assert.match(SCRIPT_SOURCE, /function ensurePricingWarmups\(\)/);
});

// ── resolveMarketAnchor (bonus-bracket market anchor, #298 / PRD #296) ────────
// Worked-example cases from the PRD acceptance criteria. Each asserts external
// behaviour: given listings + a target bonus, which anchor (and tier) comes back.

test('resolveMarketAnchor: Enfield Deadeye 32% anchors on the 30–35% bracket, not the floor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 100, bonusValue: 25 }, { price: 102, bonusValue: 26 },
    { price: 105, bonusValue: 29 }, { price: 140, bonusValue: 31 },
    { price: 142, bonusValue: 33 }, { price: 145, bonusValue: 35 },
  ];
  const r = resolveMarketAnchor(listings, 32);
  assert.strictEqual(r.anchor, 140);              // 30–35% tier, not the 100 floor
  assert.strictEqual(r.tier.thresholdBonus, 31);
});

test('resolveMarketAnchor: Jackhammer Warlord 16% anchors on the 16% bracket, not the 15%', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 }, { price: 240, bonusValue: 15 },
    { price: 270, bonusValue: 16 }, { price: 290, bonusValue: 16 },
  ];
  const r = resolveMarketAnchor(listings, 16);
  assert.strictEqual(r.anchor, 270);              // 16% bracket floor, not 220
  assert.strictEqual(r.tier.thresholdBonus, 16);
});

test('resolveMarketAnchor: multi-step promotion evaluates each jump vs the previous tier', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 350, bonusValue: 17 },
  ];
  assert.strictEqual(resolveMarketAnchor(listings, 15).anchor, 220);
  assert.strictEqual(resolveMarketAnchor(listings, 16).anchor, 270);
  assert.strictEqual(resolveMarketAnchor(listings, 17).anchor, 350);
  assert.strictEqual(resolveMarketAnchor(listings, 17).tiers.length, 3);
});

test('resolveMarketAnchor: a cheap higher-bonus piece cancels the tier (undercut guard)', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 200, bonusValue: 18 },   // strong piece going cheap
  ];
  const r = resolveMarketAnchor(listings, 16);
  assert.strictEqual(r.anchor, 200);              // match/undercut the cheap 18%, not 270
  // Every bonus bucket keeps its floor tier; the guard caps the anchor instead
  // of erasing the tier, so the tier list still shows the full ladder.
  assert.strictEqual(r.tiers.length, 3);
  assert.strictEqual(r.tier.thresholdBonus, 16);
});

test('resolveMarketAnchor: sub-threshold scatter within one bracket makes no new tier', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 100, bonusValue: 25 },
    { price: 107, bonusValue: 25 },
    { price: 113, bonusValue: 25 },   // 13% internal spread, same bonus
  ];
  const r = resolveMarketAnchor(listings, 25);
  assert.strictEqual(r.tiers.length, 1);
  assert.strictEqual(r.anchor, 100);
});

test('resolveMarketAnchor: thin data (single listing) still yields a sensible anchor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const r = resolveMarketAnchor([{ price: 300, bonusValue: 40 }], 40);
  assert.strictEqual(r.anchor, 300);
});

test('resolveMarketAnchor: target below the first jump anchors on the global floor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  const listings = [
    { price: 220, bonusValue: 15 },
    { price: 270, bonusValue: 16 },
    { price: 350, bonusValue: 17 },
  ];
  assert.strictEqual(resolveMarketAnchor(listings, 14).anchor, 220);  // below lowest bonus
});

test('resolveMarketAnchor: no valid listings returns a null anchor', () => {
  const { resolveMarketAnchor } = globalThis.__RwthPure;
  assert.deepStrictEqual(resolveMarketAnchor([], 20),
                         { anchor: null, tier: null, tiers: [], fallback: null });
  assert.strictEqual(resolveMarketAnchor([{ price: 0, bonusValue: 20 }], 20).anchor, null);
});

// ── auction-card drill filters (#335) ─────────────────────────────────────────
test('applyDrillFilters: quality ±10 is ten quality points, not ten percent', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 100, quality: 110 },
    { price: 111, quality: 111 },
    { price: 121, quality: 121 },
    { price: 131, quality: 131 },
    { price: 132, quality: 132 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'all', quality: 'pm10' },
    { listingQuality: 121 },
  );
  assert.deepStrictEqual(out.map(c => c.quality), [111, 121, 131]);
});

test('applyDrillFilters: quality ±5 is the tightest point window', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 115, quality: 115 },
    { price: 116, quality: 116 },
    { price: 121, quality: 121 },
    { price: 126, quality: 126 },
    { price: 127, quality: 127 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'all', quality: 'pm5' },
    { listingQuality: 121 },
  );
  assert.deepStrictEqual(out.map(c => c.quality), [116, 121, 126]);
});

test('applyDrillFilters: bonus ±2 is a point window around the bonus percent', () => {
  const { applyDrillFilters } = globalThis.__RwthPure;
  const comps = [
    { price: 24, bonusValue: 24 },
    { price: 25, bonusValue: 25 },
    { price: 27, bonusValue: 27 },
    { price: 29, bonusValue: 29 },
    { price: 30, bonusValue: 30 },
  ];
  const out = applyDrillFilters(
    comps,
    { bonus: 'pm2', quality: 'all' },
    { primaryBonusValue: 27 },
  );
  assert.deepStrictEqual(out.map(c => c.bonusValue), [25, 27, 29]);
});

test('compReference: card auto bonus can stop at ±2 instead of widening open', () => {
  const { PricingEngine } = globalThis.__RwthPure;
  const comps = [
    { price: 100, bonusValue: 27 },
    { price: 110, bonusValue: 28 },
    { price: 120, bonusValue: 29 },
    { price: 130, bonusValue: 30 },
  ];
  const ref = PricingEngine.compReference(comps, {
    targetBonusValue: 27,
    strictTolerance: 0,
    widenTolerances: [1, 2],
  });
  assert.strictEqual(ref.widenedTolerance, 2);
  assert.deepStrictEqual(ref.comps.map(c => c.bonusValue), [27, 28, 29]);
});

// ── mergeLadder (#302 slice 1) ───────────────────────────────────────────────
test('mergeLadder: bonus-axis groups by exact bonus %, sorted descending', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, bonusValue: 15 },
    { price: 120, bonusValue: 15 },
    { price: 300, bonusValue: 20 },
  ];
  const out = mergeLadder({ soldComps: sold, listedComps: [], axis: 'bonus', ownKey: 15 });
  assert.deepStrictEqual(out.map(b => b.sort), [20, 15]);   // descending
  assert.deepStrictEqual(out.map(b => b.label), ['20%', '15%']);
  const b15 = out.find(b => b.key === 15);
  assert.strictEqual(b15.sold.count, 2);
});

test('mergeLadder: sold summary stats (median/min/max/count)', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, bonusValue: 15 },
    { price: 200, bonusValue: 15 },
    { price: 300, bonusValue: 15 },
  ];
  const [b] = mergeLadder({ soldComps: sold, listedComps: [], axis: 'bonus', ownKey: null });
  assert.deepStrictEqual(b.sold, { median: 200, min: 100, max: 300, count: 3, rows: b.sold.rows });
  assert.strictEqual(b.listed, null);
});

test('mergeLadder: listed summary is cheapest + count', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const listed = [
    { price: 500, bonusValue: 15 },
    { price: 450, bonusValue: 15 },
    { price: 600, bonusValue: 15 },
  ];
  const [b] = mergeLadder({ soldComps: [], listedComps: listed, axis: 'bonus', ownKey: null });
  assert.strictEqual(b.listed.cheapest, 450);
  assert.strictEqual(b.listed.count, 3);
  assert.strictEqual(b.sold, null);
});

test('mergeLadder: co-locates sold + listed at the same bonus level', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],
    listedComps: [{ price: 130, bonusValue: 15 }],
    axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].sold.median, 100);
  assert.strictEqual(out[0].listed.cheapest, 130);
});

test('mergeLadder: missing-side buckets still appear with null on the empty side', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],   // sold only at 15
    listedComps: [{ price: 200, bonusValue: 20 }],   // listed only at 20
    axis: 'bonus', ownKey: null,
  });
  const b15 = out.find(b => b.key === 15);
  const b20 = out.find(b => b.key === 20);
  assert.ok(b15 && b20, 'both buckets present');
  assert.strictEqual(b15.listed, null);
  assert.strictEqual(b20.sold, null);
});

test('mergeLadder: own-row marking on the bonus axis', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: 15 }, { price: 300, bonusValue: 20 }],
    listedComps: [], axis: 'bonus', ownKey: 20,
  });
  assert.strictEqual(out.find(b => b.key === 20).isOwn, true);
  assert.strictEqual(out.find(b => b.key === 15).isOwn, false);
});

test('mergeLadder: quality-axis buckets comps into class-tiered bands (default yellow)', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [
    { price: 100, quality: 90 },    // <100%  → idx 0
    { price: 110, quality: 120 },   // 100–129 → idx 1
    { price: 120, quality: 125 },   // 100–129 → idx 1
    { price: 200, quality: 175 },   // 150%+  → idx 3
  ];
  const out = mergeLadder({ soldComps: sold, listedComps: [], axis: 'quality', ownKey: 120, itemClass: 'yellowWeapon' });
  // sorted desc by bucket index
  assert.deepStrictEqual(out.map(b => b.key), [3, 1, 0]);
  assert.deepStrictEqual(out.map(b => b.label), ['150%+', '100–129%', '<100%']);
  assert.strictEqual(out.find(b => b.key === 1).sold.count, 2);
  assert.strictEqual(out.find(b => b.key === 1).isOwn, true);   // ownKey 120 falls in idx 1
});

test('mergeLadder: quality-axis honours the orange class bands', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const sold = [{ price: 100, quality: 175 }];   // 150–199% → idx 1 for orange
  const [b] = mergeLadder({ soldComps: sold, listedComps: [], axis: 'quality', ownKey: null, itemClass: 'orangeWeapon' });
  assert.strictEqual(b.label, '150–199%');
});

test('mergeLadder: drops zero/invalid-price rows and empty buckets', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 0, bonusValue: 15 }, { price: NaN, bonusValue: 15 }],
    listedComps: [{ price: -5, bonusValue: 15 }],
    axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 0);   // no priced data anywhere → no buckets
});

test('mergeLadder: comps with no bonus value are skipped on the bonus axis', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: null }, { price: 200, bonusValue: 15 }],
    listedComps: [], axis: 'bonus', ownKey: null,
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].key, 15);
});

// ── mergeLadder spread / flip-margin (#303) ──────────────────────────────────
test('mergeLadder: spread = listedCheapest − soldMedian when both sides present', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps:   [{ price: 100, bonusValue: 15 }],   // sold median 100
    listedComps: [{ price: 130, bonusValue: 15 }, { price: 150, bonusValue: 15 }], // cheapest 130
    axis: 'bonus', ownKey: 15,
  });
  const b = out.find(x => x.key === 15);
  assert.strictEqual(b.spread.abs, 30);
  assert.strictEqual(b.spread.pct, 0.3);   // (130 − 100) / 100
});

test('mergeLadder: spread is null when the for-sale side is missing', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [{ price: 100, bonusValue: 15 }], listedComps: [],
    axis: 'bonus', ownKey: 15,
  });
  assert.strictEqual(out.find(x => x.key === 15).spread, null);
});

test('mergeLadder: spread is null when the sold side is missing', () => {
  const { mergeLadder } = globalThis.__RwthPure;
  const out = mergeLadder({
    soldComps: [], listedComps: [{ price: 130, bonusValue: 15 }],
    axis: 'bonus', ownKey: 15,
  });
  assert.strictEqual(out.find(x => x.key === 15).spread, null);
});
