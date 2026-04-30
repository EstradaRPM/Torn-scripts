# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-30 (QA session — #192–#195 filed; pipeline strategy pivot)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.48.4` (on main, pushed — clean, no open PRs, no stale branches)
**Status:** Refactor wave + pipeline pivot. Two tracks running in parallel.

### Known PDA limitation (non-fixable without PDA engine change)
`GM_xmlhttpRequest` on Torn PDA's WebView does NOT bypass the page CSP. `weav3r.dev` calls will always fail with a network error on PDA. Script silently falls back to Torn API data only. Console noise is expected — not a bug to fix.

---

## NEXT SESSION — start here

**Step 1: implement #192 directly** (no grill-me needed — one-line scope)
- Exclude bazaar-sourced listings from the snipe alert condition
- `lowestListed` in alert evaluation must only reflect item market listings, not bazaar
- Bazaar data from TornW3B continues to feed `computePollResult` for fair value — do NOT remove it from the merge
- Version bump: 1.48.4 → 1.48.5 (patch)

**Step 2: /grill-me #194** — card layout/UX on mobile before any alert pipeline work
- Alert card covers page content on mobile; needs non-blocking layout + one-tap item navigation
- Design decisions here inform what #193 must render

**Step 3: /grill-me #193** — MutationObserver wired into full alert pipeline
- Blocked by #192 (do first); design informed by #194 (grill-me first)
- MutationObserver already exists; needs to drive same alert path as poll (threshold check, cooldown, visual+audio)

**Step 4: #195 direct** — auto-capture purchases from confirmation popup
- MutationObserver watches for Torn's purchase confirmation DOM node
- Verify exact DOM selector/wording with a real test purchase before coding
- Auto-creates a pending ledger entry; user can dismiss

---

## Open tickets

### Refactor wave

| # | Title | Status | Blocked by |
|---|-------|--------|-----------|
| #191 | refactor: extract `sortWatchlistItems` + `buildCardHTML` + `bindCardEvents` | 🔜 pending | — |

### Pipeline pivot (filed 2026-04-30)

| # | Title | Status | Blocked by |
|---|-------|--------|-----------|
| #192 | fix: exclude bazaar listings from snipe alert evaluation | 🔜 **do first** | — |
| #193 | feat: wire MutationObserver into full alert pipeline | 🔜 /grill-me → implement | #192 ✅ + #194 grill-me |
| #194 | fix: alert card non-blocking layout + one-tap nav (mobile) | 🔜 /grill-me → implement | — |
| #195 | feat: auto-capture purchases from confirmation popup | 🔜 implement (test buy first) | — |

**Why the pivot:** Bazaar snipe alerts are structurally broken — TornW3B aggregator lag means items are always already sold by the time alerts fire. Item market real-time DOM detection (MutationObserver) is the correct snipe surface.

---

## Completed tickets

| # | Title | Status |
|---|-------|--------|
| #188 | fix: alert dedup boolean → timestamp | ✅ DONE v1.48.2 |
| #189 | refactor: partition MEM into data/poll/ui | ✅ DONE v1.48.3 |
| #190 | refactor: extract `computePollResult()` | ✅ DONE v1.48.4 |
| #187 | Render once per poll cycle | ✅ DONE v1.48.1 |
| #174 | `@match` wildcard + page mode detection | ✅ DONE v1.38.0 |
| #175 | Pure function engine + Node test suite | ✅ DONE |
| #176 | Capital API: vault fetch + settings refactor | ✅ DONE v1.39.0 |
| #177 | Snipe frequency badge | ✅ DONE v1.46.0 |
| #178 | PDA notifications + audio alert | ✅ DONE v1.47.0 |
| #179 | Smart sell position + snipe detection anchor | ✅ DONE v1.40.0 |
| #180 | Mug scenario display | ✅ DONE v1.48.0 |
| #181 | Collapsed card layout + weighted sort | ✅ DONE v1.41.0 |
| #182 | MutationObserver + real-time green highlight | ✅ DONE v1.42.0 |
| #183 | Ledger summary fixes | ✅ DONE v1.45.0 |
| #184 | Injected snipe card + Queue button | ✅ DONE v1.43.0 |
| #185 | Quick Log strip + Batch Entry + pending queue | ✅ DONE v1.44.0 |

---

## #191 — What to do (when returning to refactor wave)

Split `renderWatchlist()` (~lines 1605–1900, ~296 lines) into three focused functions:

- `sortWatchlistItems(watchlist, pollResults)` → sorted array — pure function
- `buildCardHTML(item, pollResult, snapshots, trend, settings, uiState)` → HTML string — no DOM access
- `bindCardEvents(cardEl, item)` → void — all event listeners

`renderWatchlist()` becomes thin orchestrator ≤ 30 lines. Version bump: 1.48.x → 1.48.x+1 (patch).

---

## Snipe Tracker — Design decisions (locked)

- Bazaar = 0% fee. Item market = 5%. Mug default = 15%.
- Smart sell position: volume-block anchored, trend-adjusted (`computeSmartSellPosition`)
- Available capital: `vault_amount × (1 − vaultFloorPct/100)`. Default floor 10%.
- `BLOCK_VALUE_PCT = 0.10`, `FREQ_WINDOW = 2 * 24 * 60 * 60 * 1000`, `MUG_THRESHOLD = 10_000_000`, `ALERT_COOLDOWN_MS = 5 * 60 * 1000` — in IIFE constants
- Cards sort: two-tier (snipe items by weighted score; non-snipe by snipe frequency)
- Per-card collapse toggle (▼/▶) in Row 1; `MEM.ui.cardCollapsed` dict; **default collapsed**
- PAGE_MODE: 'market' = full panel + DOM, 'background' = silent poll only
- MutationObserver on imarket listings for real-time detection (zero API cost) — unreliable on PDA
- Snipe alerts: poll-triggered only; cooldown 5 min per item (ADR 0001 + #188) — **#193 will change this**
- Logging: pending queue + Quick Log strip + Batch Entry form — **#195 will add auto-capture**

## Pure functions — status

| Function | Status |
|----------|--------|
| `calcWeightedScore(grossProfit, roi, baseROI)` | ✅ in IIFE |
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | ✅ in IIFE |
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | ✅ in IIFE |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | ✅ in IIFE |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | ✅ in IIFE |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | ✅ in IIFE (v1.48.0) |
| `computePollResult(mergedListings, item, availableCapital, snapshots, trend)` | ✅ in IIFE (v1.48.4) |

---

## RW Auction Advisor — PARKED

**File:** `torn-rw-auction-advisor-v1.user.js`
**Version:** `1.33.1` (on main, fully shipped)
**Status:** Parked — do not touch until user switches back

**Next when returning:** Ledger UI overhaul — must do a `/grill-me` session first.

### Key function locations (v1.33.1)

| Symbol | ~Line | Notes |
|--------|-------|-------|
| `ARMOR_SCORING` | 152 | baseBonusPct per set |
| `detectFloorCluster` | 403 | Retained |
| `calcFloorFlipMaxBid` | 470 | Retained |
| `isNearBase` | ~490 | New in v1.33.0 |
| `isFloorPositioned` | ~500 | New in v1.33.0 |
| `findNearestComp` | ~515 | New in v1.33.0 |
| `computeListingMetrics` | ~1700 | Rewritten in v1.33.0 |
| `logListing` | ~2160 | Unchanged |
| `renderLedger` | ~2362 | Unchanged |
| `enrichListingsFromMarketData` | ~2706 | Stores allComps + floorCluster |
