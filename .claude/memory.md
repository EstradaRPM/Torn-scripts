# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-30 (grill session complete; #183 done as v1.45.0; design finalized for #177, #178, #180)_

---

## Active WIP

**File:** `torn-snipe-tracker-v1.user.js`
**Version:** `1.45.0` (on main, pushed — clean, no open PRs, no stale branches)
**Status:** Implementation in progress — 10 of 12 tickets done; 3 leaf tickets remain

**Next session:** Implement any of #177, #178, #180 — all fully designed, unblocked, ready to code.

### Known PDA limitation (non-fixable without PDA engine change)
`GM_xmlhttpRequest` on Torn PDA's WebView does NOT bypass the page CSP. `weav3r.dev` calls will always fail with a network error on PDA. Script silently falls back to Torn API data only. Console noise is expected — not a bug to fix.

---

## Implementation tickets

| # | Title | Status |
|---|-------|--------|
| #174 | `@match` wildcard + page mode detection | ✅ DONE v1.38.0 |
| #175 | Pure function engine + Node test suite | ✅ DONE |
| #176 | Capital API: vault fetch + settings refactor | ✅ DONE v1.39.0 |
| #177 | Snipe frequency badge | open — DESIGNED, ready to implement |
| #178 | PDA notifications + audio alert | open — DESIGNED, ready to implement |
| #179 | Smart sell position + snipe detection anchor | ✅ DONE v1.40.0 |
| #180 | Mug scenario display | open — DESIGNED, ready to implement |
| #181 | Collapsed card layout + weighted sort | ✅ DONE v1.41.0 |
| #182 | MutationObserver + real-time green highlight | ✅ DONE v1.42.0 |
| #183 | Ledger summary fixes | ✅ DONE v1.45.0 |
| #184 | Injected snipe card + Queue button | ✅ DONE v1.43.0 |
| #185 | Quick Log strip + Batch Entry + pending queue | ✅ DONE v1.44.0 |

---

## Grill session results — design decisions locked for #177, #178, #180

Full domain language in `CONTEXT.md`. ADR in `docs/adr/0001-poll-only-snipe-alerts.md`.

### #177 — Snipe Frequency Badge (next version: 1.46.0)

- Wire `calcSnipeFrequency` from `test-snipe-engine.js` into the IIFE (pure functions section, ~line 953)
- **Data fix required:** Snapshot push at line 1191 currently only stores `{ timestamp, fairValue }`. Must also store `lowestListed` for frequency calc to work. Existing snapshots without `lowestListed` will produce 0 frequency — fine, data builds up over time.
- **Field name fix:** `calcSnipeFrequency` uses `s.ts` and `s.lowestListed`. Change to `s.timestamp` to match the existing snapshot schema (or add `ts` alias — but `timestamp` is canonical).
- **Window:** 2 days fixed (`2 * 24 * 60 * 60 * 1000`)
- **Badge format:** `N×/2d` displayed in Row 1 of the watch card (visible when collapsed)
- **Sort fix (also in this ticket):** Current sort bug — `computeCardScore` returns `-Infinity` for all non-snipe items, making non-snipe ordering arbitrary. Fix with two-tier sort:
  - Tier 1: items with active snipe status, sorted by `calcWeightedScore` descending
  - Tier 2: everything else, sorted by snipe frequency descending
- **Cards default to collapsed:** Change `!!MEM.cardCollapsed[item.itemId]` logic so cards start collapsed unless explicitly expanded (invert the default). `cardCollapsed` is in-memory only so this is safe.

### #178 — PDA Notifications + Audio (next version: 1.47.0)

- **Trigger:** Poll cycle only (see ADR 0001). Fires once when item FIRST enters snipe territory (above→below threshold crossing). Does NOT repeat while sustained below threshold.
- **Crossing state:** Track in `MEM.lastSnipeState = {}` (itemId → bool, not persisted). On each poll, compare current vs previous snipe status per item. Fire only on `false → true` transition.
- **Audio:** 3-tone ascending chime, Web Audio API (no file dependency). ~200ms total.
- **Notification:** Check for TornPDA native bridge first; fallback to `GM_notification`. Add `@grant GM_notification` to metadata block.
- **Settings:** Single "Snipe alerts" on/off toggle in settings pane. Default on.

### #180 — Mug Scenario Display (next version: 1.48.0 or same PR as #177/#178)

- Wire `calcMugScenario` from `test-snipe-engine.js` into the IIFE (pure functions section)
- **Watch cards:** Add mug row inside `renderProjection()` (~line 1395). Show when `sellTarget × lowestListedQty >= MUG_THRESHOLD (10_000_000)`.
  - `calcMugScenario(sellTarget, lowestListedQty, lowestListed, 15)` — buyPrice = lowestListed (snipe price), mugPct = 15 fixed
  - Display: net outcome (positive = still profitable even if mugged; negative = loss)
- **Injected card:** Update `injectSnipeCard` to use `calcMugScenario` instead of the current hardcoded `saleValue * 0.15` gross loss calc
- Injected card is unreliable on PDA (has appeared only once in practice) — watch card is the primary surface

---

## v1.45.0 — What was done (#183)

Ledger summary fixes:
- Weighted ROI, win rate, live P&L estimate, at-risk capital display

## v1.44.1 hotfix — What was done

Fixed snipe alert card visibility on `page.php?sid=ItemMarket`:
- `getImarketItemId()` regex: `/[?&#](?:item)?ID=(\d+)/i` — handles both `ID=206` and `itemID=206`
- `injectSnipeCard()`: injects into `#st-inject-alerts` fixed div (decoupled from Torn CSS Module hashes)
- Observer target: tries `.item-market` before falling back to `document.body`
- Torn PDA DOM: `DIV.item___ydsFW`, parent `DIV.root___Io7i2`, outer container `.item-market`

---

## Snipe Tracker — Design decisions (locked)

- Bazaar = 0% fee. Item market = 5%. Mug default = 15%.
- Smart sell position: volume-block anchored, trend-adjusted (`computeSmartSellPosition`)
- Available capital: `vault_amount × (1 − vaultFloorPct/100)`. Default floor 10%.
- `BLOCK_VALUE_PCT = 0.10` — in IIFE
- Cards sort: two-tier (see #177 above)
- Per-card collapse toggle (▼/▶) in Row 1; `MEM.cardCollapsed` dict; **default collapsed**
- PAGE_MODE: 'market' = full panel + DOM, 'background' = silent poll only
- MutationObserver on imarket listings for real-time detection (zero API cost) — unreliable on PDA
- Snipe alerts: poll-triggered only (see ADR 0001)
- Logging: pending queue + Quick Log strip + Batch Entry form

## Pure functions — status

| Function | Status |
|----------|--------|
| `calcWeightedScore(grossProfit, roi, baseROI)` | ✅ in IIFE |
| `computeAvailableCapital(vaultAmount, vaultFloorPct)` | ✅ in IIFE |
| `detectVolumeBlock(listings, abovePrice, blockValueThreshold)` | ✅ in IIFE |
| `computeSmartSellPosition(listings, snipePrice, availableCapital, trend)` | ✅ in IIFE |
| `calcMugScenario(sellTarget, qty, buyPrice, mugPct)` | in test-snipe-engine.js — wire in #180 |
| `calcSnipeFrequency(snapshots, fairValue, threshold, windowMs)` | in test-snipe-engine.js — wire in #177 |

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
