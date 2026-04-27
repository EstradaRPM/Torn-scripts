# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (quality debug complete at v1.26.4; future steps planned)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/debug-quality-calculation-EcLlp`
**Version:** `1.26.4`

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
| **F** | **Quality debug: fixed RE_QUALITY/RE_ARMOR for actual Torn DOM format; armor-stat regression estimator; lazy-load retry on Details click** | **1.26.1–1.26.4** |

### Quality debug summary (v1.26.1–1.26.4)

Four bugs found and fixed across this debugging session:

1. **v1.26.1** — `RE_QUALITY` used `[:\s]+` (one-or-more separator) but Torn omits any separator. Changed to `[:\s]*`. Removed misleading `listing.qualityPct = avgQuality` fallback that was corrupting display and silently rerouting pricing through the wrong branch.
2. **v1.26.2** — Added `armorStat` parsing + `estimateQualityFromArmorStat()` OLS regression using item market comp (armor, quality) pairs as a fallback when DOM quality is absent.
3. **v1.26.3** — Added extended title-attribute scan and data-attribute checks; added Details-click re-check for lazy-loaded stats; added one-time console DOM dump to identify actual format.
4. **v1.26.4** — Console dump revealed the true DOM format: quality is `Q 12.8%` (single letter Q + space) not `Quality: X%`; armor stat is a bare decimal `45.64` with no label. Updated both regexes accordingly. Removed debug logging.

**Actual Torn DOM format confirmed:**
- Quality: `Q 12.8%` → `RE_QUALITY = /(?:[Qq]uality[:\s]*|\bQ\s+)([0-9]+(?:\.[0-9]+)?)\s*%/`
- Armor stat: `45.64` (bare decimal, no label) → `RE_ARMOR = /\b([1-9][0-9]+\.[0-9]+)\b(?!\s*%)/`
- Bonus: `Impregnable: 21%` (parsed from `.iconsbonuses span` title attribute — unchanged)

### Key function locations

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `RE_QUALITY` / `RE_ARMOR` | ~820 | Regexes for DOM parsing; formats confirmed from live DOM dump |
| `extractQualityFrom(text)` | ~888 | Inner fn in parseAuctionListings; applies RE_QUALITY |
| `extractArmorFrom(text)` | ~891 | Inner fn in parseAuctionListings; applies RE_ARMOR |
| `estimateQualityFromArmorStat()` | ~2061 | OLS linear regression over comp (armor, quality) pairs |
| `computeListingMetrics(l)` | ~1480 | Returns bbFloor, maxOffer, netProfit, roi, signalColor |
| `injectAdvisoryStrip(listing)` | ~1518 | Builds `.rwa-strip`, wires all 4 buttons; Details click re-checks quality |
| `buildContextPanel(listing)` | ~1592 | Returns `.rwa-context` div; shows `Q~X%` for estimated quality |
| `buildCompsPanel(listing)` | ~1650 | Returns `.rwa-comps` 2-column panel |
| `enrichListingsFromMarketData()` | ~2098 | Estimates quality from armor stat before tier/comp calls |
| `logListing(listing)` | ~1733 | Snapshots listing into MEM.ledger |
| `renderLedger()` | ~1750 | Rebuilds ledger table |
| `init()` | ~2215 | Main pipeline: parse → BB rate → comps → enrich → render |
| `safeInit()` | ~2260 | MutationObserver debounce, 30s cooldown |

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Native `<dialog>` for settings modal | Handles Escape + backdrop automatically |
| `computeListingMetrics()` as standalone helper | Reused by strip, context panel, log snapshot — no duplicated pricing logic |
| Function declarations (not const arrows) for render/build fns | Hoisted within IIFE — safe to reference from event handlers defined earlier |
| `buildCompsPanel._refreshCol()` / `._isStale()` as panel-attached methods | Keeps fetch logic co-located with the panel it modifies |
| Delegated `change` listener on `ledgerBody` for result select | Container persists across `innerHTML` resets |
| `sel.value || null` for result storage | Empty string (—) stored as null for consistent `!e.result` checks |
| In-place `data-anet-id` span update on sell price commit | Preserves scroll position; full re-render only on result dropdown change |
| Quality estimation via OLS regression on (armor, quality) comp pairs | Auction house API doesn't return stats; DOM quality confirmed available directly with correct regex |
| `qualityEstimated = true` flag + `Q~X%` display | Visually distinguishes estimated quality from DOM-read quality |
| Details-click re-check for quality | Torn may lazy-load stats after page load; this catches them on first natural user interaction |

---

## Open Questions / Blockers

- Confirm whether bonus "tier increments" are always 3% steps in Torn (affects Step I pricing logic thresholds).
- Confirm whether the OLS quality estimate is accurate enough in practice, or if the regex fix alone handles all cases.

---

## Concrete Next Steps

Each step below corresponds to one session with user confirmation before starting.
All changes go in `torn-rw-auction-advisor-v1.user.js`. Increment minor version per step.

---

### Step G — Settings persistence fix (version → 1.27.0)

**Problem:** Mug % and profit % settings reset more often than expected.

**Investigation needed first:**
- Audit `Store.get` / `Store.set` calls for `KEYS.MUG_BUFFER` and `KEYS.TARGET_PROFIT` — check whether settings are read on every `init()` call, potentially overwriting the in-memory `MEM.settings` object with stale defaults.
- Check if `applySettings()` or similar is called in a path that could re-read from `localStorage` and overwrite values the user has changed but not saved.
- Check if the settings modal's "Save" path and the "on input" path both persist — if only one does, the other discards changes on page reload.

**Fix:** Ensure settings are written to `localStorage` immediately on input change (not only on modal close), and that `MEM.settings` is only initialised from `localStorage` once at startup — never overwritten by a later `init()` call.

---

### Step H — Comp panel median positioning (version → 1.28.0)

**Goal:** Reorder/annotate the Market and Bazaar top-5 comp lists so the auction listing's own quality and bonus sit at the natural median of the displayed range, giving a clearer picture of where the piece falls and what the price target should be.

**Specifics:**
- In `imRows()` and `w3bRows()` inside `buildCompsPanel`, currently the 5 cheapest bonus-matched listings are shown sorted by price. Change the selection strategy so that the listing's own `qualityPct` and `bonusPct` are centred in the shown window: pick the 2 comps immediately below and 2 immediately above in quality (within bonus tolerance), plus the listing itself as a reference row (visually distinguished — e.g. highlighted or labelled "THIS").
- If fewer than 2 comps exist on one side, fill from the other to maintain 5 rows.
- **Outlier handling:** pieces where quality and bonus are in opposite extremes (high quality + low bonus, or low quality + high bonus) must be positioned using whichever axis creates the more accurate resale price anchor. High bonus is more valuable than high quality as a general rule; use bonus proximity as the primary sort key, quality as secondary.
- The display should visually surface whether the listing is cheap/mid/expensive relative to its peers, not just show the 5 cheapest.

---

### Step I — Base-tier pricing: undercut-based profit target (version → 1.29.0)

**Applies to:** Pieces classified as base tier — quality < 25% AND bonus ≤ baseBonusPct + 3% (approximately; confirm exact Torn tier boundary before implementing).

**Current behaviour:** Uses a static profit % target against comp price regardless of tier.

**New behaviour for base-tier pieces:**
- Remove the static profit-% formula from `calcMaxOffer` for these pieces.
- Instead compute: `lowestAvailablePrice` = min(lowest item market listing price × 0.95, lowest bazaar listing price — small undercut, e.g. $10k–$50k depending on price magnitude).
- **Max offer** = `lowestAvailablePrice − targetAbsoluteProfit` where `targetAbsoluteProfit` is derived as: `(lowestAvailablePrice × profitPctSetting / 100)` to keep it settings-driven.
- Show two profit projections in the context panel:
  - **Pre-mug profit** = `lowestAvailablePrice − currentBid` (or max offer if no bid yet).
  - **Post-mug profit** = `lowestAvailablePrice × (1 − mugBufferPct/100) − currentBid`.
  - For bazaar resale: same formulas without the 5% item-market fee.
- If the current live bid already exceeds `lowestAvailablePrice − minimumAcceptableProfit`, flag the listing as unprofitable (red, not green) regardless of max offer headroom.
- Example: bid $70.4M, lowest bazaar $74.56M, mug 10% → pre-mug profit $4.16M, post-mug profit ~$67.1M × 0.9 − $70.4M = negative → flag.

---

### Step J — HQ/exceptional-tier pricing: profit-%-driven max offer (version → 1.30.0)

**Applies to:** Pieces with quality ≥ 25% OR bonus ≥ baseBonusPct + ~3% (i.e. hq or exceptional tier).

**Goal:** Replace current King's cap + bonus-only refPrice logic for these tiers with a formula that correctly solves for maximum auction bid given a target profit margin and the median market resale price from Step H.

**Formulas (solve for A = max amount to pay at auction):**

Item market resale path:
```
(((S × 0.95) × M) − A) / A ≥ P
⟹  A ≤ (S × 0.95 × M) / (1 + P)
```
where S = estimated resale price (median comp from Step H), M = 1 − mugBufferPct/100, P = targetProfitPct/100.

Bazaar resale path (no market fee):
```
((S × M) − A) / A ≥ P
⟹  A ≤ (S × M) / (1 + P)
```

**Max offer** = min of the two solved A values (most conservative).

**BB floor guard:** Keep existing BB floor as absolute floor — max offer ≥ bbFloor for Riot/Dune sets.

**2× BB warning:** If the computed max offer > 2 × bbFloor, display an amber warning badge on the strip ("⚠ manual research") — this signals the piece may be exceptional enough that formula pricing could undervalue it, or that comp data is thin.

**Display:** Show both item-market and bazaar projected max offers in the context panel so the user can choose which channel they intend to sell through.

---

### Step K — Manual ledger entry (version → 1.31.0)

**Goal:** Allow the user to add a ledger row without logging it from a live auction listing (e.g. to record a past purchase, correct a missed log, or add off-platform data).

**UI:** Add an "+ Add Entry" button in the ledger header (next to "Copy CSV"). Clicking it opens a small inline form above the ledger table with fields:
- Item name (text input or dropdown of known armor piece names)
- Rarity (dropdown: yellow / orange / red)
- Quality % (number input, optional)
- Bonus % (number input, optional)
- Bid paid / purchase price (number input, required)
- Max offer at time (number input, optional)
- Result (dropdown: —/Won/Lost/Passed, default Won since this is a manual entry)
- Actual sell price (number input, optional — unlocked only when result = Won)

On submit: create a ledger entry with the same schema as `logListing()`, assign `id = Date.now()`, persist to `localStorage`, call `renderLedger()`. Validate that bid price is a positive integer before accepting.

---

### Step L — Ledger UI/UX overhaul (version → 1.32.0)

**Goal:** Fix multiple layout and usability issues with the ledger sidebar.

**Sub-tasks (all in one version bump):**

1. **Panel z-index / position conflict with Torn nav:** The ledger panel is covered by Torn's top-right navigation buttons. Investigate the stacking context. Either increase `#rwa-ledger-panel` z-index above Torn's nav, or shift the panel left/down so it doesn't overlap the nav area. Test on a full-width browser window.

2. **Column spacing:** Table columns are too cramped. Audit the `<table>` CSS in the injected `<style>` block. Add `min-width` constraints to the most important columns (Date, Item, Bid, Max Offer, Result, Net) and allow less important columns (Score, ROI%, BB Floor, Ref Price) to be hidden by default behind a "Show more columns" toggle to reduce clutter.

3. **P&L input redesign:** The current "Actual sell price" input with automatic mug deduction is confusing. Replace with two mutually exclusive modes selectable per entry via a small toggle:
   - **Gross sell mode** (default): User enters the raw sale price; script automatically deducts the market fee (5% if item market, 0% if bazaar) and the mug buffer % from `MEM.settings`. Show the deductions explicitly as separate line items in the net profit tooltip.
   - **Net received mode**: User enters exactly what they received after all deductions (fees + mug already subtracted). No automatic deductions applied. Label clearly as "Net received".
   - Alternatively (simpler): keep a single input but add a separate optional "Mug loss" input field. Actual net = sell price − market fee − mug loss input. This keeps the math transparent without requiring mode switching.

4. **Net profit display alignment:** Ensure the net profit span and its associated input are vertically aligned within the cell and consistent across all Won rows.

---

## Memory System Protocol

After every committed step, update this file before the user approves the next step.
Required sections: Current WIP, Key Decisions, Open Questions, Concrete Next Steps.
Update the `_Last updated_` date at the top.
