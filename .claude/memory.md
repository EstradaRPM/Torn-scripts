# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-28 (v1.30.0 implemented, PR #163 open)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/engineering-principles-claude-md`
**Version:** `1.30.0` (PR #163 open, not yet merged to main)

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

---

## Key Decisions Made (v1.30.0)

### Step J — display layer only, no algorithm changes

All classification data already existed on each listing from v1.29.0. Step J adds UI signals on top:

- **`injectAdvisoryStrip`**: destructures `bbFloor` from `computeListingMetrics` (was already returned, not consumed). `sparseBadgeHtml` (amber `.rwa-badge-sparse`) shown when `classification === 'sparse'`. `twoBBHtml` (orange `.rwa-badge-cap`) shown when `maxOffer > 2 × bbFloor` — classification-agnostic, fires for any piece.
- **`buildContextPanel`**: `srcLabel` overridden to `'comp'` when `classification === 'hq'` (was falling through to `'~'`). Sparse note row (`Data: Sparse`) prepended to `rows` array before BB Floor row when `classification === 'sparse'`.

### BB rate is NOT a user setting

`MEM.bbRate` is auto-calculated by `fetchBBRate()` from the weighted average of the 5 combat cache market prices. `KEYS.BB_RATE` is where the computed value persists — not a user input field. To test the 2×BB badge manually: set `MEM.bbRate.rate` to a low value in the browser console.

---

## Key Function Locations (v1.30.0)

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `RE_QUALITY` / `RE_ARMOR` | ~900 | Confirmed live DOM format |
| `detectFloorCluster` | ~400 | Pure function |
| `classifyListing` | ~432 | Pure function |
| `calcFloorFlipMaxBid` | ~467 | Pure function |
| `interpolateGapPrice` | ~484 | Pure function |
| `buildNormalizedComps` | ~2434 | Helper for all-comps normalization |
| `computeListingMetrics(l)` | ~1631 | Branches on classification; returns bbFloor |
| `injectAdvisoryStrip(listing)` | ~1696 | Sparse + 2×BB badges added here |
| `buildContextPanel(listing)` | ~1803 | Sparse note row + hq srcLabel override |
| `enrichListingsFromMarketData()` | ~2478 | Sets floorCluster + classification on each listing |
| `fetchBBRate()` | ~849 | Auto-calculates $/BB from cache market prices |
| `logListing(listing)` | ~2090 | Snapshot schema — unchanged |
| `renderLedger()` | ~2100 | Unchanged |
| `init()` | ~2620 | Main pipeline |

---

## Concrete Next Steps

### v1.31.0 — Manual ledger entry (Step K)
- `buildAddEntryForm()` inline form above ledger table
- Fields: item name, rarity, Q%, bonus%, bid (required), max offer, result, actual sell price
- Validate bid > 0; persist same schema as `logListing()`; call `renderLedger()` on submit

### v1.32.0 — Ledger UI/UX overhaul (Step L)
- Z-index fix on `#rwa-ledger-panel`
- Column visibility toggle: Score/ROI%/BB Floor/Ref Price hidden by default
- P&L: single gross sell price input; script deducts 5% fee; shows deduction explicitly
- Net P&L column: fixed-width, right-aligned

---

## Open Questions

- Cluster tightness (12% used): may need tuning after seeing live data. Easy to adjust — just change the default parameter in `detectFloorCluster`.
- Gap "near premium" thresholds (20pp quality, 4pp bonus): empirical — watch for mis-classifications on live listings.
- Mug buffer for floor flips: hardcoded 0% in `calcFloorFlipMaxBid`. Community doesn't price it in at $80–125M. Consider adding a per-path toggle later.

---

## PRD Reference

Full PRD at `docs/prd-steps-i-through-l.md` and https://github.com/EstradaRPM/Torn-scripts/issues/158
