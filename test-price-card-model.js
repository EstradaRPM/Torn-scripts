// node --test test-price-card-model.js
// Focused tests for the pure inline price-card view model (#352).

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

const { PriceCardModel } = globalThis.__RwthPure;
const DRILL = { bonus: 'auto', quality: 'all', expanded: false, axis: 'bonus' };
const SETTINGS = { tax: 0.05, mug: 0.10, margin: 0.05, compClampRatio: 1.15 };

const sold = (...prices) => prices.map((price, i) => ({
  price,
  bonusValue: 25 + (i % 2),
  quality: 100 + i,
  bonusCount: 1,
}));

test('PriceCardModel is exported through the pure seam', () => {
  assert.strictEqual(typeof PriceCardModel, 'object');
  assert.strictEqual(typeof PriceCardModel.build, 'function');
});

test('normal market-anchored card exposes bid max, clearing range, and room', () => {
  const model = PriceCardModel.build({
    itemClass: 'yellowWeapon',
    classTag: '[Yellow weapon]',
    currentBid: 650_000_000,
    marketCheapest: 1_000_000_000,
    askingComps: [{ price: 1_000_000_000, bonusValue: 25, source: 'market' }],
    comps: sold(760_000_000, 780_000_000, 800_000_000, 820_000_000, 840_000_000),
    primaryBonusName: 'Deadeye',
    primaryBonusValue: 25,
    strictTolerance: 0,
  }, DRILL, SETTINGS);

  assert.strictEqual(model.headline.classTag, '[Yellow weapon]');
  assert.match(model.headline.buyText, /Bid up to \$800m/);
  assert.ok(model.headline.meta.some(m => /clears \$760m–\$800m at auction/.test(m.text)));
  assert.ok(model.headline.meta.some(m => /\$150m under your max/.test(m.text)));
  assert.ok(model.deductionText.includes('Item market $1b'));
});

test('missing resale price becomes a research-before-bidding state', () => {
  const model = PriceCardModel.build({
    itemClass: 'yellowWeapon',
    classTag: '[Yellow weapon]',
    currentBid: 650_000_000,
    marketCheapest: null,
    askingComps: [],
    comps: sold(500_000_000, 520_000_000, 540_000_000, 560_000_000, 580_000_000),
    primaryBonusName: 'Deadeye',
    primaryBonusValue: 25,
    strictTolerance: 0,
  }, DRILL, SETTINGS);

  assert.match(model.headline.buyText, /research before bidding/);
  assert.ok(model.headline.buyClasses.includes('rwth-card-buymax-pass'));
  assert.ok(model.notes.some(n => /no resale price/.test(n.text)));
  assert.strictEqual(model.deductionText, '');
});

test('thin comp set keeps the rough-guess label', () => {
  const model = PriceCardModel.build({
    itemClass: 'yellowWeapon',
    currentBid: 100_000_000,
    marketCheapest: 500_000_000,
    askingComps: [{ price: 500_000_000, bonusValue: 25, source: 'market' }],
    comps: sold(220_000_000, 240_000_000, 260_000_000),
    primaryBonusValue: 25,
    strictTolerance: 0,
  }, DRILL, SETTINGS);

  assert.match(model.thinText, /few comparable sales/);
  assert.match(model.referenceText, /based on 2 close \+ 1 within ±1% bonus of yours/);
});

test('orange/red wide classes expose a band instead of a single point max', () => {
  const model = PriceCardModel.build({
    itemClass: 'orangeWeapon',
    currentBid: 300_000_000,
    bbFloor: 250_000_000,
    marketCheapest: 900_000_000,
    askingComps: [{ price: 900_000_000, bonusValue: 25, source: 'market' }],
    comps: sold(500_000_000, 600_000_000, 700_000_000).map(c => ({ ...c, bonusCount: 1 })),
    primaryBonusValue: 25,
    strictTolerance: 0,
    bonusCount: 1,
  }, DRILL, SETTINGS);

  assert.match(model.headline.buyText, /Bid \$420m – \$780m/);
  assert.ok(!/Bid up to/.test(model.headline.buyText));
  assert.ok(model.notes.some(n => /Limited sales data/.test(n.text)));
});
