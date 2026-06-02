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

// ── theme resolution (#317) ───────────────────────────────────────────────────
// Every preset must define every token the builders read, an unknown/missing
// theme must fall back to the default preset, and no token may resolve to a
// value the builders can leave undefined.

const THEME_TOKENS = [
  'bg', 'bgDeep', 'bgCard', 'bgStrip', 'bgPillPrimary', 'bgPillAccent',
  'bgChip', 'bgChipMuted', 'bgLink', 'hairline', 'hairlinePrimary',
  'hairlineAccent', 'primary', 'primaryStrong', 'accent', 'textBody',
  'textMuted', 'textSoft', 'sep', 'warn', 'warnText',
  'catPrimary', 'catSecondary', 'catMelee', 'catArmor', 'catOther',
  'rarWhite', 'rarYellow', 'rarOrange', 'rarRed',
];
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);

console.log('\ntheme — default on fresh install');
{
  const { theme } = AdvConfig.resolve({});
  assertEq('fresh install resolves the default (midnight) theme', theme.themeKey, 'midnight');
  assert('every token is a defined hex colour',
    THEME_TOKENS.every(k => isHex(theme[k])));
}

console.log('\ntheme — unknown/missing falls back to default');
{
  const def = AdvConfig.resolve({}).theme;
  for (const bad of [undefined, null, '', '   ', 'rainbow', 42, {}]) {
    const { theme } = AdvConfig.resolve({ theme: bad });
    assertEq(`theme ${JSON.stringify(bad)} falls back to default key`, theme.themeKey, def.themeKey);
    assert(`theme ${JSON.stringify(bad)} leaves no undefined token`,
      THEME_TOKENS.every(k => isHex(theme[k])));
  }
}

console.log('\ntheme — each shipped preset is a complete token set');
{
  for (const key of ['midnight', 'crimson', 'steel']) {
    const { theme } = AdvConfig.resolve({ theme: key });
    assertEq(`${key} selected`, theme.themeKey, key);
    assert(`${key} defines every token as a hex colour`,
      THEME_TOKENS.every(k => isHex(theme[k])));
  }
}

console.log('\ntheme — selecting a non-default preset actually changes colours');
{
  const midnight = AdvConfig.resolve({ theme: 'midnight' }).theme;
  const crimson = AdvConfig.resolve({ theme: 'crimson' }).theme;
  assert('crimson differs from midnight on the primary accent',
    crimson.primary !== midnight.primary);
  assert('crimson differs from midnight on the page background',
    crimson.bg !== midnight.bg);
}

console.log('\ntheme — surrounding whitespace on a real key is tolerated');
{
  const { theme } = AdvConfig.resolve({ theme: '  steel  ' });
  assertEq('whitespace-padded key still resolves', theme.themeKey, 'steel');
}

// ── colour overrides (#318) ───────────────────────────────────────────────────
// Precedence is defaults < preset < per-token override. An override replaces
// only its token; every other token still comes from the preset, and a blank or
// malformed override is ignored so the builders never read a non-colour token.

console.log('\noverride — replaces only its token, preset holds elsewhere');
{
  const preset = AdvConfig.resolve({ theme: 'crimson' }).theme;
  const { theme } = AdvConfig.resolve({ theme: 'crimson', themeOverrides: { bg: '#123456' } });
  assertEq('overridden token wins', theme.bg, '#123456');
  assertEq('overridden token differs from preset', theme.bg !== preset.bg, true);
  assert('every other token still matches the preset',
    THEME_TOKENS.filter(k => k !== 'bg').every(k => theme[k] === preset[k]));
}

console.log('\noverride — precedence over the default preset too');
{
  const def = AdvConfig.resolve({}).theme;
  const { theme } = AdvConfig.resolve({ themeOverrides: { primary: '#abcdef' } });
  assertEq('override wins on a fresh install (no theme key)', theme.primary, '#abcdef');
  assertEq('themeKey is still the default', theme.themeKey, def.themeKey);
}

console.log('\noverride — multiple tokens at once');
{
  const { theme } = AdvConfig.resolve({ theme: 'steel',
    themeOverrides: { bg: '#000000', accent: '#ffffff', textBody: '#abc' } });
  assertEq('bg overridden', theme.bg, '#000000');
  assertEq('accent overridden', theme.accent, '#ffffff');
  assertEq('3-digit hex accepted', theme.textBody, '#abc');
}

console.log('\noverride — blank / malformed values are ignored');
{
  const preset = AdvConfig.resolve({ theme: 'midnight' }).theme;
  for (const bad of ['', '   ', 'red', '123456', '#12', '#1234567', 'rgb(0,0,0)', null, 42, {}]) {
    const { theme } = AdvConfig.resolve({ theme: 'midnight', themeOverrides: { primary: bad } });
    assertEq(`primary override ${JSON.stringify(bad)} falls back to preset`, theme.primary, preset.primary);
    assert(`override ${JSON.stringify(bad)} leaves no undefined token`,
      THEME_TOKENS.every(k => isHex(theme[k])));
  }
}

console.log('\noverride — unknown keys never reach the resolved theme');
{
  const { theme } = AdvConfig.resolve({ theme: 'midnight',
    themeOverrides: { notAToken: '#123456', bg: '#654321' } });
  assertEq('real token applied', theme.bg, '#654321');
  assert('junk key is not copied onto the theme',
    !Object.prototype.hasOwnProperty.call(theme, 'notAToken'));
}

console.log('\noverride — a non-object themeOverrides is tolerated');
{
  const def = AdvConfig.resolve({ theme: 'midnight' }).theme;
  for (const bad of [null, undefined, 'nope', 42, []]) {
    const { theme } = AdvConfig.resolve({ theme: 'midnight', themeOverrides: bad });
    assert(`themeOverrides ${JSON.stringify(bad)} leaves the preset intact`,
      THEME_TOKENS.every(k => theme[k] === def[k]));
  }
}

// ── summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
