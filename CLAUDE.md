# Torn Scripts — Claude Guidelines

## Session Memory

Managed by the auto-memory system. The SessionStart hook outputs memory at start — trust that output.

---

## Shell & CLI Constraints (Windows)

PowerShell 5.1 silently truncates arguments over ~893 bytes to native executables.

**Rule: never pass long strings inline to `gh`.** Write body to a temp file and use `--body-file`:

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

**`gh` is only available via full path** (`C:\Program Files\GitHub CLI\gh.exe`) in PowerShell.

---

## Repository Purpose

Personal collection of userscripts for the browser game **Torn City** (torn.com).

---

## Current Scripts

| File | Status | Script doc |
|------|--------|-----------|
| `torn-snipe-tracker-v1.user.js` | Active | `docs/scripts/snipe-tracker.md` |
| `torn-gym-optomizer-v5.js` | Active | `docs/scripts/gym-optimizer.md` |
| `torn-rw-auction-advisor-v1.user.js` | **Parked v1.33.1** | `docs/scripts/rw-advisor.md` |

**Before touching any script: read its script doc.**
**Parked scripts:** run `/grill-me` before any changes.
**New script:** copy `docs/scripts/_template.md` → `docs/scripts/[name].md`, fill it out, then add a row here. Run `/grill-me` before writing any code.

---

## File Naming

```
torn-[feature]-v[N].user.js    # Tampermonkey userscript
torn-[feature]-v[N].js         # Standalone script
```

Lowercase, hyphen-separated, always `torn-` prefix, version suffix on major rewrites. `.user.js` = Tampermonkey-installable.

---

## Userscript Standards

Every userscript opens with:

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
- `@match` scoped to exact page — never `torn.com/*` unless truly needed
- API key: `###PDA-APIKEY###` — Torn PDA injects the real key at install time

### Version bumps (required for PDA update detection)

| Change type | Bump |
|-------------|------|
| Bug fix / minor tweak | patch (`1.0.0 → 1.0.1`) |
| New feature / UI change | minor (`1.0.1 → 1.1.0`) |
| Full rewrite / breaking | major (`1.1.0 → 2.0.0`) |

**Also update `SCRIPT_VERSION`** — defined near top of the IIFE. Must match `@version` exactly. Change both in the same edit.

---

## JavaScript Style

ES6+: `const`/`let` only (never `var`), arrow functions, template literals, `async/await` (no raw `.then()` chains), destructuring where readable. No external libraries. Single self-contained file. Wrap body in IIFE: `(function () { 'use strict'; ... })();`

---

## Architecture Patterns (universal)

These apply to every script. Per-script specifics (MEM shape, Store keys, module breakdown) live in the script's doc.

- **State:** Single `const MEM = {}`. Assign fields; never rebind `MEM`.
- **Persistence:** `Store.get(k)` / `Store.set(k, v)` wrap localStorage in try/catch. Namespace keys with a script-specific prefix.
- **Render cycle:** Single `render()` rebuilds entire UI from `MEM`. No partial DOM patching. Call on every state change.
- **API fetch:** Always check `d.error` before using data. Store error in `MEM.fetchError` for UI surfacing. 5-min poll minimum.
- **DOM reading:** Prefer reading from page DOM before API calls. Multiple CSS selector fallbacks + text regex fallback.

For Torn API details, rate limits, and the compliance checklist: `docs/torn-domain.md`.

---

## Engineering Principles

Full detail: `docs/engineering-principles.md`

1. **Avoid complexity** — if harder to understand/modify, don't add it.
2. **Small steps** — one thing per step; system stays working; verifiable before next.
3. **Feedback first** — know exactly how you'll verify before starting.
4. **Scope limit** — can't hold it in your head? Decompose first.
5. **Deep modules** — simple interface, rich implementation.

---

## Development Workflow

| Trigger | Skill | Done when |
|---------|-------|-----------|
| Bug reported | `/qa` | Issue filed with TDD fix plan; memory updated |
| Non-trivial design | `/grill-me` | Decisions captured in script doc + `docs/adr/`; memory updated |
| Spec → tickets | `/to-issues` | All tickets filed; memory updated |
| New/changed pure function | `/tdd` | Tests pass, committed; memory updated |
| Implementation | (direct) | Commit + version bump, issue closed; memory updated |
| Post-feature | `/simplify` | Follow-up commit or confirmed nothing needed; memory updated |
| **New script** | `/grill-me` → fill `_template.md` → (if multi-session: `/to-prd` → `/to-issues`) | Template filled, script doc committed, row added to table above |

End every session on `main`: `git checkout main && git pull`.

---

## Agent Skills

- Issues: GitHub Issues (`EstradaRPM/Torn-scripts`) — `docs/agents/issue-tracker.md`
- Labels: `docs/agents/triage-labels.md`
- Domain docs: `docs/scripts/[name].md` + `docs/adr/` — see `docs/agents/domain.md`

---

## Hard Constraints

- No hardcoded player IDs, API keys, or faction data — localStorage only
- No `@grant GM_xmlhttpRequest` unless `fetch` genuinely cannot do the job
- No external dependencies; scripts must be fully self-contained
- Full compliance checklist in `docs/torn-domain.md` — verify before every commit
