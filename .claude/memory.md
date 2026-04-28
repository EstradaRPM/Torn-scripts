# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (v1.29.0 implemented, PR pending)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/nifty-yalow-f26e10` (current worktree)
**Version:** `1.29.0` (implemented this session, not yet merged to main)

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

---

## Key Decisions Made This Session (v1.29.0)

### Algorithm implemented as PRD specified

- **`detectFloorCluster(comps, threshold=0.12)`** — pure function. Cluster = listings within 12% of cheapest. Returns `{ floorPrice, bestQualityPct, bestBonusPct, clusterSize, isValid }`. `isValid` = clusterSize >= 3.

- **`classifyListing(listing, floorCluster, allComps)`** — pure function. Returns 'floor'|'gap'|'hq'|'sparse'. Gap = beats floor cluster but no premium comps within 20pp quality / 4pp bonus. HQ = beats floor and near premium comps exist.

- **`calcFloorFlipMaxBid(floorPrice, minFloorProfit, marketFee)`** — pure function. `maxBid = floorPrice - minFloorProfit`. `bazaarNet = minFloorProfit` (no fee). `marketNet = round(floorPrice * 0.95) - maxBid`.

- **`interpolateGapPrice(floorAnchor, premiumAnchor, lean=0.27)`** — pure function. Leans 27% toward floor anchor (not midpoint). Fallback premiumAnchor = `floorPrice * 2.0` when no premium comps exist.

- **`buildNormalizedComps(listing)`** — helper. Gathers all raw item-market + W3B comps for this item (by itemId), normalized to `{ price, qualityPct, bonusPct }`. Called early in `enrichListingsFromMarketData` loop before the `continue` check.

### Classification stored on listing

`enrichListingsFromMarketData` now sets:
- `listing.floorCluster` — full cluster object (even when `isValid=false`)
- `listing.classification` — 'floor'|'gap'|'hq'|'sparse'
- `listing.gapPremiumAnchor` — cheapest comp above floor cluster (null for non-gap)

The floor cluster detection runs BEFORE the `continue` (no-comps) check so every listing gets classified.

### computeListingMetrics branching

- `classification === 'floor'` → `calcFloorFlipMaxBid`, returns `bazaarNet` + `marketNet`, `roi: null`, skips target profit % and mug buffer
- `classification === 'gap'` → `interpolateGapPrice` overrides `refPrice`, then existing `calcMaxOffer` formula
- `hq` / `sparse` / null → existing formula unchanged

### UI changes

- `injectAdvisoryStrip`: label changes to "Max Bid (Floor)" / "Max Bid (Est.)" / "Max Offer" per classification. ROI% hidden for floor pieces.
- `buildContextPanel`: floor shows "Floor Price" + "Bazaar Net" + "Market Net" rows; King's cap hidden. Gap shows "Est. Price" badge instead of comp source badge.
- Settings modal: new "Min floor profit ($M)" field added between mug buffer and sell-via-trade. Stored in `KEYS.MIN_FLOOR_PROFIT`, default $5M.

---

## Key Function Locations (v1.29.0)

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `RE_QUALITY` / `RE_ARMOR` | ~900 | Confirmed live DOM format |
| `detectFloorCluster` | ~400 | Pure function — root of dynamic algorithm |
| `classifyListing` | ~432 | Pure function |
| `calcFloorFlipMaxBid` | ~467 | Pure function |
| `interpolateGapPrice` | ~484 | Pure function |
| `buildNormalizedComps` | ~2434 | Helper for all-comps normalization |
| `computeListingMetrics(l)` | ~1631 | Branches on classification |
| `injectAdvisoryStrip(listing)` | ~1696 | Label + ROI conditional |
| `buildContextPanel(listing)` | ~1800 | Floor/gap branched display |
| `enrichListingsFromMarketData()` | ~2478 | Sets floorCluster + classification on each listing |
| `logListing(listing)` | ~2090 | Snapshot schema — unchanged |
| `renderLedger()` | ~2100 | Unchanged |
| `init()` | ~2620 | Main pipeline |

---

## Concrete Next Steps

### v1.30.0 — HQ + exceptional integration
- `classifyListing` hq branch → hand off to existing Step H comp panel ref price (already works via existing formula, but needs explicit label/badge)
- 2× BB warning badge on strip when `maxOffer > 2 × bbFloor`
- Sparse market badge on strip ("Sparse") + comp display with no auto recommendation
- Context panel for HQ: note it uses median comp pricing (existing)

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
- `gh` CLI: only available in PowerShell currently; restart terminal to get it in Bash.

---

## PRD Reference

Full PRD at `docs/prd-steps-i-through-l.md` and https://github.com/EstradaRPM/Torn-scripts/issues/158
