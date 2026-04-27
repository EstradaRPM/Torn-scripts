# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (PRD filed; ready to begin v1.29.0)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/clever-heyrovsky-8ce863` (current worktree)
**Version:** `1.28.3` (live on main)

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

---

## Key Decisions Made This Session

### PRD filed as GitHub issue #158
Full PRD at `docs/prd-steps-i-through-l.md` and https://github.com/EstradaRPM/Torn-scripts/issues/158

### Dynamic pricing algorithm (replaces hardcoded Steps I + J)

The grill-me session fundamentally changed the approach. No hardcoded quality/bonus thresholds. Classification is fully dynamic from live comp data.

**The algorithm:**
1. Fetch all comps (item market + bazaar) for this piece type
2. Sort by price ascending, detect **floor cluster** — listings within 10–15% of cheapest
3. Identify **best piece in floor cluster** (highest qualityPct AND bonusPct available at floor)
4. Classify current listing:

| Scenario | Classification |
|----------|---------------|
| quality AND bonus ≤ floor cluster best | `floor` — quick flip |
| beats floor cluster, comps exist above | `hq` — Step H median comp pricing |
| beats floor cluster, no close comps above | `gap` — interpolate toward floor anchor (~25–30%) |
| fewer than 3 comps total | `sparse` — show comps, no auto recommendation |
| max offer > 2× BB floor | any tier — add ⚠ 2× BB warning badge |

**Floor flip display:**
- Shows bazaar net and market net separately
- Max bid = `floor_price − minFloorProfit` (one setting, pre-fee, absolute $)
- Mug buffer defaults 0% for floor flips (open question, flagged)
- Target profit % ignored entirely for floor pieces

**Exceptional tier:** Not a separate formula — HQ logic + 2× BB warning badge only

**Gap interpolation:** Lean 25–30% toward floor anchor (not midpoint). Validated by real trading: gap pieces priced close to floor sell faster than midpoint-priced ones.

### New setting: Min floor profit
Single absolute dollar amount (e.g. $5M). Stored as `KEYS.MIN_FLOOR_PROFIT`. Appears in settings modal alongside existing profit % and mug buffer.

### Ubiquitous language glossary
Written to `UBIQUITOUS_LANGUAGE.md`. Defer standardisation cleanup until after Step J (v1.30.0) lands — new pricing code will introduce base/HQ/exceptional tier terms naturally.

### Tooling setup this session
- `gh` CLI installed and authenticated (HTTPS, GitHub.com)
- PATH updated: `C:\Program Files\GitHub CLI` added to User PATH
- All 21 mattpocock/skills installed globally (~/.agents/skills/) and locally
- `engineering-principles` skill created at ~/.agents/skills/engineering-principles/
- `UBIQUITOUS_LANGUAGE.md` written to repo root

---

## New Pure Function Modules (to be built in v1.29.0–v1.30.0)

| Function | Signature | Priority |
|----------|-----------|----------|
| `detectFloorCluster(comps)` | `→ { floorPrice, bestQualityPct, bestBonusPct, clusterSize, isValid }` | Highest — root of algorithm |
| `classifyListing(listing, floorCluster)` | `→ 'floor' \| 'gap' \| 'hq' \| 'sparse'` | High |
| `interpolateGapPrice(listing, floorAnchor, premiumAnchor)` | `→ suggestedResalePrice` | Medium |
| `calcFloorFlipMaxBid(floorPrice, minFloorProfit, marketFee)` | `→ { maxBid, bazaarNet, marketNet }` | Medium |

---

## Concrete Next Steps

### v1.29.0 — Dynamic floor flip (next session)
- New setting: `Min floor profit` in settings modal + `KEYS.MIN_FLOOR_PROFIT`
- `detectFloorCluster(comps)` pure function
- `classifyListing(listing, floorCluster)` pure function
- `calcFloorFlipMaxBid(floorPrice, minFloorProfit, marketFee)` pure function
- `interpolateGapPrice(listing, floorAnchor, premiumAnchor)` pure function
- `computeListingMetrics(l)` — branch on classification for floor and gap cases
- `buildContextPanel(listing)` — floor flip display (bazaar net + market net + max bid)
- Advisory strip — show floor flip label; hide target margin for floor pieces
- Mug buffer: default 0% for floor flip path

### v1.30.0 — HQ + exceptional integration
- `classifyListing` hq branch → hand off to existing Step H comp panel ref price
- 2× BB warning badge on strip when maxOffer > 2× bbFloor
- Sparse market badge + comp display with no auto recommendation
- Context panel: show both item market and bazaar max offers for HQ pieces

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

## Key Function Locations (v1.28.3)

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `RE_QUALITY` / `RE_ARMOR` | ~820 | Confirmed live DOM format |
| `computeListingMetrics(l)` | ~1480 | Central pricing calculator — to be branched |
| `injectAdvisoryStrip(listing)` | ~1518 | Builds strip; to receive floor/gap/hq label |
| `buildContextPanel(listing)` | ~1592 | To receive floor flip display |
| `buildCompsPanel(listing)` | ~1650 | Already has Step H median-window logic |
| `enrichListingsFromMarketData()` | ~2098 | Calls comp fetches; floor cluster detection goes here |
| `logListing(listing)` | ~1733 | Snapshot schema — manual entry must match |
| `renderLedger()` | ~1750 | To receive column toggle + P&L redesign |
| `init()` | ~2215 | Main pipeline |
| `safeInit()` | ~2260 | MutationObserver debounce |

---

## Open Questions

- Mug buffer for floor flips: community doesn't appear to price it in at $80–125M floor prices. Default 0%, add toggle later.
- Exact cluster tightness parameter (10–15%) — may need tuning after seeing live data through the algorithm.
- `gh` CLI only available in PowerShell currently; restart terminal to get it in Bash.
