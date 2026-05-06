# Snipe Tracker

> **Status:** Active
> **File:** `torn-snipe-tracker-v1.user.js`
> **Target page:** `https://www.torn.com/imarket.php`
> **Current version:** check `@version` in the file header

## Purpose

Monitors Torn City's item market for listings priced below a per-item threshold (Snipes), flags buy-and-flip opportunities in real time, and maintains a persistent trade ledger with P&L tracking. The user configures a watchlist of items and threshold percentages; the script polls the market API, surfaces Snipes and Flood Plays on a card UI, and allows quick-logging of trades to the ledger.

## Data Sources

- Torn API (`https://api.torn.com/`) — selections: `market` (item listings), `user` (bars, vault balance)
- Page DOM (`torn.com/imarket.php`) — supplementary price data
- TornW3B (`https://weav3r.dev/api`) — unconditional, no opt-in

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  items: {},          // Map<itemId, ItemState> — live per-item market data
  vault: null,        // number — vault balance from API (Available Capital source)
  fetchError: null,   // string | null — last API error, surfaced in UI
  lastPoll: 0,        // epoch ms of last successful poll
  pendingQueue: [],   // in-memory items staged for ledger logging this session; not persisted
  ledger: [],         // trade records; loaded from Store on init, written back on log
};
```

### Store keys (localStorage)

Namespace prefix: `snipe_`

| Key | Type | Purpose |
|-----|------|---------|
| `snipe_watchlist` | JSON array | Item IDs being monitored |
| `snipe_thresholds` | JSON object | Per-item threshold % overrides |
| `snipe_ledger` | JSON array | Persisted trade records |
| `snipe_capital_floor` | number | % of vault to hold in reserve (not Available Capital) |

### Key modules / functions

| Module/Function | Owns | Interface | Invariants |
|----------------|------|-----------|------------|
| `fetchMarketData()` | All Torn API calls | async, writes to MEM | 60s min interval; checks `d.error` before use |
| `computeFairValue(listings)` | P50 price | pure fn | Weighted by listing count, not quantity |
| `computeSnipeThreshold(fv, pct)` | Threshold price | pure fn | `fv × (1 − pct)` |
| `computeSmartSellPosition()` | Sell Target | pure fn | Anchored below first Volume Block above snipe price |
| `detectFloodPlay(item)` | Flood Play detection | pure fn | Mutually exclusive with SNIPE status |
| `render()` | Full UI | Called on every state change | Reads MEM only; no side effects except DOM writes |
| `Store` | localStorage | `get(k)`, `set(k, v)` | try/catch; never throws; `snipe_` prefix |

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| **Snipe** | A listing priced below the item's Snipe Threshold — a buy-and-flip opportunity | deal, cheap listing, bargain |
| **Fair Value** | P50 price of current listings, weighted by listing count (not quantity). One seller with 500 units = one data point. | market price, median price |
| **Snipe Threshold** | Price ceiling: `fairValue × (1 − threshold%)`. Per-item, user-configurable. | cutoff, trigger price |
| **Flood** | Market condition: large-quantity listing (100+ units) below fair value, anchoring resale ceiling | oversupply, dump, wall |
| **Flood Play** | Actionable opportunity from a Flood — flood price is at market floor AND fair value is high enough above it (by ≥ threshold%) to flip. More speculative than a Snipe. | flood snipe |
| **Sell Target** | Recommended resale price, anchored just below the first significant Volume Block above snipe price, adjusted for trend | resale price, exit price |
| **Volume Block** | Price tier where total listed qty × price > 10% of Available Capital. A supply wall the user must undercut to move inventory. | wall, supply ceiling |
| **Available Capital** | Vault balance minus configurable floor %. Represents spendable funds. | budget, balance |
| **Pending Queue** | In-memory list of items staged for ledger logging this session. Flushed to Trade when logged. Not persisted. | cart, watchlist |
| **Trade** | Logged buy event in the ledger. Captures item, buy price, qty, timestamp, sell target at logging time. | position, order |
| **Snipe Frequency** | Times an item's lowest price crossed downward through the Snipe Threshold in a rolling window. Counts transitions (above→below), not sustained below-threshold states. | snipe count, hit rate |
| **Snipe Alert** | Notification + audio chime fired once on first entry into Snipe territory per poll cycle. Does not repeat while item stays below threshold — fires again only on next fresh crossing. | snipe notification, price alert |
| **Mug Scenario** | Risk projection shown when projected sale value (sell target × qty) exceeds Mug Threshold. Computes net after mugging at 15% loss rate. | mug risk, theft risk |
| **Mug Threshold** | $10M sale value — above this, Mug Scenario is displayed | — |

### Critical invariants

- **SNIPE and FLOOD are mutually exclusive UI labels.** An item shows SNIPE when lowest listed price < Snipe Threshold. It shows FLOOD only when NOT in Snipe status but Flood Play conditions are met.
- **P&L formula:** `actualNet = actualSellPrice − currentBid` only. Fees and mug buffer are advisory display only — never deducted from actualNet.
- **Market fees:** Bazaar = 0% always. Item market = 5%. Anon listing = +10% (15% total). Mug risk materializes at $10M+ sale value.

---

## Active State

- **Version:** check `@version` in `torn-snipe-tracker-v1.user.js`
- **Open issues:** check GitHub Issues with label `snipe-tracker`
- **Parked reason:** N/A — active

---

## ADRs

- `docs/adr/0001-poll-only-snipe-alerts.md` — Snipe alerts trigger from poll cycle only, not MutationObserver. MutationObserver is unreliable on Torn PDA's WebView; poll path is the only reliable path across both PDA and desktop.

---

## Notes / Gotchas

- **Torn PDA cross-origin restriction:** `GM_xmlhttpRequest` on PDA's WebView does NOT bypass page CSP. TornW3B (`weav3r.dev`) calls fail silently on PDA — script falls back to Torn API data only. Console errors on PDA are expected, not a bug. This is non-fixable.
- **Globally cached selections:** `user→bazaar` and `user→bounties` are Torn-side cached — polling faster than 5 min yields stale data regardless of local polling interval.
