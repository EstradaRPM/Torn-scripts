// node test-rwth-scan.js
// Focused RWTH scan/import tests against the shipped userscript seam.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

function makeMockStorage() {
  const data = {};
  return {
    getItem:    k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem:    (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    clear:      () => { for (const k of Object.keys(data)) delete data[k]; },
  };
}

globalThis.__RWTH_TEST__ = true;
globalThis.localStorage = makeMockStorage();
globalThis.document = {};

require('./TORN-RW-trading-hub.user.js');

const P = globalThis.__RwthPure;

const cats = {
  'diamond bladed knife': 'Melee',
  'riot body': 'Armor',
};

test('scan log constants include RW buy, sale, mug, and trade sources', () => {
  assert.strictEqual(P.SCAN_LOG_TYPES.auctionBuy, 4320);
  assert.strictEqual(P.SCAN_LOG_TYPES.itemMarketBuy, 1112);
  assert.strictEqual(P.SCAN_LOG_TYPES.bazaarBuy, 1125);
  assert.strictEqual(P.SCAN_LOG_TYPES.auctionSale, 4322);
  assert.strictEqual(P.SCAN_LOG_TYPES.itemMarketSale, 1113);
  assert.strictEqual(P.SCAN_LOG_TYPES.bazaarSale, 1226);
  assert.strictEqual(P.SCAN_LOG_TYPES.mugged, 8156);
  assert.deepStrictEqual(
    [
      P.SCAN_LOG_TYPES.tradeItemA,
      P.SCAN_LOG_TYPES.tradeItemB,
      P.SCAN_LOG_TYPES.tradeMoneyA,
      P.SCAN_LOG_TYPES.tradeMoneyB,
    ].sort(),
    [4440, 4441, 4445, 4446].sort(),
  );
});

test('selected scan log types keep the buys toggle scoped to auction wins', () => {
  assert.deepStrictEqual(P.selectedScanLogTypes({
    buys: true,
    sales: false,
    trades: false,
    mugs: false,
  }), [P.SCAN_LOG_TYPES.auctionBuy]);
});

test('legacy item dictionary cache can still supply auction-win names', () => {
  const cached = {
    schema: 1,
    ts: 1779368765000,
    map: { 614: 'Diamond Bladed Knife' },
  };

  assert.strictEqual(P.itemDictCacheUsable(cached), false);
  assert.deepStrictEqual(P.itemDictNameMapFromCache(cached), cached.map);
});

test('classifyLogEvent parses buy logs from action text when data.item is absent', () => {
  const row = P.classifyLogEvent({
    id: 'buy-market-1',
    timestamp: 1779280000,
    action: 'You bought 1x Diamond Bladed Knife on the item market from SellerName at $75,000,000 each for a total of $75,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'buy-market-1', {}, cats);

  assert.strictEqual(row.type, 'buy');
  assert.strictEqual(row.hit.eventKey, '1112:buy-market-1');
  assert.strictEqual(row.hit.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(row.hit.buySource, 'market');
  assert.strictEqual(row.hit.buyPrice, 75_000_000);
  assert.strictEqual(row.hit.category, 'Melee');
});

test('buildScanSetup renders a compact date and source selector', () => {
  const html = P.buildScanSetup(
    { buys: true, sales: true, trades: false, mugs: true },
    '2026-06-01',
    false,
  );
  assert.match(html, /data-scan-back-to/);
  assert.match(html, /value="2026-06-01"/);
  assert.match(html, /data-scan-source="buys" checked/);
  assert.match(html, /data-scan-source="sales" checked/);
  assert.match(html, /data-scan-source="trades"/);
  assert.doesNotMatch(html, /data-scan-source="trades" checked/);
  assert.match(html, /data-action="run-scan"/);
});

test('scan log failure summary names the failing source', () => {
  assert.strictEqual(P.scanLogTypeLabel(P.SCAN_LOG_TYPES.tradeMoneyA), 'trade money A');
  const text = P.scanLogFailureSummary([
    { logType: P.SCAN_LOG_TYPES.tradeMoneyA, error: 'Access denied (code 7)' },
    { logType: P.SCAN_LOG_TYPES.mugged, error: 'Temporary error' },
  ]);
  assert.match(text, /trade money A: Access denied \(code 7\)/);
  assert.match(text, /mugs: Temporary error/);
});

test('classifyLogEvent parses item-market sale logs into sell rows', () => {
  const row = P.classifyLogEvent({
    id: 'sale-1',
    timestamp: 1779372185,
    data: {
      item: [{ id: 614, name: 'Diamond Bladed Knife' }],
      price: 100_000_000,
      net: 95_000_000,
      fees: 5_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.itemMarketSale, 'sale-1', {}, cats);

  assert.strictEqual(row.type, 'sale');
  assert.strictEqual(row.eventKey, '1113:sale-1');
  assert.strictEqual(row.sell.itemName, 'Diamond Bladed Knife');
  assert.strictEqual(row.sell.venue, 'market');
  assert.strictEqual(row.sell.saleNet, 95_000_000);
  assert.strictEqual(row.sell.buyer, 'BuyerName');
});

test('buildScanPreview matches RW sales and skips already-imported event ids', () => {
  const sale = P.classifyLogEvent({
    id: 'sale-2',
    timestamp: 1779372185,
    data: {
      item: [{ id: 614, name: 'Diamond Bladed Knife' }],
      net: 120_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-2', {}, cats);
  const old = P.classifyLogEvent({
    id: 'sale-old',
    timestamp: 1779372100,
    data: { item: [{ name: 'Riot Body' }], net: 75_000_000 },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-old', {}, cats);

  const preview = P.buildScanPreview([sale, old], {
    seen: { 1226: ['sale-old'] },
    cats,
    items: [{ id: 'held-1', itemName: 'Diamond Bladed Knife', status: 'listed', bonuses: [] }],
    transactions: [],
  });

  assert.strictEqual(preview.sales.length, 1);
  assert.strictEqual(preview.sales[0].matchedId, 'held-1');
  assert.strictEqual(preview.already.length, 1);
});

test('buildScanPreview reconciles same-scan backloaded buy, sale, and mug', () => {
  const boughtAt = 1779280000;
  const soldAt = 1779372185;
  const buy = P.classifyLogEvent({
    id: 'buy-1',
    timestamp: boughtAt,
    data: {
      item: { id: 614, uid: 19121539308, name: 'Diamond Bladed Knife' },
      final_price: 75_000_000,
    },
  }, P.SCAN_LOG_TYPES.auctionBuy, 'buy-1', {}, {});
  const sale = P.classifyLogEvent({
    id: 'sale-1',
    timestamp: soldAt,
    data: {
      item: { id: 614, name: 'Diamond Bladed Knife' },
      net: 120_000_000,
      buyer: 'BuyerName',
    },
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-1', {}, {});
  const mug = P.classifyLogEvent({
    id: 'mug-1',
    timestamp: soldAt + 120,
    data: { cash: 8_000_000, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-1', {}, {});

  const preview = P.buildScanPreview([buy, sale, mug], {
    cats: {},
    items: [],
    transactions: [],
  });

  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.ignored.length, 0);
  assert.strictEqual(preview.sales.length, 1);
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].matchedId, preview.sales[0].matchedId);
  assert.strictEqual(preview.mugs[0].mug.amount, 8_000_000);
});

test('buildScanPreview keeps unclassified non-auction buys visible but unchecked', () => {
  const boughtAt = 1779280000;
  const soldAt = 1779372185;
  const buy = P.classifyLogEvent({
    id: 'buy-unknown',
    timestamp: boughtAt,
    action: 'You bought 1x Diamond Bladed Knife on the item market from SellerName at $75,000,000 each for a total of $75,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.itemMarketBuy, 'buy-unknown', {}, {});
  const sale = P.classifyLogEvent({
    id: 'sale-action',
    timestamp: soldAt,
    action: 'You sold 1x Diamond Bladed Knife on your bazaar to BuyerName at $120,000,000 each for a total of $120,000,000',
    data: {},
  }, P.SCAN_LOG_TYPES.bazaarSale, 'sale-action', {}, {});
  const mug = P.classifyLogEvent({
    id: 'mug-action',
    timestamp: soldAt + 120,
    action: 'You were mugged by 1580562 and lost $8,000,000',
    data: { user: 1580562 },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-action', {}, {});

  const preview = P.buildScanPreview([buy, sale, mug], {
    cats: {},
    items: [],
    transactions: [],
  });

  assert.strictEqual(preview.buys.length, 1);
  assert.strictEqual(preview.buys[0].checked, false);
  assert.strictEqual(preview.buys[0].itemName, 'Diamond Bladed Knife');
  assert.strictEqual(preview.sales.length, 1);
  assert.match(preview.sales[0].matchedId, /^scan-buy:/);
  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].matchedId, preview.sales[0].matchedId);
  assert.strictEqual(preview.mugs[0].mug.amount, 8_000_000);
});

test('applyItemDetails stamps category from itemdetails when the item cache is stale', () => {
  const hit = P.applyItemDetails({
    itemName: 'Benelli M4 Super',
    category: null,
    type: 'weapon',
    bonuses: [],
    quality: null,
    rarity: null,
  }, {
    name: 'Benelli M4 Super',
    type: 'Secondary',
    rarity: 'yellow',
    stats: { quality: 64.5 },
    bonuses: [{ title: 'Fury', value: 42 }],
  });

  assert.strictEqual(hit.category, 'Secondary');
  assert.strictEqual(hit.type, 'weapon');
  assert.strictEqual(hit.quality, 64.5);
  assert.deepStrictEqual(hit.bonuses, [{ name: 'Fury', value: 42 }]);
});

test('simple RW trade becomes a buy; mixed trade stays review', () => {
  const simple = P.reconcileTradeGroup([
    {
      eventKey: '4440:item-in',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemId: 614, itemName: 'Diamond Bladed Knife' },
      category: 'Melee',
      isRw: true,
      timestamp: 1779372185000,
    },
    {
      eventKey: '4445:money-out',
      kind: 'tradeMoney',
      direction: 'out',
      amount: 80_000_000,
      timestamp: 1779372185000,
    },
  ], {}, cats);

  assert.strictEqual(simple.type, 'buy');
  assert.strictEqual(simple.hit.buySource, 'trade');
  assert.strictEqual(simple.hit.buyPrice, 80_000_000);

  const mixed = P.reconcileTradeGroup([
    {
      eventKey: '4440:rw-item',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemId: 614, itemName: 'Diamond Bladed Knife' },
      category: 'Melee',
      isRw: true,
    },
    {
      eventKey: '4440:xanax',
      kind: 'tradeItem',
      direction: 'in',
      item: { itemName: 'Xanax' },
      category: null,
      isRw: false,
    },
    {
      eventKey: '4445:money-out',
      kind: 'tradeMoney',
      direction: 'out',
      amount: 80_000_000,
    },
  ], {}, cats);

  assert.strictEqual(mixed.type, 'review');
});

test('mug events attach only when one sold row is clearly nearby', () => {
  const mug = P.classifyLogEvent({
    id: 'mug-1',
    timestamp: 1779372200,
    data: { amount: 8_000_000, attacker: 'Mugger' },
  }, P.SCAN_LOG_TYPES.mugged, 'mug-1', {}, cats);

  const preview = P.buildScanPreview([mug], {
    cats,
    items: [{
      id: 'sold-1',
      itemName: 'Riot Body',
      status: 'sold',
      soldTimestamp: 1779372185 * 1000,
      saleNet: 100_000_000,
    }],
    transactions: [],
  });

  assert.strictEqual(preview.mugs.length, 1);
  assert.strictEqual(preview.mugs[0].matchedId, 'sold-1');
});
