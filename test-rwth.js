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

test('summarizeSells counts parsed / matched / recent', () => {
  const { summarizeSells } = globalThis.__RwthPure;
  const s = summarizeSells([{ matchedId: 'a' }, { matchedId: null }, { matchedId: 'c' }]);
  assert.deepStrictEqual(s, { parsed: 3, matched: 2, recent: 1 });
  assert.deepStrictEqual(summarizeSells([]), { parsed: 0, matched: 0, recent: 0 });
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

test('buildAdvertiseTab renders both output boxes with copy buttons', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] },
    settings: {},
  });
  assert.match(html, /data-copy-target="rwth-out-title"/);
  assert.match(html, /data-copy-target="rwth-out-chat"/);
  assert.match(html, /NC17 Rated/);
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
const advSettings = { playerId: '1171127', forumHeaderImageUrl: '',
                      bannerImageUrl: 'https://i.gyazo.com/banner.jpg' };


test('toForumHtml injects item screenshots and omits the row when absent', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings);
  assert.strictEqual((html.match(/i\.gyazo\.com\/abc/g) || []).length, 2);
});

test('toForumHtml uses the forum header image, replacing the NC17 block', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml([], [], { forumHeaderImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
  assert.doesNotMatch(html, /Trading Post/);
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

test('toSignatureHtml reuses the forum header image when set', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toSignatureHtml(advItems, { forumHeaderImageUrl: 'https://i.gyazo.com/hdr.jpg' });
  assert.match(html, /src="https:\/\/i\.gyazo\.com\/hdr\.jpg"/);
});

test('buildAdvertiseTab renders the three HTML output boxes with copy buttons', () => {
  const { buildAdvertiseTab } = globalThis.__RwthPure;
  const html = buildAdvertiseTab({
    advertise: { selectedIds: null, transactions: [] },
    ledger: { items: [] }, settings: {},
  });
  assert.match(html, /data-copy-target="rwth-out-forum"/);
  assert.match(html, /data-copy-target="rwth-out-bazaar"/);
  assert.match(html, /data-copy-target="rwth-out-signature"/);
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
