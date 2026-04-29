# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-29 (tickets #174 + #175 done; next is #176)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.38.0` (on main, pushed)
**Status:** Implementation in progress — 2 of 12 tickets done

**Next session:** Implement issue #176 — capital API vault fetch + settings refactor. No skill needed, implement directly. See detail below.

---

## Implementation tickets

| # | Title | Status |
|---|-------|--------|
| #174 | `@match` wildcard + page mode detection | ✅ DONE v1.38.0 |
| #175 | Pure function engine + Node test suite | ✅ DONE |
| #176 | Capital API: vault fetch + settings refactor | **NEXT** |
| #177 | Snipe frequency badge | open — unblocked |
| #178 | PDA notifications + audio alert | open — unblocked |
| #179 | Smart sell position + snipe detection anchor | open — needs #176 |
| #180 | Mug scenario display | open — needs #176 |
| #181 | Collapsed card layout + weighted sort | open — needs #179 |
| #182 | MutationObserver + real-time green highlight | open — needs #179 |
| #183 | Ledger summary fixes | open — needs #179 |
| #184 | Injected snipe card + Queue button | open — needs #182, #181 |
| #185 | Quick Log strip + Batch Entry + pending queue | open — needs #184 |

---

## #176 — What to do (start here)

**Issue:** https://github.com/EstradaRPM/Torn-scripts/issues/176

No new pure functions. Just wiring + settings swap. No skill needed.

**Steps:**
1. Copy `computeAvailableCapital` from `test-snipe-engine.js` into the IIFE (near other pure functions).
2. Add a vault fetch on script init: call `user/?selections=money` via `gmFetch`, compute `MEM.availableCapital = computeAvailableCapital(data.vault_amount, MEM.settings.vaultFloorPct)`. On error, set `MEM.availableCapital = 0` and log a warning. Fire once at init, not on every poll.
3. In `MEM.settings` defaults (~line 78): remove `availableCapital: 0`, add `vaultFloorPct: 10`.
4. In settings modal HTML: find the capital input (`st-input-capital`), replace with a "Vault Reserve Floor (%)" input (`st-input-vault-floor`).
5. Remove the `inputCapital.addEventListener('change', ...)` handler and replace with a `vaultFloorPct` handler that re-computes `MEM.availableCapital` on change.
6. Update `renderCapitalBar()` to read `MEM.availableCapital` (the live value) instead of `MEM.settings.availableCapital`.
7. Bump to v1.39.0.

**Key locations in v1.38.0:**
- `MEM.settings` default: ~line 78
- Capital input in settings HTML: search `st-input-capital` or `availableCapital`
- `inputCapital` change handler: ~line 1999
- `renderCapitalBar`: search for it
- Init section: ~line 2058 — add vault fetch call here
- `gmFetch`: ~line 758

---

## Snipe Tracker v2 — Design decisions (locked)

- Bazaar = 0% fee. Item market = 5%. Mug default = 15%.
- Smart sell position replaces P50: volume-block anchored, trend-adjusted
- Available capital: `vault_amount × (1 − vaultFloorPct/100)`. Default floor 10%.
- `BLOCK_VALUE_PCT = 0.10` — defined in `test-snipe-engine.js`, copy to IIFE with #179
- Collapsed card default: sorted by `grossProfit × min(roi/baseROI, 1.0)`. baseROI = 2.
- PAGE_MODE: 'market' = full panel + DOM, 'background' = silent poll only (added v1.38.0)
- MutationObserver on imarket listings for real-time detection (zero API cost)
- PDA native notification bridge on new snipe from any page
- Logging: pending queue + Quick Log strip + Batch Entry form

## Pure functions (in `test-snipe-engine.js` — copy into IIFE when integrating)

| Function | Needed for |
|----------|-----------|
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | #176 |
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | #179 |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | #179 |
| `calcWeightedScore(grossProfit, roi, baseROI)` | #181 |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | #180 |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | #177 |

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
