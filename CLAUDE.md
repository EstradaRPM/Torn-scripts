# Torn Scripts — Claude Guidelines

## Repository Purpose

Personal collection of scripts for the browser game **Torn City** (torn.com). Scripts range from Tampermonkey/Greasemonkey userscripts (`.user.js`) to standalone tools and utilities. All scripts are Torn-specific.

---

## Current Scripts

| File | Type | Purpose |
|------|------|---------|
| `torn-gym-optomizer-v5.js` | Userscript | Multi-month gym training planner with real-time energy tracking and buff rotation support. Note: filename has a typo ("optomizer"); the canonical name is "Torn Gym Optimizer". |

---

## File Naming Conventions

```
torn-[feature]-v[N].user.js    # Tampermonkey/Greasemonkey userscript
torn-[feature]-v[N].js         # Standalone script / other tool
```

- Use lowercase, hyphen-separated names
- Include a version suffix (`-v1`, `-v2`) when a script has had major rewrites
- Never omit `torn-` prefix — all scripts in this repo are Torn-specific
- The `.user.js` extension signals Tampermonkey-installable scripts; omit it for non-userscripts

---

## Userscript Standards

Every userscript must open with a well-formed metadata block:

```js
// ==UserScript==
// @name         Torn [Feature Name]
// @namespace    [AuthorTag]-[ScriptIdentifier]
// @version      N.0.0
// @description  One-line description
// @author       Built for [PlayerName] [[PlayerID]]
// @match        https://www.torn.com/[page].php*
// @grant        none
// ==/UserScript==
```

Key rules:
- `@grant none` unless a specific GM API is actually needed (none of the current scripts need it)
- `@match` must be scoped to the exact Torn page(s) the script runs on — never use `https://www.torn.com/*` unless truly needed
- `@version` follows semver; bump the minor for new features, major for rewrites
- `API_KEY` should use the `###PDA-APIKEY###` placeholder so the script works with Torn PDA's auto-injection
- `@updateURL` and `@downloadURL` must point to the raw file on the `main` branch (GitHub raw URL)

### Version bump rules (required for PDA update detection)

PDA detects updates by fetching `@updateURL` and comparing the remote `@version` against the installed version. **Every PR that changes script behavior MUST include a `@version` bump in the same commit.** Do not defer version bumps to a follow-up commit.

| Change type | Bump | Example |
|-------------|------|---------|
| Bug fix / minor tweak | patch | `5.8.0 → 5.8.1` |
| New feature / UI change | minor | `5.8.1 → 5.9.0` |
| Full rewrite / breaking change | major | `5.9.0 → 6.0.0` |

**Rule:** If `torn-gym-optomizer-v5.js` (or any userscript) is modified in a commit, `@version` must change in that same commit. No exceptions. This is what makes PDA's "Check for update" work.

---

## JavaScript Style

**ES6+ throughout.** Specific patterns to follow:

- `const`/`let` only — never `var`
- Arrow functions for callbacks and short utilities
- Template literals for string interpolation
- `async/await` for all async operations (no raw `.then()` chains)
- Destructuring where it aids readability
- No external libraries or imports — scripts must be self-contained single files
- Wrap the entire script body in an IIFE: `(function () { 'use strict'; ... })();`

---

## Architecture Patterns

The gym optimizer establishes patterns worth reusing in future scripts:

### State management
```js
const MEM = { /* all runtime state */ };
```
A single flat object holds all mutable state. Avoids scattered module-level variables. Assign to `MEM` fields, never rebind `MEM` itself.

### Persistence layer
```js
const Store = {
  get(k)    { try { return localStorage.getItem(k); }    catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); }        catch {} },
};
const KEYS = { /* namespaced key constants */ };
```
Always wrap `localStorage` in try/catch. Namespace keys with a short script-specific prefix (e.g. `nc17_`) to avoid collisions with other scripts or Torn itself.

### Render cycle
```js
function render() { /* full re-render from MEM state */ }
```
Single render function rebuilds the entire UI from state. No partial DOM patching. Call `render()` whenever state changes. This is simple and debuggable.

### Torn API fetch pattern
```js
const r = await fetch(`https://api.torn.com/user/?selections=battlestats&key=${API_KEY}`);
const d = await r.json();
if (!d.error) { /* use data */ } else { /* store d.error.code + d.error.error */ }
```
- Always check `d.error` before using data
- Store the error string in `MEM.fetchError` so `render()` can surface it in the UI
- Refresh on an interval (5 min is appropriate for battle stats) rather than on every render

### DOM energy reading
Prefer reading values directly from the page DOM before making extra API calls. The `readEnergyFromDOM()` pattern (multiple CSS selector fallbacks + text regex fallback) is the right approach for scraping Torn UI values that the API also exposes — it's faster and doesn't consume API rate limit.

---

## Torn Domain Knowledge

### Gyms and stat relationships

| Gym | Stats | Energy/train |
|-----|-------|-------------|
| Mr. Isoyama's | DEF 8× | 50 |
| Gym 3000 | STR 8× | 50 |
| Total Rebound | SPD 8× | 50 |
| Elites | DEX 8× | 50 |
| Frontline Fitness | STR + SPD 7.5× | 25 |
| Balboa's | DEF + DEX 7.5× | 25 |
| George's | All stats 7.3× | 10 |

**Gym access (headroom) rules:**
- Isoyama's opens when: `DEF ≥ 1.25 × max(STR, SPD, DEX)`
- Frontline opens when: `STR + SPD ≥ 1.25 × (DEF + DEX)`

Headroom = how far a stat can grow before the condition reverses and the gym closes.

### Torn API
- Base URL: `https://api.torn.com/`
- Key auth: `?key=API_KEY` query param
- Always use `###PDA-APIKEY###` as the placeholder — Torn PDA injects the real key at install time
- Relevant endpoints for combat scripts: `user/?selections=battlestats`, `user/?selections=bars`
- Rate limit: 100 calls/minute on public API keys

### Faction buffs
Torn factions grant stat buffs (%) that rotate monthly. Scripts that plan training across months need to accept a buff schedule as user-defined input (not hardcoded) since buffs vary per faction and change over time.

---

## Adding a New Script

1. Create the file following the naming convention above
2. Add a row to the table in this file under **Current Scripts**
3. If it's a userscript, open with the metadata block template above
4. Wrap the body in an IIFE with `'use strict'`
5. Use `###PDA-APIKEY###` for any API key placeholder
6. Test on the specific `torn.com` page(s) before committing

---

## What Not to Do

- Don't hardcode player IDs, API keys, or faction-specific data as immutable constants — make them configurable via `localStorage` settings
- Don't use `@grant GM_xmlhttpRequest` or other GM APIs unless `fetch` genuinely can't do the job
- Don't add external script dependencies — no jQuery, no lodash, no frameworks
- Don't write scripts that target pages outside `torn.com`
- Don't commit API keys, even test keys
