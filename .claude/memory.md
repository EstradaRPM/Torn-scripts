# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (Steps G + H complete at v1.28.3; H5 comp panel unconfirmed; Steps I–L pending)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/plan-auction-tool-steps-U6EB4`
**Version:** `1.28.3`

### Completed steps

| Step | Description | Version |
|------|-------------|---------|
| 1 | Inline advisory strip | 1.17.0 |
| 2 | `▼ Details` expandable context panel | 1.18.0 |
| 3 | Market/Bazaar split-column comp panel | 1.19.0 |
| 4 | Settings modal polish | 1.20.0 |
| 5 | Ledger framework scaffold | 1.21.0 |
| 6 | CLAUDE.md documentation + memory.md | 1.21.1 |
| A | Result capture dropdown — —/Won/Lost/Passed per row | 1.22.0 |
| B | P&L — actualSellPrice input (Won rows only), actualNet computed on blur/Enter, in-place span update | 1.23.0 |
| C | CSV export — "Copy CSV" button in ledger header; RFC-4180, all 14 columns; "Copied!"/"Failed" flash | 1.24.0 |
| D | Filter bar above ledger table: Set/Rarity/Outcome/Date-range; `ledgerFilter` object; applied in renderLedger() | 1.25.0 |
| E | Summary stats bar: Entries, Win Rate, Avg ROI, Total P&L; `buildSummaryBar()`; above filter bar | 1.26.0 |
| F | Quality debug: fixed RE_QUALITY/RE_ARMOR for actual Torn DOM format; armor-stat regression estimator; lazy-load retry on Details click | 1.26.1–1.26.4 |
| G | Settings persistence fix: `parseFloat(...) \|\| default` → `parseNum(str, def)` using `isNaN`; fixes mug buffer resetting to 10 when stored as 0 | 1.27.0 |
| H1 | Comp panel: `pickWindow` helper + CSS `.rwa-comps-row--this` + both columns updated | 1.27.1 |
| H2 | Comp panel: edge-case polish — `~Q%` tilde for estimated quality, no-bonus-match fallback, `renderCompRows` shared helper | 1.28.0 |
| H3 | Comp panel: sort by price ASC; THIS row anchored at `refPrice` (estimated sell) | 1.28.1 |
| H4 | Comp panel: dual bid/sell markers — `↓ bid` (amber) at `currentBid`, `↑ sell` (green) at `refPrice`; merged into price-sorted list | 1.28.2 |
| **H5** | **Comp panel: replaced `pickWindow` (quality-centred) with `priceWindow` (price-centred around refPrice) — UNCONFIRMED by user** | **1.28.3** |

### H5 status — PENDING USER CONFIRMATION

H5 replaced the quality-window algorithm with a simpler price-window:
- Filter comps by bonus match (±bonusMatchRange)
- Exclude the refPrice comp itself (shown via ↑ sell marker)
- Take 2 comps **below** refPrice (closest from below = your undercut threats)
- Take 2 comps **above** refPrice (cheapest above = buyer's alternatives)
- Fill from opposite side when fewer than 2 exist on one side

**User has NOT confirmed this produces correct output.** Before moving to Step I, verify the comp panel looks correct on live data and the ↑ sell / ↓ bid markers are positioned sensibly.

If H5 is still wrong, the most likely remaining issue is that `refPrice` itself may be stale or computed from a different matching pass than the comps being shown (the two filtering paths — `getItemMarketComp` for refPrice vs the inline bonus filter in `imRows`/`w3bRows` for the comp window — may diverge). If so, align both to use the same filtering logic.

---

### Key function locations (v1.28.3 approximate lines)

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `parseNum(str, def)` | ~44 | Safe numeric loader replacing `\|\|` fallback |
| `RE_QUALITY` / `RE_ARMOR` | ~830 | DOM parsing regexes; confirmed format from live dump |
| `getItemMarketComp()` | ~609 | Returns refPrice for a listing; filters by bonus then quality |
| `getTornW3BComp()` | ~686 | Same but for bazaar comps |
| `computeListingMetrics(l)` | ~1530 | Returns bbFloor, maxOffer, netProfit, roi, signalColor |
| `injectAdvisoryStrip(listing)` | ~1570 | Builds `.rwa-strip`, wires all 4 buttons |
| `buildContextPanel(listing)` | ~1670 | Returns `.rwa-context` div |
| `priceWindow(comps, refPrice)` | ~1726 | Selects 2 below + 2 above refPrice from bonus-matched comps |
| `buildCompsPanel(listing)` | ~1750 | Returns `.rwa-comps` 2-column panel |
| `renderCompRows(items, ...)` | ~1780 | Merges bid/sell markers into price-sorted comp rows |
| `enrichListingsFromMarketData()` | ~2250 | Sets listing.refPrice, listing.tier, estimates quality |
| `init()` | ~2300 | Main pipeline: parse → BB rate → comps → enrich → render |

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Native `<dialog>` for settings modal | Handles Escape + backdrop automatically |
| `computeListingMetrics()` as standalone helper | Reused by strip, context panel, log snapshot — no duplicated pricing logic |
| `parseNum(str, def)` instead of `\|\| default` | `parseFloat("0") \|\| 10` would reset saved 0 values to default on reload |
| Price-window (not quality-window) for comp selection | User's decision is price-driven; quality-centred selection produced non-monotone prices and hidden duplicates |
| `↓ bid` / `↑ sell` dual markers in comp panel | Makes buy/sell spread immediately readable; bid above sell = overpaying |
| Exclude refPrice comp from window | It's already shown via the ↑ sell marker; showing it again creates a visual duplicate |
| `refPrice` = cheapest quality+bonus matched comp | Conservative baseline; user must undercut it to sell, so it's the correct floor |
| `qualityEstimated = true` flag + `~Q%` display | Visually distinguishes regression-estimated quality from DOM-read quality |

---

## Open Questions / Blockers

- **H5 unconfirmed** — user has not verified the `priceWindow` comp panel output looks correct on live data. Resolve before Step I.
- Confirm whether bonus "tier increments" are always 3% steps in Torn (affects Step I pricing thresholds).
- Confirm whether the OLS quality estimate is accurate enough in practice (only matters if RE_QUALITY still misses some DOM formats).

---

## Concrete Next Steps

All changes go in `torn-rw-auction-advisor-v1.user.js` on branch `claude/plan-auction-tool-steps-U6EB4`.

---

### Step I — Base-tier pricing: undercut-based profit target (version → 1.29.0)

**Prerequisite:** H5 confirmed by user.

**Applies to:** Pieces classified as base tier — quality < 25% AND bonus ≤ baseBonusPct + 3% (confirm exact boundary before implementing).

**Current behaviour:** Static profit-% formula against refPrice regardless of tier.

**New behaviour for base-tier pieces:**
- `lowestAvailablePrice` = min(lowest bonus-matched item market price × 0.95, lowest bonus-matched bazaar price with small undercut)
- `maxOffer` = `lowestAvailablePrice × (1 − profitPctSetting/100)`
- Show two profit projections in context panel:
  - Pre-mug profit = `lowestAvailablePrice − currentBid`
  - Post-mug profit = `lowestAvailablePrice × (1 − mugBufferPct/100) − currentBid`
  - Both for item market (−5% fee) and bazaar (no fee)
- Flag red if current bid already exceeds `lowestAvailablePrice − minimumAcceptableProfit`

---

### Step J — HQ/exceptional-tier pricing: profit-%-driven max offer (version → 1.30.0)

**Applies to:** Pieces with quality ≥ 25% OR bonus ≥ baseBonusPct + ~3%.

**Goal:** Solve max bid algebraically given target profit margin and estimated resale price.

**Formulas (A = max bid, S = estimated resale, M = 1 − mugBuffer, P = targetProfitPct/100):**

Item market path: `A ≤ (S × 0.95 × M) / (1 + P)`
Bazaar path: `A ≤ (S × M) / (1 + P)`
Max offer = min of both (most conservative). BB floor guard remains.

Amber warning badge if max offer > 2× BB floor ("⚠ manual research").
Show both channel projections in context panel.

---

### Step K — Manual ledger entry (version → 1.31.0)

Add "+ Add Entry" button in ledger header. Clicking opens inline form with: item name, rarity, quality %, bonus %, bid paid (required), max offer, result (default Won), actual sell price (unlocked when result = Won). On submit: create entry via same schema as `logListing()`, assign `id = Date.now()`, persist, re-render.

---

### Step L — Ledger UI/UX overhaul (version → 1.32.0)

1. **Z-index fix** — ledger panel covered by Torn's top-right nav; increase z-index or shift position.
2. **Column spacing** — add `min-width` to key columns; hide secondary columns (Score, ROI%, BB Floor, Ref Price) behind "Show more" toggle.
3. **P&L input redesign** — replace ambiguous "Actual sell price" input with clearer Gross/Net mode or separate "Mug loss" field so deductions are explicit.
4. **Net profit alignment** — consistent vertical alignment across all Won rows.

---

## Memory System Protocol

After every committed step, update this file before the user approves the next step.
Required sections: Current WIP, Key Decisions, Open Questions, Concrete Next Steps.
Update the `_Last updated_` date at the top.
