# Torn Scripts — Claude Guidelines

## Session Memory

Session state is managed by the auto-memory system. The SessionStart hook outputs memory automatically at session start — trust that output. No need to manually read or write `.claude/memory.md`.

---

## Shell & CLI Constraints (Windows)

PowerShell 5.1 cannot pass long strings to native executables via here-strings — arguments over ~893 bytes are silently truncated.

**Rule: never use `--body` or `--title` with long inline strings when calling `gh`.** Write the body to a temp file and use `--body-file`:

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

**`gh` is only available via full path** (`C:\Program Files\GitHub CLI\gh.exe`) in PowerShell. Not on PATH in Bash.

---

## Repository Purpose

Personal collection of scripts for the browser game **Torn City** (torn.com). All scripts are Torn-specific.

---

## Current Scripts

| File | Type | Purpose |
|------|------|---------|
| `torn-gym-optomizer-v5.js` | Userscript | Multi-month gym training planner with real-time energy tracking and buff rotation support. Note: filename has a typo ("optomizer"); canonical name is "Torn Gym Optimizer". |
| `torn-snipe-tracker-v1.user.js` | Userscript | Bazaar snipe detector and trade ledger. Watches configurable item list, flags listings below threshold, tracks trades with P&L. |
| `torn-rw-auction-advisor-v1.user.js` | Userscript *(parked)* | Auction house advisor for Riot/Assault armor. Evaluates flip potential via BB floor, comps, quality scoring, and target margin. |

---

## File Naming Conventions

```
torn-[feature]-v[N].user.js    # Tampermonkey/Greasemonkey userscript
torn-[feature]-v[N].js         # Standalone script / other tool
```

- Lowercase, hyphen-separated; always prefix `torn-`; include version suffix on major rewrites
- `.user.js` = Tampermonkey-installable; omit for non-userscripts

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

- `@grant none` unless a specific GM API is actually needed
- `@match` scoped to exact Torn page(s) — never `https://www.torn.com/*` unless truly needed
- `@version` follows semver; `@updateURL` / `@downloadURL` point to the raw file on the `main` branch
- API key: `###PDA-APIKEY###` placeholder — Torn PDA injects the real key at install time

### Version bump rules (required for PDA update detection)

PDA detects updates by comparing remote `@version` against installed. **Every commit that changes script behavior MUST include a `@version` bump.**

| Change type | Bump | Example |
|-------------|------|---------|
| Bug fix / minor tweak | patch | `5.8.0 → 5.8.1` |
| New feature / UI change | minor | `5.8.1 → 5.9.0` |
| Full rewrite / breaking change | major | `5.9.0 → 6.0.0` |

**Also update `SCRIPT_VERSION`:** Every userscript defines `const SCRIPT_VERSION = 'x.y.z'` near the top of the IIFE. Must match `@version` exactly — change both in the same edit.

---

## JavaScript Style

ES6+ throughout: `const`/`let` only (never `var`), arrow functions, template literals, `async/await` (no raw `.then()` chains), destructuring where readable. No external libraries — self-contained single files. Wrap the entire body in an IIFE: `(function () { 'use strict'; ... })();`

---

## Engineering Principles — Hard constraints on every task

Full detail: [`docs/engineering-principles.md`](docs/engineering-principles.md)

1. **Avoid complexity** — before adding anything, ask: easier or harder to understand/modify? If harder, don't.
2. **Small steps** — each step does one thing, leaves the system working, and is verifiable before the next begins.
3. **Feedback first** — before starting, know exactly how you'll verify it worked.
4. **Scope limit** — can't hold the full change in your head or describe a clean intermediate state? Decompose first.
5. **Deep modules** — simple interface, rich implementation. Push complexity inward. **Deletion test:** removing this module — does the complexity disappear (shallow, cut it) or reappear in N callers (deep, keep it)?

---

## Architecture Patterns

- **State**: Single `const MEM = {}` for all mutable state. Assign fields, never rebind `MEM`.
- **Persistence**: `Store.get(k)` / `Store.set(k, v)` wrap localStorage in try/catch. Namespace keys with a script-specific prefix.
- **Render cycle**: Single `render()` rebuilds the entire UI from `MEM`. No partial DOM patching. Call on every state change.
- **Torn API fetch**: Always check `d.error` before using data. Store error in `MEM.fetchError` for UI surfacing. 5-min polling minimum.
- **DOM reading**: Prefer reading from page DOM before API calls. Multiple CSS selector fallbacks + text regex fallback.

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

Gym access: Isoyama's: `DEF ≥ 1.25 × max(STR, SPD, DEX)` · Frontline: `STR + SPD ≥ 1.25 × (DEF + DEX)`

Headroom = how far a stat can grow before the condition reverses and the gym closes.

### Torn API
- Base: `https://api.torn.com/` · Auth: `?key=###PDA-APIKEY###` · Rate limit: 100 calls/min
- Combat endpoints: `user/?selections=battlestats`, `user/?selections=bars`

### Faction buffs
Rotate monthly. Accept as user-defined input — never hardcode, since buffs vary per faction.

---

## RW Auction Advisor

**PARKED at v1.33.1.** Do not touch until user switches back. Next session must `/grill-me` before any changes.

- Target page: `https://www.torn.com/amarket.php`
- Data sources: Torn API v2, page DOM, TornW3B (`weav3r.dev/api`) — unconditional, no opt-in
- Reference docs: `docs/rw-pricing-logic.md`, `docs/rw-api-reference.md`, `docs/rw-armor-guide.md`, `docs/rw-community-context.md`, `docs/prd-steps-i-through-l.md`

---

## Development Workflow

| Trigger | Skill | Session complete when |
|---------|-------|-----------------------|
| Bug reported | `/qa` | Issue filed with TDD fix plan; memory updated |
| Non-trivial design | `/grill-me` | Decisions in CONTEXT.md / `docs/adr/`; memory updated |
| Spec → multiple tickets | `/to-issues` | All tickets filed; memory updated |
| New/changed pure function | `/tdd` vs `test-snipe-engine.js` | Tests pass, committed; memory updated |
| Implementation | (direct) | Commit + version bump, issue closed; memory updated |
| Post-feature | `/simplify` | Follow-up commit or confirmed nothing needed; memory updated |

End every session on `main`: `git checkout main && git pull`.

---

## Agent Skills

- Issues: GitHub Issues (`EstradaRPM/Torn-scripts`) — see `docs/agents/issue-tracker.md`
- Labels: see `docs/agents/triage-labels.md`
- Domain docs: `CONTEXT.md` + `docs/adr/` — see `docs/agents/domain.md`

---

## Adding a New Script

1. Create file following naming convention; add a row to the Current Scripts table above
2. Open userscripts with the metadata block template; wrap body in IIFE with `'use strict'`
3. Use `###PDA-APIKEY###` for any API key placeholder
4. Test on the specific `torn.com` page(s) before committing

---

## What Not to Do

- Don't hardcode player IDs, API keys, or faction-specific data — make them configurable via `localStorage`
- Don't use `@grant GM_xmlhttpRequest` unless `fetch` genuinely can't do the job
- Don't add external dependencies; don't target pages outside `torn.com`; don't commit API keys

---

## Torn Scripting Rules & API Compliance

**Hard constraints. Violations risk account ban, suspension, or loss of API access. Verify before every commit.**

### Permitted data sources (hard gate)

Only: (1) Torn official API (`https://api.torn.com/`) with the player's own key, (2) DOM of the page currently loaded and actively viewed, (3) TornW3B (`https://weav3r.dev/api`) — unconditional, no opt-in. No background scraping, no cross-tab or unfocused-window reads, no non-API Torn requests, no CAPTCHA bypass.

### Automation prohibition

No automated clicking, form submission, or game actions. No non-API Torn polling on a timer. API polling is allowed but must be rate-limited and scoped to data the script genuinely needs.

### API key rules

- `###PDA-APIKEY###` in all userscripts; never hardcode real keys, not even for testing
- Never request passwords, player names, or player IDs
- Never store keys outside `localStorage`; never transmit externally without explicit opt-in + disclosure table shown
- On API error code 2 (bad key) or 13 (owner banned): immediately remove/disable the key and stop polling

### Rate limiting

- Hard cap: **100 req/min** per player
- Minimum polling interval: **5 minutes** for most data; longer where freshness isn't critical
- Only request selections actually needed; never cache speculatively
- Globally cached selections (bypass impossible): `market`→itemmarket/properties/rentals · `company`→companies · `user`→bazaar/bounties · `torn`→bounties

### Disclosure requirements

Required when a script stores API data/keys outside `localStorage` OR shares data externally. Display this table in the UI at the key-entry point:

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| *(No / Only locally / Temporary <1 min / <1 day / Persistent until deletion / forever)* | *(Nobody / Faction / Friends & faction / General public / Service owners / Service owners & customers)* | *(Non-malicious statistical analysis / Public amusement / Public community tools / Competitive advantage [specify] / Personal gain [specify] / Other [specify])* | *(Not stored/Not shared / Stored, used only for automation / Stored, shared with faction / Stored, shared with other services / Public)* | *(Minimal / Limited / Full / Custom — specify selections)* |

**All current scripts are local-only.** Correct disclosure: `Only locally | Nobody | [purpose] | Not stored/Not shared | [selections used]`.

### No malicious or undisclosed functionality

All functionality must be visible and documented. No hidden behaviors, silent data collection, or obfuscated code. No botting, automated attacking, or market manipulation.

### Summary checklist — verify before every commit

- [ ] Script only reads from official API, TornW3B, or currently-viewed DOM
- [ ] No background scraping, unfocused-tab reads, or non-API Torn requests
- [ ] No automated game actions (clicks, submissions, etc.)
- [ ] API polling ≥ 5 minutes; total requests well under 100/min
- [ ] Only minimum required API selections requested
- [ ] Key via `###PDA-APIKEY###` or localStorage; never transmitted externally
- [ ] Invalid key (codes 2, 13) immediately removed/disabled
- [ ] No passwords or usernames requested
- [ ] If data/keys leave localStorage, disclosure table shown in UI
- [ ] No hidden, obfuscated, or undisclosed functionality
