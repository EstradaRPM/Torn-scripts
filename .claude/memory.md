# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-28 (snipe tracker v2 PRD filed as issue #173)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.37.1` (current on main)
**Status:** PRD filed — implementation not started

**Next session:** Run `/to-issues 173` to break PRD into implementation tickets, then implement ticket by ticket using `/tdd` for pure function logic layer and manual PDA testing for UI/DOM layer.

---

## Snipe Tracker v2 — PRD Summary (issue #173)

Full PRD: https://github.com/EstradaRPM/Torn-scripts/issues/173

### Core changes

- **Smart sell position** replaces P50 as sell target and snipe detection anchor — volume-block anchored, trend-adjusted, driven by vault capital
- **Volume block** = first price tier where `price × qty ≥ % of available capital` (dynamic, not static unit count)
- **Available capital** = `vault_amount × (1 − vaultFloorPct/100)` from `user/?selections=money` API — default floor 10%
- **Mug scenario** on projection: `sellTarget × qty × (1 − mugPct/100) − buyPrice × qty` — default mugPct = 15, shown when sale value is large relative to capital
- **Weighted sort score** = `grossProfit × min(roi / baseROI, 1.0)` — cards sorted descending, display shows gross profit $
- **Collapsed card default** — one row: `[STATUS ●NEW] Name   ×qty @ $price   +$profit   ↑trend`
- **@match `torn.com/*`** — two modes: full panel on market pages, silent poll loop on all others
- **MutationObserver** on imarket listings — real-time detection, zero API cost
- **PDA native notification** on new snipe from any page
- **Pending queue + Quick Log strip + Batch Entry** — decoupled logging for rapid sessions
- **Snipe frequency** ("N snipes / 7d") from existing snapshots — watchlist curation signal
- **Ledger fixes**: At Risk vs Total Deployed, weighted ROI, win rate, per-item breakdown, live open estimate, date column

### New pure functions (all get Node tests in `test-snipe-engine.js`)

| Function | Purpose |
|----------|---------|
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | First qualifying price tier |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | Volume-block anchored sell target |
| `calcWeightedScore(grossProfit, roi, baseROI)` | Sort score |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | Worst-case mugged net |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | 7d crossing count |
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | Vault × (1 − floor%) |

### Ubiquitous language (locked across all scripts)

- **Bazaar**: 0% fee, always
- **Item market**: 5% fee standard; +10% anonymous = 15% total
- **Mug %**: 15% default (Merits + practical Plunder ceiling)
- **Smart sell position**: gap between floor chaff and first meaningful volume block, trend-adjusted

---

## RW Auction Advisor — PARKED

**File:** `torn-rw-auction-advisor-v1.user.js`
**Version:** `1.33.1` (current on main, fully shipped)
**Status:** Parked — do not touch until snipe tracker work is complete

### What shipped

- PR #171 — pricing engine redesign (v1.33.0): deleted `classifyListing`/`interpolateGapPrice`, added `isNearBase`, `isFloorPositioned`, `findNearestComp`, `calcSuggestedBid`, `addBidNoise`, `calcNonFloorMaxBid`, `calcProfitMatrix`
- PR #172 — regression fix: `buildCompsPanel` refPrice anchor (v1.33.1)

### Next when returning

**Ledger UI overhaul** — must do a dedicated `/grill-me` session before implementing. Do not design or implement ledger changes without it.

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
