# Torn Scripts — Claude Guidelines

## Repository Purpose

Personal collection of scripts for the browser game **Torn City** (torn.com). Scripts range from Tampermonkey/Greasemonkey userscripts (`.user.js`) to standalone tools and utilities. All scripts are Torn-specific.

---

## Current Scripts

| File | Type | Purpose |
|------|------|---------|
| `torn-gym-optomizer-v5.js` | Userscript | Multi-month gym training planner with real-time energy tracking and buff rotation support. Note: filename has a typo ("optomizer"); the canonical name is "Torn Gym Optimizer". |
| `torn-snipe-tracker-v1.user.js` | Userscript | Bazaar snipe detector and trade ledger. Watches a configurable item list, flags listings priced below a threshold, and tracks open/closed trades with P&L. |
| `torn-rw-auction-advisor-v1.user.js` | Userscript *(in development)* | Auction house advisor for Riot and Assault armor. Evaluates listings for flip potential by calculating a recommended max offer price based on BB floor value, item market comps, armor quality scoring, and a user-defined target profit margin. |

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

**Also update `SCRIPT_VERSION`:** Every userscript defines `const SCRIPT_VERSION = 'x.y.z'` near the top of the IIFE. This constant is what the UI footer displays. It must always match `@version` exactly — change both in the same edit.

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

## RW Auction Advisor

### Goal

Help the player evaluate Riot and Assault armor listings in the auction house
for flip potential. For each listing the script calculates a recommended max
offer price and displays whether the current bid leaves room for profit.

### Target page

`https://www.torn.com/amarket.php` — the Torn City auction house.
Tampermonkey `@match`: `https://www.torn.com/amarket.php*`

### Development phase

**Pre-implementation.** All research and reference documentation is complete.
No script file exists yet. Next step is authoring
`torn-rw-auction-advisor-v1.user.js`.

### Reference documentation

All design decisions for this script must be consistent with the four docs
in `docs/`:

| Doc | Contents |
|-----|---------|
| [`docs/rw-pricing-logic.md`](docs/rw-pricing-logic.md) | BB floor formula, auction max bid targets, armor quality scoring (King's method), net profit calculation, fee structure, core max-offer formula, price reference hierarchy |
| [`docs/rw-api-reference.md`](docs/rw-api-reference.md) | Torn API v2 endpoints (auction house, item market), full response schemas, DOM selectors for amarket.php, TornW3B API (opt-in), armor item IDs, rate limiting rules |
| [`docs/rw-community-context.md`](docs/rw-community-context.md) | Trader mindset, auction red flags, safe bid patterns, mug risk, negotiation rules, selling strategy, market manipulation awareness, common mistakes |
| [`docs/rw-armor-guide.md`](docs/rw-armor-guide.md) | All eight armor set use cases, piece priority, Riot Helmet special role, mixed set logic, full set bonuses, yellow quality vs bonus % tradeoff, orange/red behavior, advisor scope |

### Torn PDA constraints

All constraints in the **Torn Scripting Rules & API Compliance** section
below apply in full. Specific constraints most relevant to this script:

- **Key placeholder:** `###PDA-APIKEY###` — PDA injects the real key at
  install time; never prompt for a key unless PDA injection is unavailable
- **Permitted data sources:** Torn official API (`api.torn.com/v2`), the
  DOM of `amarket.php`, and **TornW3B (`weav3r.dev/api`)**.
  TornW3B is a standard unconditional API call — no opt-in toggle, no
  disclosure table, no compliance concern. It is a community-maintained
  bazaar data API that users contribute to voluntarily. The Torn "item
  market" is only one part of the full market; bazaar listings (via
  TornW3B) are equally valid pricing data. Both sources must be queried
  together to form an accurate market comp. Do not ever treat TornW3B as
  optional, gated, or a compliance issue in this script.
- **API polling:** Only on user action or page load; no background timers
  that fire while the user is away from the page. Item market endpoint is
  globally cached — do not hammer it
- **No automation:** The script displays pricing information only. It must
  never place bids, click buttons, or submit any form on behalf of the user

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

---

## Torn Scripting Rules & API Compliance

**These are hard constraints. Any script that violates them risks account ban, suspension, or permanent loss of API access. Every new script and every modification to an existing script must be verified against all rules below before commit.**

### Permitted data sources — hard gate

A script may only consume data from these sources:

1. **Torn's official API** (`https://api.torn.com/`) — using the player's own key
2. **The DOM of the page currently loaded and actively viewed** by the user in their browser tab
3. **TornW3B** (`https://weav3r.dev/api`) — community bazaar data API. Unconditional, no opt-in required. See the RW Auction Advisor section above.

Any other data source is prohibited. This means:

- **No background page scraping.** A script must not fetch or read any Torn page that the user has not manually navigated to and is currently viewing.
- **No cross-tab or unfocused-window data extraction.** Reading DOM from a tab that is not in focus is prohibited.
- **No non-API HTTP requests to Torn** (`torn.com` endpoints, internal APIs, etc.) except the official API — and only when triggered by the user loading a relevant page or explicitly interacting with the script UI.
- **No CAPTCHA bypass attempts** of any kind.
- **No sending data extracted from unfocused pages to external services, alerts, or notifications.**

### Automation prohibition

Scripts must not take autonomous actions on behalf of the player. Specifically:

- **No automated clicking, form submission, or game action triggering** — the script may display information but must not act.
- **No polling loops that make non-API requests to Torn** on a timer without the user actively viewing the relevant page.
- **API polling is allowed** but must be rate-limited (see below) and scoped to data the script genuinely needs.

### API key handling — non-negotiable rules

- **Never request passwords.** Scripts must never ask for, read, or transmit a Torn account password under any circumstance.
- **Never request a player name or player ID** as a substitute for the API key — the key alone is sufficient to retrieve all user data.
- **Never store keys in plaintext outside `localStorage`** (which is sandboxed to the browser/domain). Keys must not be sent to any external server unless the user has explicitly opted in and the ToS disclosure table (see below) is shown.
- **Never share or expose another player's key.** If a script ever accepts keys from multiple users (e.g., a faction tool), each key must be treated as confidential and never surfaced to other users.
- **Remove or disable invalid keys immediately on API error code 2 (incorrect key) or code 13 (key owner banned).** Do not continue polling with a broken key.
- **Use `###PDA-APIKEY###` as the key placeholder** in all userscripts — never hardcode real keys, not even for testing.

### Rate limiting — enforced in code

- Hard cap: **100 API requests per minute** across all keys for a single player. Scripts must never exceed this.
- For most data (battle stats, bars, etc.) a **5-minute polling interval is the minimum acceptable default**. Use longer intervals where freshness is not critical.
- Use the `timestamp` query parameter to bust the 30-second service cache only when fresh data is genuinely required — not by default.
- **Globally cached selections cannot be bypassed** and must not be polled more frequently than their cache TTL makes meaningful. Current globally cached selections:
  - `market` → `itemmarket`, `properties`, `rentals`
  - `company` → `companies`
  - `user` → `bazaar`, `bounties`
  - `torn` → `bounties`
- Request **only the selections actually needed** for the feature. Never request broad selections to cache for hypothetical future use.

### Disclosure requirements — required for any script that stores or shares data/keys

If a script stores API data or keys beyond the user's own `localStorage`, or shares any data with external services, the script's UI **must display** the following disclosure table at the point where the user provides their API key:

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| *(one of: No / Only locally / Temporary <1 min / Temporary <1 day / Persistent until deletion / Persistent forever)* | *(one of: Nobody / Faction / Friends & faction / General public / Service owners / Service owners & customers)* | *(one of: Non-malicious statistical analysis / Public amusement / Public community tools / Competitive advantage [specify] / Personal gain [specify] / Other [specify])* | *(one of: Not stored/Not shared / Stored, used only for automation / Stored, shared with faction / Stored, shared with other services / Public)* | *(one of: Minimal / Limited / Full / Custom — specify selections)* |

**All current scripts in this repo are local-only** (data stays in the browser, key stays in `localStorage` or is injected by PDA and never transmitted). The correct disclosure for any such script is: `Only locally | Nobody | [purpose] | Not stored/Not shared | [selections used]`. If a future script changes this, the table must be updated and displayed in the UI.

### No malicious or undisclosed functionality

- All script functionality must be visible and documented. No hidden behaviors, silent data collection, or obfuscated code.
- Scripts must not be used to gain an advantage through means Torn's rules prohibit (botting, automated attacking, market manipulation bots, etc.).
- Releasing a script with functionality not described to the user is a bannable offense.

### Summary checklist — verify before every commit

- [ ] Script only reads from the official API, TornW3B, or the currently viewed page DOM
- [ ] No background scraping, no unfocused-tab reads, no non-API Torn requests
- [ ] No automated game actions (clicks, submissions, etc.)
- [ ] API polling interval ≥ 5 minutes; total requests stay well under 100/min
- [ ] Only the minimum required API selections are requested
- [ ] Key handled via `###PDA-APIKEY###` or user-entered into `localStorage`; never transmitted externally
- [ ] Invalid key errors (codes 2, 13) remove/disable the key immediately
- [ ] No passwords or usernames requested
- [ ] If data or keys leave `localStorage`, the disclosure table is shown in the UI
- [ ] No hidden, obfuscated, or undisclosed functionality
