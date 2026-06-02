// node test-advconfig.js
// Tests for AdvConfig (issue #316) — the pure Advertise identity resolver.
// Mirrors test-ledgerstats.js: requires the shipped .user.js directly (ADR-0002
// seam) so the real code is exercised, reads AdvConfig off __RwthPure, and
// asserts external behavior only — feed a settings object, assert the resolved
// identity.

'use strict';

// ── Browser-global shim (lets the IIFE load under Node, skips DOM bootstrap) ──

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

const { AdvConfig } = globalThis.__RwthPure;

// ── Test helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++; }
  else           { console.error(`  ✗ ${label}`); failed++; }
}

function assertEq(label, a, b) {
  if (a === b) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}  (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); failed++; }
}

const IDENTITY_KEYS = ['shopName', 'forumThreadTitle', 'tagline'];

// ── fresh install — neutral placeholders, no specific shop ────────────────────

console.log('\nfresh install — neutral placeholders');
{
  const { identity } = AdvConfig.resolve({});
  assertEq('shopName is the neutral placeholder', identity.shopName, 'Your Shop Name');
  assert('every identity token is a non-empty string',
    IDENTITY_KEYS.every(k => typeof identity[k] === 'string' && identity[k].length > 0));
  assert('no NC17 in any identity string',
    IDENTITY_KEYS.every(k => !/nc17/i.test(identity[k])));
}

// ── garbage / missing settings never throw or leak undefined ──────────────────

console.log('\ngarbage input — no undefined leaks');
{
  const base = AdvConfig.resolve({}).identity;
  for (const bad of [undefined, null, 'nope', 42, []]) {
    const { identity } = AdvConfig.resolve(bad);
    assert(`no undefined token for ${JSON.stringify(bad)}`,
      IDENTITY_KEYS.every(k => identity[k] != null && identity[k] !== ''));
    assert(`falls back to defaults for ${JSON.stringify(bad)}`,
      IDENTITY_KEYS.every(k => identity[k] === base[k]));
  }
}

// ── user overrides win over defaults ──────────────────────────────────────────

console.log('\nuser overrides win over defaults');
{
  const { identity } = AdvConfig.resolve({
    shopName: 'Acme Arms',
    forumThreadTitle: '[S] Acme // Gear',
    tagline: 'Best in town',
  });
  assertEq('shopName overridden', identity.shopName, 'Acme Arms');
  assertEq('forumThreadTitle overridden', identity.forumThreadTitle, '[S] Acme // Gear');
  assertEq('tagline overridden', identity.tagline, 'Best in town');
}

// ── blank / whitespace override falls back to the default ─────────────────────

console.log('\nblank override falls back to default');
{
  const base = AdvConfig.resolve({}).identity;
  const { identity } = AdvConfig.resolve({ shopName: '   ', forumThreadTitle: '', tagline: '\t\n' });
  assertEq('blank shopName falls back', identity.shopName, base.shopName);
  assertEq('empty forumThreadTitle falls back', identity.forumThreadTitle, base.forumThreadTitle);
  assertEq('whitespace tagline falls back', identity.tagline, base.tagline);
}

// ── surrounding whitespace on a real value is trimmed ─────────────────────────

console.log('\ntrims surrounding whitespace');
{
  const { identity } = AdvConfig.resolve({ shopName: '  Acme Arms  ' });
  assertEq('shopName trimmed', identity.shopName, 'Acme Arms');
}

// ── partial override leaves the other fields at their defaults ────────────────

console.log('\npartial override leaves others at default');
{
  const base = AdvConfig.resolve({}).identity;
  const { identity } = AdvConfig.resolve({ shopName: 'Acme Arms' });
  assertEq('shopName overridden', identity.shopName, 'Acme Arms');
  assertEq('forumThreadTitle still default', identity.forumThreadTitle, base.forumThreadTitle);
  assertEq('tagline still default', identity.tagline, base.tagline);
}

// ── ignores unrelated settings keys (e.g. apiKey, playerId) ───────────────────

console.log('\nignores unrelated settings keys');
{
  const { identity } = AdvConfig.resolve({ apiKey: 'secret', playerId: '123', shopName: 'Acme' });
  assertEq('only identity keys resolved', Object.keys(identity).sort().join(','),
    IDENTITY_KEYS.slice().sort().join(','));
  assertEq('shopName still read', identity.shopName, 'Acme');
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
