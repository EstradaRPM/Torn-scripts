# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-29 (tickets #176, #179, #181 done; next is #182)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.41.0` (on main, pushed)
**Status:** Implementation in progress — 6 of 12 tickets done

**Next session:** Implement issue #182 — MutationObserver + real-time green highlight. No skill needed, implement directly. See detail below.

---

## Implementation tickets

| # | Title | Status |
|---|-------|--------|
| #174 | `@match` wildcard + page mode detection | ✅ DONE v1.38.0 |
| #175 | Pure function engine + Node test suite | ✅ DONE |
| #176 | Capital API: vault fetch + settings refactor | ✅ DONE v1.39.0 |
| #177 | Snipe frequency badge | open — unblocked (leaf, do after critical path) |
| #178 | PDA notifications + audio alert | open — unblocked (leaf, do after critical path) |
| #179 | Smart sell position + snipe detection anchor | ✅ DONE v1.40.0 |
| #180 | Mug scenario display | open — unblocked (leaf, do after critical path) |
| #181 | Collapsed card layout + weighted sort | ✅ DONE v1.41.0 |
| #182 | MutationObserver + real-time green highlight | **NEXT** — needs #174 ✓, #179 ✓, #181 ✓ |
| #183 | Ledger summary fixes | open — unblocked (leaf, do after critical path) |
| #184 | Injected snipe card + Queue button | open — needs #182, #181 ✓ |
| #185 | Quick Log strip + Batch Entry + pending queue | open — needs #184 |

---

## #182 — What to do (start here)

**Issue:** https://github.com/EstradaRPM/Torn-scripts/issues/182

MutationObserver on the imarket listings DOM for real-time snipe detection at zero API cost. When a new listing appears below the snipe threshold, highlight the card green.

**Steps:**
1. On PAGE_MODE === 'market', add a MutationObserver on the item market listings container.
2. When mutations fire: re-run snipe detection logic against the current DOM listings (or trigger a lightweight re-check).
3. Highlight any card whose item is newly a snipe with a green flash/border — distinct from the static SNIPE badge.
4. Observer should disconnect when the panel is removed or page navigates away.
5. Bump to v1.42.0.

**Key locations in v1.41.0:**
- `PAGE_MODE` / `detectPageMode()`: ~line 20–30
- `runPoll()` / `startPollLoop()`: search for them
- `renderWatchlist()`: search — this is where card green highlight would be applied
- Init section (where vault fetch is): near bottom of IIFE, ~line 2100+
- `.st-status-snipe` CSS class: already defined, turns text green

---

## Snipe Tracker v2 — Design decisions (locked)

- Bazaar = 0% fee. Item market = 5%. Mug default = 15%.
- Smart sell position: volume-block anchored, trend-adjusted (`computeSmartSellPosition`)
- Available capital: `vault_amount × (1 − vaultFloorPct/100)`. Default floor 10%.
- `BLOCK_VALUE_PCT = 0.10` — in IIFE
- Cards sorted by `calcWeightedScore(grossProfit, roi, 2)` — best snipe floats to top
- Per-card collapse toggle (▼/▶) in Row 1; `MEM.cardCollapsed` dict
- PAGE_MODE: 'market' = full panel + DOM, 'background' = silent poll only
- MutationObserver on imarket listings for real-time detection (zero API cost)
- PDA native notification bridge on new snipe from any page
- Logging: pending queue + Quick Log strip + Batch Entry form

## Pure functions — status

| Function | Status |
|----------|--------|
| `calcWeightedScore(grossProfit, roi, baseROI)` | ✅ in IIFE |
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | ✅ in IIFE |
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | ✅ in IIFE |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | ✅ in IIFE |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | in test-snipe-engine.js — wire in #180 |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | in test-snipe-engine.js — wire in #177 |

---

## RW Auction Advisor — PARKED

**File:** `torn-rw-auction-advisor-v1.user.js`
**Version:** `1.33.1` (on main, fully shipped)
**Status:** Parked — do not touch until snipe tracker work is complete

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
