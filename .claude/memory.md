# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-30 (#180 done as v1.48.0 — ALL tickets complete)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.48.0` (on main, pushed — clean, no open PRs, no stale branches)
**Status:** ALL 12 tickets done. Snipe Tracker v1 feature set complete.

### Known PDA limitation (non-fixable without PDA engine change)
`GM_xmlhttpRequest` on Torn PDA's WebView does NOT bypass the page CSP. `weav3r.dev` calls will always fail with a network error on PDA. Script silently falls back to Torn API data only. Console noise is expected — not a bug to fix.

---

## Implementation tickets

| # | Title | Status |
|---|-------|--------|
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

## v1.48.0 — What was done (#180)

Mug scenario display:
- `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` wired into IIFE pure functions section (after `calcSnipeFrequency`)
- `renderProjection()`: shows mug net outcome row when `grossRev >= MUG_THRESHOLD ($10M)`. Green = still profitable after mug; red = loss
- `injectSnipeCard`: replaced hardcoded `saleValue * 0.15` gross loss with `calcMugScenario` net result; color-coded (red if loss, amber if still profitable)

## v1.47.0 — What was done (#178)

PDA notifications + audio alert:
- Trigger: poll cycle only (ADR 0001). Fires once on `false → true` transition per item
- Crossing state: `MEM.lastSnipeState = {}` (itemId → bool, not persisted)
- Audio: 3-tone ascending chime, Web Audio API
- Notification: TornPDA native bridge first; `GM_notification` fallback
- Settings: "Snipe alerts" on/off toggle, default on

---

## Snipe Tracker — Design decisions (locked)

- Bazaar = 0% fee. Item market = 5%. Mug default = 15%.
- Smart sell position: volume-block anchored, trend-adjusted (`computeSmartSellPosition`)
- Available capital: `vault_amount × (1 − vaultFloorPct/100)`. Default floor 10%.
- `BLOCK_VALUE_PCT = 0.10`, `FREQ_WINDOW = 2 * 24 * 60 * 60 * 1000`, `MUG_THRESHOLD = 10_000_000` — in IIFE
- Cards sort: two-tier (snipe items by weighted score; non-snipe by snipe frequency)
- Per-card collapse toggle (▼/▶) in Row 1; `MEM.cardCollapsed` dict; **default collapsed**
- PAGE_MODE: 'market' = full panel + DOM, 'background' = silent poll only
- MutationObserver on imarket listings for real-time detection (zero API cost) — unreliable on PDA
- Snipe alerts: poll-triggered only (see ADR 0001)
- Logging: pending queue + Quick Log strip + Batch Entry form

## Pure functions — status

| Function | Status |
|----------|--------|
| `calcWeightedScore(grossProfit, roi, baseROI)` | ✅ in IIFE |
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | ✅ in IIFE |
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | ✅ in IIFE |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | ✅ in IIFE |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | ✅ in IIFE |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | ✅ in IIFE (v1.48.0) |

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
