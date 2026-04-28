# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-28 (v1.32.0 on main; pricing engine redesign PRD filed as issue #170)_

---

## Current WIP

Nothing in active development. All PRD steps (I through L) are merged to main at v1.32.0.

**Next planned work:** Pricing engine redesign (issue #170) — see PRD for full spec.

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
| J | HQ + sparse UI badges | 1.30.0 |
| K | Manual ledger entry form | 1.31.0 |
| L | Ledger UI/UX overhaul: z-index, column toggle, P&L formula fix, Net P&L alignment | 1.32.0 |

---

## Pricing Engine Redesign — Key Decisions (issue #170, not yet implemented)

Full PRD at https://github.com/EstradaRPM/Torn-scripts/issues/170

### What changes

The floor/gap/hq/sparse classification system is scrapped. Replaced by:

1. **`isNearBase(listing, armorSet)`** — `qualityPct <= 20 AND bonusPct <= baseBonusPct + 2` → floor flip path
2. **`isFloorPositioned(listing, floorCluster)`** — listing price within floor cluster range → floor flip path (flagged "market-priced at floor")
3. **`findNearestComp(listing, allComps, bonusWeight=1.0)`** — nearest comp by quality+bonus Euclidean distance; `BONUS_WEIGHT = 1.0` tunable constant
4. **`calcSuggestedBid(currentBid, maxBid, lean=0.30)`** — 30% into gap from current bid
5. **`addBidNoise(baseBid)`** — sub-million randomization: `$71M → $71,347,832`
6. **`calcNonFloorMaxBid(resalePrice, targetProfitPct, marketFee)`** — mug buffer excluded from ceiling
7. **`calcProfitMatrix(...)`** — 2×2: (suggested/max) × (bazaar/market) × (clean/mugged)

### What stays

- `detectFloorCluster()` — unchanged
- `calcFloorFlipMaxBid()` — unchanged
- `ARMOR_SCORING` — unchanged
- Ledger — untouched

### What is removed

- `classifyListing()` — deleted
- `interpolateGapPrice()` — deleted
- `classification` / `gapPremiumAnchor` fields on listing objects

### Display

Every listing gets the same layout:
- Suggested bid (re-noised on each render) + Max bid
- 2×2 profit matrix at both bid levels
- Confidence flag when comps are thin ("1 comp — low confidence" / "BB floor only")

### Test plan (node-based, same pattern as test-manual-entry.js)

Pure functions to test: `isNearBase`, `isFloorPositioned`, `findNearestComp`, `calcSuggestedBid`, `calcProfitMatrix`

---

## Deferred — Needs Own Grill Session

**Ledger UI overhaul** — user is not satisfied with the current ledger UI but it's a UI concern, not algorithmic. Must do a dedicated grill-me session before implementing. Do not design or implement ledger changes without it.

---

## Key Function Locations (v1.32.0)

| Symbol | Line | Notes |
|--------|------|-------|
| `ARMOR_SCORING` | 152 | baseBonusPct per set — source of truth |
| `detectFloorCluster` | 403 | Pure function — retained in redesign |
| `classifyListing` | 435 | TO BE DELETED in redesign |
| `calcFloorFlipMaxBid` | 470 | Pure function — retained |
| `interpolateGapPrice` | 487 | TO BE DELETED in redesign |
| `fetchBBRate()` | 852 | Auto-calculates $/BB |
| `computeListingMetrics(l)` | 1700 | Core branching — major rewrite target |
| `injectAdvisoryStrip(listing)` | 1765 | UI rewrite target |
| `buildContextPanel(listing)` | 1880 | UI rewrite target |
| `logListing(listing)` | 2160 | Unchanged |
| `buildAddEntryForm()` | 2235 | Unchanged |
| `renderLedger()` | 2362 | Unchanged |
| `enrichListingsFromMarketData()` | 2706 | Sets floorCluster — retained; classification field removed |
| `init()` | 2846 | Main pipeline |

---

## Open Questions

- `BONUS_WEIGHT = 1.0`: equal weight between quality and bonus distance. Tune after live observation.
- Floor cluster threshold (12%): keep fixed for now, tune after live data.
- Ledger UI: deferred — needs grill session.
