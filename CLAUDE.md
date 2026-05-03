# Torn Scripts — Claude Guidelines

## Session Memory

At the **start of every session**, immediately read `.claude/memory.md`. The SessionStart hook will output its contents automatically, but if for any reason it wasn't shown, read the file explicitly before doing anything else.

At the **end of any session where meaningful work was done**, update `.claude/memory.md` with:
- What is currently WIP (be specific: file names, function names, line numbers)
- Key decisions made this session and the reasoning
- Any open questions or blockers
- Concrete next steps for the following session

Keep the file under 300 lines. Replace stale entries rather than appending indefinitely. Use the date in the `_Last updated_` line.

---

## Shell & CLI Constraints (Windows)

PowerShell 5.1 (the shell available here) cannot pass long strings to native executables via here-strings — arguments over ~893 bytes are silently truncated or cause a parse error.

**Rule: never use `--body` or `--title` with long inline strings when calling `gh`.** Instead, write the body to a temp file and use `--body-file`:

```powershell
$body = @'
## Summary
...
'@
$tmp = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($tmp, $body, [System.Text.Encoding]::UTF8)
& "C:\Program Files\GitHub CLI\gh.exe" pr create --title "..." --body-file $tmp
Remove-Item $tmp
```

**`gh` is only available via full path** (`C:\Program Files\GitHub CLI\gh.exe`) in PowerShell. It is not on the PATH in Bash. Always use the full path in PowerShell tool calls.

---

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

## Engineering Principles

Apply these to every task, plan, review, or design decision. They are constraints, not guidelines — check work against all of them before proceeding.

### 1. Avoid complexity

Complexity takes two forms:
- **Obscurity** — important information is not obvious; a reader has to dig to understand what something does or why.
- **Change amplification** — a simple change requires modifications in many places.

Before adding anything — a parameter, an abstraction, a file, a concept — ask: does this make the system easier or harder to understand and modify? If harder, don't add it. The symptom of complexity is always the same: you have to hold too many things in your head at once.

### 2. Always take small, deliberate steps

Never make several changes at once. Each step should do exactly one thing, leave the system in a working state, and be verifiable on its own before the next step begins. If you need a list to describe the step, it's too big.

### 3. The rate of feedback is your speed limit

Before starting any step, know: how will I know this worked? If the answer is "I'll check it later" or "it's hard to test," stop and find a faster feedback path first. Slow feedback forces guessing. Guessing creates bugs. Bugs create complexity.

### 4. Never take on a task that's too big

A task is too big when you can't hold the full change in your head, can't describe a clean intermediate state, or the feedback loop spans the entire change. Decompose first. Find the smallest change that is independently useful and verifiable. Do that. Then reassess. If you can't decompose it, you don't understand it well enough yet — understanding it is the first step.

### 5. The best modules are deep

A deep module has a simple interface and a lot of functionality behind it. A shallow module has an interface nearly as complex as its implementation — it leaks internals and adds complexity instead of hiding it. Push complexity inward, not outward. Make the interface the smallest surface that still gives callers what they need.

**Deletion test:** if you deleted this module, would its complexity disappear (shallow, not earning its keep) or reappear in N different callers (deep, earning its keep)? Only keep modules that pass.

---

## Architecture Patterns

The gym optimizer establishes patterns worth reusing in future scripts:

- **State management**: Single `const MEM = {}` holds all mutable state. Assign to fields, never rebind `MEM`.
- **Persistence**: `Store.get(k)` / `Store.set(k, v)` wrap localStorage in try/catch. Namespace keys with a short script-specific prefix to avoid collisions.
- **Render cycle**: Single `render()` rebuilds the entire UI from `MEM` state. No partial DOM patching. Call on every state change.
- **Torn API fetch**: Always check `d.error` before using data. Store error in `MEM.fetchError` for UI surfacing. 5-min polling interval minimum.
- **DOM reading**: Prefer reading from the page DOM before making API calls. Use multiple CSS selector fallbacks + text regex fallback.

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

**Status: PARKED at v1.33.1.** Do not touch until user switches back. Next: ledger UI overhaul — must `/grill-me` first.

**Target page:** `https://www.torn.com/amarket.php` (`@match https://www.torn.com/amarket.php*`)

**Goal:** Evaluate Riot/Assault armor auction listings for flip potential. Calculates recommended max offer price per listing based on BB floor, item market comps, armor quality scoring, and target profit margin.

**Reference docs:** [`docs/rw-pricing-logic.md`](docs/rw-pricing-logic.md), [`docs/rw-api-reference.md`](docs/rw-api-reference.md), [`docs/rw-community-context.md`](docs/rw-community-context.md), [`docs/rw-armor-guide.md`](docs/rw-armor-guide.md)

**Data sources:** Torn API v2, `amarket.php` DOM, TornW3B (`weav3r.dev/api`) — unconditional, no opt-in. Key via `###PDA-APIKEY###`. No automated bids or form submissions ever.

**Ledger roadmap (Steps A–E, not yet implemented):** See [`docs/rw-advisor-context.md`](docs/rw-advisor-context.md).

---

## Development Workflow

This is the standard pipeline for iterative improvements. Each stage is **one session**. Every session has an explicit completion contract — what must be written to memory before the session closes — so the next session can start cold with full context.

### Bug fix trigger — `/qa`

**This is the entry point when the user reports a bug.** Do not start implementing. Run `/qa` to interview the user about the symptom, explore the root cause, and file a properly structured GitHub issue. The session is not done until:
- Issue is filed with a TDD-based fix plan
- Memory updated: `"issue #X filed (<one-line summary>); next session: /grill-me on #X if design is non-trivial, else implement directly"`

### Design lock — `/grill-me`

For any non-trivial fix or new feature (behavioral change, new UI surface, new data flow). Interview until all decisions are locked. The session is not done until:
- Relevant decisions added to `CONTEXT.md` and/or `docs/adr/` if durable
- Memory updated: `"design locked for #X; decisions: <summary>; next session: /to-issues or implement directly"`

### Ticket breakdown — `/to-issues`

When a spec produces multiple independent pieces of work. The session is not done until:
- All tickets filed on GitHub
- Memory updated: `"tickets #A–#C filed and ready; next session: implement #A"`

### Pure logic — `/tdd`

For any new or changed pure function (scoring, pricing, detection logic). Run `/tdd` against `test-snipe-engine.js`. The session is not done until:
- Tests pass
- Function committed
- Memory updated: `"<function> implemented and tested; next session: wire into IIFE / build UI"`

### Implement — (direct)

Standard implementation session. The session is not done until:
- Commit made with version bump
- GitHub issue closed
- Memory updated: `"v1.X.Y done (#N); next session: /simplify or next ticket #M"`

### Tidy — `/simplify`

After a feature lands, run `/simplify` on the changed code. The session is not done until:
- Any follow-up commit made (or explicitly confirmed nothing needed)
- Memory updated: `"post-#N simplify done; clean"`

---

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`EstradaRPM/Torn-scripts`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

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
