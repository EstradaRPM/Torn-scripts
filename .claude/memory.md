# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-28 (v1.32.0 merged to main, PRD Steps I–L complete)_

---

## Current WIP

Nothing in progress. All PRD steps (I through L) are merged to main at v1.32.0.

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `main`
**Version:** `1.32.0`

### Completed steps

| Step | Description | Version |
|------|-------------|---------|
| 1 | Inline advisory strip | 1.17.0 |
| 2 | `▼ Details` expandable context panel | 1.18.0 |
| 3 | Market/Bazaar split-column comp panel | 1.19.0 |
| 4 | Settings modal polish | 1.20.0 |
| 5 | Ledger framework scaffold | 1.21.0 |
| 6 | CLAUDE.md documentation + memory.md | 1.21.1 |
| A | Result capture dropdown | 1.22.0 |
| B | P&L — actualSellPrice input, actualNet computed | 1.23.0 |
| C | CSV export | 1.24.0 |
| D | Filter bar | 1.25.0 |
| E | Summary stats bar | 1.26.0 |
| F | Quality debug: RE_QUALITY/RE_ARMOR fixed for live DOM | 1.26.1–1.26.4 |
| G | Settings persistence fix | 1.27.0 |
| H1–H5 | Comp panel: median-window, THIS row, price-sorted, dual markers, price-window | 1.27.1–1.28.3 |
| I | Dynamic floor pricing: detectFloorCluster, classifyListing, floor flip display, gap interpolation, min floor profit setting | 1.29.0 |
| J | HQ + sparse UI badges: Sparse badge on strip, 2×BB warning badge, hq 'comp' source label, sparse context panel note row | 1.30.0 |
| K | Manual ledger entry form: buildAddEntryForm, openAddEntryForm, buildManualEntry, submitAddEntryForm | 1.31.0 |
| L | Ledger UI/UX overhaul: z-index fix, BB Floor + Ref Price columns, column visibility toggle, P&L formula fix, Net P&L alignment | 1.32.0 |

---

## Key Decisions Made (v1.32.0)

### Step L — display + formula fixes only, no algorithm changes

- **Z-index**: `#rwa-ledger-panel` raised from 9000 to 10000 to clear Torn navigation.
- **BB Floor + Ref Price columns**: added to ledger table; hidden by default as secondary columns.
- **Column visibility toggle**: "Show more ▾" / "Show less ▴" button in ledger header. Secondary columns = Score, BB Floor, Ref Price, ROI. Preference stored in `MEM.ledgerShowMore` (session-only, not persisted).
- **P&L formula**: `actualNet = actualSellPrice − currentBid`. No fee, no mug buffer. Both `commitSellPrice` and `buildManualEntry` use this formula. Mug buffer and market fee belong only in the advisory strip / context panel (max offer, target margin calculations) — never in post-trade ledger accounting.
- **Net P&L column**: `min-width: 96px; text-align: right` via `.rwa-col-net` class.

### Ledger P&L is strictly sell minus bid

This is a hard rule. The ledger records completed trades. `actualNet = actualSellPrice - currentBid`. No automatic fee deductions, no mug buffer. If the user enters a sell price, it is what they received. The net is received minus paid.

### BB rate is NOT a user setting

`MEM.bbRate` is auto-calculated by `fetchBBRate()` from the weighted average of the 5 combat cache market prices. `KEYS.BB_RATE` is where the computed value persists — not a user input field.

---

## Key Function Locations (v1.32.0)

| Symbol | Line | Notes |
|--------|------|-------|
| `detectFloorCluster` | 403 | Pure function |
| `classifyListing` | 435 | Pure function |
| `calcFloorFlipMaxBid` | 470 | Pure function |
| `interpolateGapPrice` | 487 | Pure function |
| `fetchBBRate()` | 852 | Auto-calculates $/BB from cache market prices |
| `commitSellPrice` | 1592 | actualNet = raw − currentBid (no fee/mug) |
| `computeListingMetrics(l)` | 1700 | Branches on classification; returns bbFloor |
| `injectAdvisoryStrip(listing)` | 1765 | Sparse + 2×BB badges |
| `buildContextPanel(listing)` | 1880 | Sparse note row + hq srcLabel override |
| `logListing(listing)` | 2160 | Snapshot schema |
| `buildAddEntryForm()` | 2235 | Manual entry form HTML |
| `renderLedger()` | 2362 | Full re-render; syncs Show more toggle label |
| `buildNormalizedComps` | 2657 | Helper for all-comps normalization |
| `enrichListingsFromMarketData()` | 2706 | Sets floorCluster + classification on each listing |
| `init()` | 2846 | Main pipeline |

---

## Concrete Next Steps

PRD Steps I–L are complete. No next step is defined. Next session should start by reviewing live usage feedback before planning further iterations.

---

## Open Questions

- Cluster tightness (12% used): may need tuning after seeing live data. Easy to adjust — change the default parameter in `detectFloorCluster`.
- Gap "near premium" thresholds (20pp quality, 4pp bonus): empirical — watch for mis-classifications on live listings.
- Mug buffer for floor flips: hardcoded 0% in `calcFloorFlipMaxBid`. Consider adding a per-path toggle later if community feedback suggests it.

---

## PRD Reference

Full PRD at `docs/prd-steps-i-through-l.md` and https://github.com/EstradaRPM/Torn-scripts/issues/158
