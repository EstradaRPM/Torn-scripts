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

test('AdvertiseGenerator.toForumTitle returns the static brand title', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.strictEqual(AdvertiseGenerator.toForumTitle(),
    '[S] NC17 Rated ▸ RW Weapons & Armor');
});

test('AdvertiseGenerator.toChat builds the approved section-6 layout', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const out = AdvertiseGenerator.toChat([listedRiot, listedEnfield], {
    playerId: '1171127',
    forumThreadUrl: 'https://www.torn.com/forums.php#/p=threads&f=10&t=15951654&b=0&a=0',
  });
  assert.strictEqual(out,
    '🔹🔷 <u>NC17</u> 🔷🔹\n' +
    '🟢 <u>Floor Prices</u> 🟢\n' +
    '[S] <b>Riot Body</b> (6.5% q) — <b>$78m</b>\n' +
    '[S] <b>Enfield</b> (Deadeye 29%) — <b>$118m</b>\n' +
    '<a href="https://www.torn.com/bazaar.php?userId=1171127#/">Bazaar</a>\n' +
    '<a href="https://www.torn.com/forums.php#/p=threads&f=10&t=15951654&b=0&a=0">Forum</a>');
});

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

const FORUM_HTML = `<div><div class="table-wrap"><table style="background: #080e18; border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;" width="100%"><tbody><tr><td style="background: #080e18; padding: 22px 22px 18px; text-align: center; border-top: 1px solid rgba(0,255,136,0.15); border-bottom: 1px solid rgba(0,255,136,0.08);"><div style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.32em; text-transform: uppercase;">NC17</div><div style="color: #8aa898; font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; padding-top: 6px;">//&nbsp; Trading Post &nbsp;//</div></td></tr><tr><td style="background: #080e18; padding: 11px 22px 9px; text-align: center;"><strong><span style="font-size: 13px; letter-spacing: 0.16em; color: #6dc488; text-transform: uppercase;">Open shop &nbsp;//&nbsp; Competitively priced</span></strong></td></tr><tr><td style="background: #080e18; padding: 14px 22px 16px; border-top: 1px solid rgba(0,30,15,0.6); text-align: center; color: #c5dccc; font-size: 13px; line-height: 1.7;">Rotating collection of RW weapons/gear and other useful items.<br/><br/><span style="color: #9ab5a5;">If something below isn't currently listed, message me.</span></td></tr><tr><td style="background: #080e18; padding: 18px 22px 10px;"><table width="100%" style="border-collapse: collapse;"><tbody><tr><td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td><td style="text-align: center; vertical-align: middle; padding: 0 14px; white-space: nowrap;"><span style="display: inline-block; background: rgba(109,196,136,0.08); border: 1px solid rgba(109,196,136,0.35); color: #7ed098; font-size: 11px; font-weight: bold; letter-spacing: 0.28em; text-transform: uppercase; padding: 5px 14px; border-radius: 2px;">● Currently Available</span></td><td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td></tr></tbody></table></td></tr><tr><td style="background: #080e18; padding: 10px 22px;"><table style="background: #0c1422; border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse; table-layout: fixed;" width="100%"><tbody><tr><td style="background: #060a12; padding: 0; line-height: 0; width: 100%;"><a href="https://i.gyazo.com/abc.jpg" target="_blank" rel="noopener"><img style="display: block; height: auto;" src="https://i.gyazo.com/abc.jpg" alt="" width="100%"/></a></td></tr><tr><td style="background: #0c1422; padding: 16px 18px 16px 14px; border-left: 2px solid rgba(109,196,136,0.45);"><table width="100%" style="border-collapse: collapse;"><tbody><tr><td style="text-align: left; vertical-align: middle; width: 60%; padding-left: 6px;"><div style="color: #5dc6f0; font-size: 17px; font-weight: bold; letter-spacing: 0.04em; line-height: 1.15;">Enfield SA-80</div><div style="margin-top: 7px;"><span style="display: inline-block; background: rgba(109,196,136,0.10); border: 1px solid rgba(109,196,136,0.30); color: #7ed098; font-size: 10px; font-weight: bold; letter-spacing: 0.16em; text-transform: uppercase; padding: 3px 9px; border-radius: 2px;">Deadeye &nbsp;29%</span></div></td><td style="text-align: right; vertical-align: middle; white-space: nowrap; padding-right: 4px;"><span style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.02em; font-family: Consolas, 'Courier New', monospace;">$118,000,000</span></td></tr></tbody></table></td></tr></tbody></table></td></tr><tr><td style="background: #080e18; padding: 10px 22px;"><table style="background: #0c1422; border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse; table-layout: fixed;" width="100%"><tbody><tr><td style="background: #0c1422; padding: 16px 18px 16px 14px; border-left: 2px solid rgba(109,196,136,0.45);"><table width="100%" style="border-collapse: collapse;"><tbody><tr><td style="text-align: left; vertical-align: middle; width: 60%; padding-left: 6px;"><div style="color: #5dc6f0; font-size: 17px; font-weight: bold; letter-spacing: 0.04em; line-height: 1.15;">Riot Body</div></td><td style="text-align: right; vertical-align: middle; white-space: nowrap; padding-right: 4px;"><span style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.02em; font-family: Consolas, 'Courier New', monospace;">$78,000,000</span></td></tr></tbody></table></td></tr></tbody></table></td></tr><tr><td style="background: #080e18; padding: 4px 22px 14px; color: #8aa898; font-size: 12px; font-style: italic;">Also rotating: drugs, plushies, flowers. Check bazaar for live stock.</td></tr><tr><td style="background: #080e18; padding: 18px 22px 10px;"><table width="100%" style="border-collapse: collapse;"><tbody><tr><td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td><td style="text-align: center; vertical-align: middle; padding: 0 14px; white-space: nowrap;"><span style="display: inline-block; background: rgba(109,196,136,0.08); border: 1px solid rgba(109,196,136,0.35); color: #7ed098; font-size: 11px; font-weight: bold; letter-spacing: 0.28em; text-transform: uppercase; padding: 5px 14px; border-radius: 2px;">● Recent Transactions</span></td><td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td></tr></tbody></table></td></tr><tr><td style="background: #080e18; padding: 6px 22px 16px;"><table style="background: rgb(12,20,34); border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse;" width="100%"><tbody><tr><td style="padding: 9px 14px; color: rgb(138, 168, 152); font-size: 12px; font-family: Consolas, 'Courier New', monospace; border-bottom: 1px solid rgba(0,255,136,0.05);"><span style="font-size: 10px; color: var(--te-text-color-gray4);"><em>You sold a&nbsp;Riot Body (Impregnable) to&nbsp;Apocolypse_ at $84,150,000</em></span></td></tr></tbody></table></td></tr><tr><td style="background: #080e18; border-top: 1px solid rgba(0,30,15,0.6); padding: 0;"><table width="100%"><tbody><tr><td style="background: #080e18; padding: 11px 22px 13px; text-align: left; vertical-align: middle;"><span style="font-size: 12px; letter-spacing: 0.14em; color: #7ed098; text-transform: uppercase; font-style: italic;">Contains explicit deals, weapons, and depictions of violence</span></td><td style="background: #080e18; padding: 11px 22px 13px; text-align: right; vertical-align: middle;"><strong><a style="color: #5dc6f0; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; border-bottom: 1px solid rgba(93,198,240,0.4); padding-bottom: 2px;" href="/bazaar.php?userId=1171127" target="_blank" rel="noopener">Visit Bazaar ↗</a></strong></td></tr></tbody></table></td></tr></tbody></table></div></div>`;
const BAZAAR_HTML = `<div><div class="table-wrap"><table style="background: #080e18; border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;" width="100%"><tbody><tr><td style="background: #060a12; padding: 0; line-height: 0;"><img style="display: block; height: auto;" src="https://i.gyazo.com/banner.jpg" alt="" width="100%"/></td></tr><tr><td style="background: #080e18; padding: 22px 22px 18px; text-align: center; border-top: 1px solid rgba(0,255,136,0.15); border-bottom: 1px solid rgba(0,255,136,0.08);"><div style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.32em; text-transform: uppercase;">NC17</div><div style="color: #8aa898; font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; padding-top: 6px;">//&nbsp; Trading Post &nbsp;//</div></td></tr><tr><td style="background: #080e18; padding: 11px 22px 9px; text-align: center;"><strong><span style="font-size: 13px; letter-spacing: 0.16em; color: #6dc488; text-transform: uppercase;">Open shop &nbsp;//&nbsp; Competitively priced</span></strong></td></tr><tr><td style="background: #080e18; padding: 14px 22px 16px; border-top: 1px solid rgba(0,30,15,0.6); text-align: center; color: #c5dccc; font-size: 13px; line-height: 1.7;">RW weapons, armor and other useful gear — fairly priced, always rotating.<br/><br/><span style="color: #9ab5a5;">Message me for anything not currently stocked.</span></td></tr><tr><td style="background: #080e18; border-top: 1px solid rgba(0,255,136,0.08); padding: 11px 22px 13px; text-align: center;"><span style="font-size: 12px; letter-spacing: 0.14em; color: #7ed098; text-transform: uppercase; font-style: italic;">Contains explicit deals, weapons, and depictions of violence</span></td></tr></tbody></table></div></div>`;
const SIGNATURE_HTML = `<div><div class="table-wrap"><table style="background: #080e18; border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse;" width="100%"><tbody><tr><td colspan="2" style="background: #080e18; padding: 10px 14px; text-align: center; border-bottom: 1px solid rgba(0,255,136,0.08);"><span style="color: #7ed098; font-size: 14px; font-weight: bold; letter-spacing: 0.28em; text-transform: uppercase;">NC17</span></td></tr><tr><td style="padding: 5px 14px; color: #5dc6f0; font-size: 12px; font-family: Verdana, Geneva, sans-serif;">Enfield SA-80 <span style="color: #8aa898;">(Deadeye 29%)</span></td><td style="padding: 5px 14px; text-align: right; color: #7ed098; font-size: 12px; font-weight: bold; font-family: Consolas, 'Courier New', monospace;">$118m</td></tr><tr><td style="padding: 5px 14px; color: #5dc6f0; font-size: 12px; font-family: Verdana, Geneva, sans-serif;">Riot Body</td><td style="padding: 5px 14px; text-align: right; color: #7ed098; font-size: 12px; font-weight: bold; font-family: Consolas, 'Courier New', monospace;">$78m</td></tr><tr><td colspan="2" style="background: #080e18; padding: 7px 14px; text-align: center; border-top: 1px solid rgba(0,255,136,0.08);"><a style="color: #5dc6f0; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none;" href="/bazaar.php?userId=1171127" target="_blank" rel="noopener">Visit Bazaar ↗</a></td></tr></tbody></table></div></div>`;

test('AdvertiseGenerator.toForumHtml matches the approved template exactly', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.strictEqual(AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings), FORUM_HTML);
});

test('toForumHtml carries the verbatim section 2-4 style signatures', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  const html = AdvertiseGenerator.toForumHtml(advItems, advTxs, advSettings);
  assert.match(html, /border-top: 1px solid rgba\(0,255,136,0\.15\)/);
  assert.match(html, /\u25cf Currently Available/);
  assert.match(html, /\u25cf Recent Transactions/);
  assert.match(html, /border-left: 2px solid rgba\(109,196,136,0\.45\)/);
});

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

test('AdvertiseGenerator.toBazaarHtml matches the approved template exactly', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.strictEqual(AdvertiseGenerator.toBazaarHtml(advSettings), BAZAAR_HTML);
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

test('AdvertiseGenerator.toSignatureHtml matches the approved template exactly', () => {
  const { AdvertiseGenerator } = globalThis.__RwthPure;
  assert.strictEqual(AdvertiseGenerator.toSignatureHtml(advItems, advSettings), SIGNATURE_HTML);
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
