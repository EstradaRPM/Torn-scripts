# PRD — RW Auction Advisor: Steps I–L
# Dynamic Pricing Algorithm, Manual Ledger Entry, and Ledger UI Overhaul

> **ARCHIVE:** Historical PRD/planning artifact. Do not use this as current RW Trading Hub implementation guidance unless the user explicitly asks for historical context.

---

## Problem Statement

The RW Auction Advisor currently applies a single fixed pricing formula to every armor listing regardless of where the piece sits in the live market. A commodity floor piece — one with low quality and base bonus that dozens of sellers list at the same clustered price — is evaluated with the same target-profit formula as a premium high-quality or high-bonus piece that commands a meaningful market premium.

The result is systematically wrong recommendations: floor pieces get modelled as if they can command a margin they cannot, and premium pieces get undervalued relative to their actual resale potential because the formula uses a static discount rather than live market position.

Beyond pricing, the ledger has two gaps: there is no way to manually log a trade that wasn't captured live (a past purchase, an off-platform deal, a correction), and the layout breaks under real use — the panel collides with Torn's navigation, columns are cramped, and the P&L input behaviour is confusing.

---

## Solution

Replace the static pricing formula with a **dynamic pricing algorithm** that derives all pricing decisions from live comp data:

1. Detect the market floor cluster from live item market and bazaar comps
2. Classify the listing relative to that cluster (floor / gap / HQ / sparse)
3. Apply the appropriate pricing path per classification
4. Display a channel-specific flip recommendation (bazaar vs item market) for floor pieces, and connect HQ pieces to the existing comp-panel median pricing

Additionally: add a minimum floor profit setting, a manual ledger entry form, and a ledger layout overhaul.

---

## User Stories

### Dynamic pricing algorithm (Steps I + J → v1.29.0 + v1.30.0)

1. As a buyer evaluating an auction listing, I want the advisor to detect the current market floor price from live comps so that my max bid is anchored to what the piece can actually resell for today, not a static formula.
2. As a buyer, I want the advisor to automatically identify when a piece is a commodity floor item so I don't waste time researching a piece that has no premium value.
3. As a buyer, I want to see the floor cluster clearly displayed so I can verify the algorithm's classification matches what I see in the market.
4. As a buyer evaluating a floor piece, I want to see the projected net return for both a bazaar sale and an item market sale so I can choose the best exit channel.
5. As a buyer, I want to set a minimum absolute profit floor (e.g. $5M) so the advisor never recommends bidding on a piece where my net would be below that threshold regardless of market position.
6. As a buyer, I want the max bid for a floor piece to be calculated as `floor_price − min_floor_profit` so I know the exact ceiling I can bid and still walk away with my minimum.
7. As a buyer, I want the mug buffer to default to 0% for floor flips so that thin-margin floor pieces are not incorrectly flagged as unprofitable due to a mug assumption the market does not price in.
8. As a buyer, I want the target profit % setting to be ignored entirely for floor pieces so the recommendation reflects the actual quick-flip economics, not my premium flip targets.
9. As a buyer evaluating a gap piece (quality or bonus above the floor cluster's best, but no close comps above it), I want the advisor to interpolate a suggested resale price between the best floor comp and the next premium comp, leaning toward the floor anchor so the piece is positioned attractively.
10. As a buyer, I want gap piece recommendations labelled "Estimated position" so I know the suggestion is interpolated, not anchored to a direct comp.
11. As a buyer evaluating an HQ piece (quality or bonus clearly above the floor cluster), I want the advisor to use the existing comp-panel median-window pricing to set the ref price, so the recommendation reflects where the piece genuinely sits in the premium range.
12. As a buyer, I want pieces whose max offer exceeds 2× BB floor to display a prominent warning badge so I know to do additional manual research before committing.
13. As a buyer evaluating a listing when fewer than 3 comps are available, I want the comp panel to display whatever comps exist and skip the automatic recommendation so I can judge the sparse market myself.
14. As a buyer, I want sparse-market listings labelled with a "Sparse market" badge on the advisory strip so I immediately know the recommendation is unavailable.
15. As a buyer, I want the classification to update automatically when comp data refreshes so stale floor/HQ determinations don't persist after the market moves.

### Manual ledger entry (Step K → v1.31.0)

16. As a trader, I want an "+ Add Entry" button in the ledger header so I can log trades that were not captured live by the script.
17. As a trader, I want the manual entry form to include: item name, rarity, quality %, bonus %, bid/purchase price (required), max offer (optional), and result (default: Won) so I can fully reconstruct the context of a past trade.
18. As a trader, I want an optional actual sell price field in the form that unlocks only when result is set to Won so I can record completed P&L immediately.
19. As a trader, I want the form to validate that bid price is a positive number before accepting the entry so bad data cannot corrupt the ledger.
20. As a trader, I want manually added entries to persist to localStorage with the same schema as live-logged entries so they appear identically in the ledger table and CSV export.
21. As a trader, I want the form to close and the ledger to re-render immediately after submission so I can see the new entry without a page reload.

### Ledger UI overhaul (Step L → v1.32.0)

22. As a trader, I want the ledger panel to not be obscured by Torn's navigation buttons so I can read and interact with all ledger content on a full-width browser window.
23. As a trader, I want the ledger table to have sufficient column spacing so values are readable without horizontal scrolling on the primary columns.
24. As a trader, I want secondary columns (Score, ROI%, BB Floor, Ref Price) hidden by default behind a "Show more" toggle so the table is not cluttered during normal use.
25. As a trader, I want the "Show more" toggle to persist my preference within the session so I don't need to re-expand columns every time the ledger re-renders.
26. As a trader, I want a single actual sell price input per Won row where I enter what I received for the piece so the script can compute my net P&L.
27. As a trader, I want the market fee (5%) to be automatically deducted from my entered sell price when computing net P&L, with the deduction shown explicitly so I understand what the script is calculating.
28. As a trader, I want net P&L figures to be consistently aligned across all Won rows so the column is easy to scan.

---

## Implementation Decisions

### Module: Floor cluster detector
A pure function `detectFloorCluster(comps)` that takes a sorted array of comp listings (price ascending) and returns `{ floorPrice, bestQualityPct, bestBonusPct, clusterSize, isValid }`. Cluster boundary: listings within 10–15% of the cheapest listing price. `isValid` is false when `clusterSize < 3` (sparse market). This module has no side effects and no UI dependency — it is the deepest, most isolated unit in the new algorithm.

### Module: Listing classifier
A pure function `classifyListing(listing, floorCluster)` → `'floor' | 'gap' | 'hq' | 'sparse'`. Logic:
- `'sparse'` if `!floorCluster.isValid`
- `'floor'` if `listing.qualityPct <= floorCluster.bestQualityPct AND listing.bonusPct <= floorCluster.bestBonusPct`
- `'gap'` if listing beats the floor cluster but no comps exist within 15% of the listing's natural premium position
- `'hq'` otherwise

### Module: Gap interpolator
A pure function `interpolateGapPrice(listing, floorAnchor, premiumAnchor)` → suggested resale price. Leans 25–30% of the way from floor to premium (not midpoint) so the piece is positioned attractively relative to both anchors. This matches observed market behaviour where gap pieces sell when priced closer to the floor, visually reading as a deal to mid-budget buyers.

### Module: Floor flip pricer
A pure function `calcFloorFlipMaxBid(floorPrice, minFloorProfit, marketFee)` → `{ maxBid, bazaarNet, marketNet }`:
- `maxBid = floorPrice - minFloorProfit`
- `bazaarNet = floorPrice - maxBid` (no fee, slight undercut assumed)
- `marketNet = (floorPrice * (1 - marketFee)) - maxBid`

### computeListingMetrics (modified)
Branches on `classifyListing` output. Floor → `calcFloorFlipMaxBid`. Gap → `interpolateGapPrice`. HQ/sparse → existing median-window comp panel ref price (Step H). Exceptional detection: after computing max offer, if `maxOffer > 2 * bbFloor`, set `isExceptional = true` flag. Same result shape returned in all branches so no callers change.

### buildContextPanel (modified)
Floor tier: shows floor comp price, bazaar net, market net, max bid. Replaces the current net profit row with two channel-specific rows. Hides King's cap warning (not relevant for floor pieces). Gap tier: shows "Estimated position" label, both anchor comps, interpolated price. HQ/exceptional: existing layout unchanged, plus 2× BB badge when `isExceptional`.

### Settings modal (modified)
New field: `Min floor profit` — single currency input (e.g. $5,000,000). Stored in `localStorage` via `KEYS.MIN_FLOOR_PROFIT`. Default: $5,000,000. Displayed alongside existing profit % and mug buffer settings.

### buildAddEntryForm (new)
Renders an inline form above the ledger table. Fields: item name (text or known-piece dropdown), rarity (dropdown), quality % (number, optional), bonus % (number, optional), bid price (number, required), max offer (number, optional), result (dropdown, default Won), actual sell price (number, optional, visible only when result = Won). On submit: validates bid > 0, creates entry with same schema as `logListing()` using `id = Date.now()`, persists, calls `renderLedger()`. On cancel: removes form without persisting.

### renderLedger (modified)
- Z-index: increase `#rwa-ledger-panel` z-index above Torn nav (investigate stacking context, use `z-index: 10000` as starting point)
- Column visibility: default visible set = Date, Item, Rarity, Q%, Bonus%, Bid, Max Offer, Result, Net P&L. Hidden set = Score, ROI%, BB Floor, Ref Price. "Show more" button toggles hidden columns; preference stored in `MEM` (not persisted to localStorage)
- P&L input: single sell price field per Won row (gross amount received). Script deducts market fee automatically. Deduction shown inline: `$X × 0.95 = $Y net`. `actualNet = (sellPrice * 0.95) - currentBid`
- Net P&L column: fixed-width, right-aligned, consistent across all Won rows

---

## Testing Decisions

A good test in this codebase verifies external behaviour through the module's public interface only — it does not inspect internal variables or implementation details. For pure functions this means: given these inputs, assert this output. For UI components this means: given this `MEM` state, assert this DOM structure.

**Modules recommended for testing:**

- `detectFloorCluster` — highest priority. Input: array of comp objects with price, qualityPct, bonusPct. Output: cluster object. Test with: normal cluster, tight cluster, spread-price comps, fewer than 3 comps, single comp. This is the root of the algorithm — a bug here corrupts every downstream output.
- `classifyListing` — second priority. Input: listing object + cluster object. Test all four output values and the boundary conditions (listing quality exactly equal to cluster best, listing beats on one axis only, sparse cluster).
- `calcFloorFlipMaxBid` — third priority. Pure arithmetic; verify channel-specific nets and that `maxBid` is correctly anchored to `minFloorProfit`.
- `interpolateGapPrice` — fourth priority. Verify that output leans toward floor anchor (result should be in lower 30% of the floor-to-premium range, not midpoint).

No existing test infrastructure in this repo — these can be validated with a lightweight inline test runner in the browser console or a standalone Node script using the extracted pure functions.

---

## Versioning

| Version | Scope |
|---------|-------|
| v1.29.0 | Floor cluster detection, listing classification, floor flip display, gap interpolation, min floor profit setting, mug buffer default 0% for floor |
| v1.30.0 | HQ classification → Step H comp panel integration, 2× BB warning badge, sparse market badge and display |
| v1.31.0 | Manual ledger entry form (Step K) |
| v1.32.0 | Ledger UI/UX overhaul: z-index fix, column visibility toggle, P&L input redesign, net alignment (Step L) |

---

## Out of Scope

- Weapons of any type (RW weapon classification is more complex due to variable rarity — deferred to a future PRD)
- Orange and red armor pieces (limited comp data; pricing is largely controlled by a small number of traders — treat as exceptional/manual research for now)
- Dune, Delta, Marauder, Vanguard, Sentinel, EOD armor sets
- Automated bidding or any game action on behalf of the user
- Mug buffer configurability per trade channel for floor flips (flagged as open question; default to 0% for now)
- Ubiquitous language cleanup / terminology standardisation (deferred until after Step J lands, per earlier decision)

---

## Further Notes

- The grill-me session confirmed that the 26% bonus threshold (used in King's score formula) naturally emerges from live market data as a real premium signal — it is not an artefact of the formula. The dynamic algorithm will reproduce this behaviour without hardcoding it.
- Gap piece interpolation lean (25–30% toward floor) is validated by real trading experience: pieces priced well below the premium anchor but above the floor sell faster than midpoint-priced pieces. The algorithm encodes this.
- Mug risk for floor flips is an open question. At $80–125M floor prices, a 10% mug loss would eliminate the margin entirely. The community does not appear to price this in for these pieces. Default mug buffer = 0% for floor flips, with a future settings option to override.
- The minimum floor profit setting (`Min floor profit`) is a new concept distinct from the existing target profit % — it applies only to floor pieces and is an absolute dollar amount, not a percentage.
- The `detectFloorCluster` and `classifyListing` functions are the deepest modules in this implementation. They have no UI dependency and a small, stable interface. Investing in tests for these two functions specifically will prevent the largest class of potential bugs.
