# Trade Ledger

> **Status:** In Development
> **File:** `torn-trade-ledger-v1.user.js`
> **Target page:** `https://www.torn.com/*` (nav tray icon, all pages)
> **Current version:** 1.0.0

---

## Purpose

Unified trade ledger for Torn City traders. Records all buy/sell activity across item market, bazaar, and auction house. Shows TornW3B-backed fair value for open positions, fires an ambient sell alert when any position's P50 reaches its sell target, and reports accurate fee-adjusted P&L per trade. Runs as a nav tray icon on every Torn page. Works standalone — no other scripts required — but also receives trade records written by Snipe Tracker and RW Advisor via the shared `torn_trades` localStorage namespace.

## Data Sources

- [x] Torn API (`https://api.torn.com/`) — selections: `user?selections=log` (Scan Now, user-triggered only)
- [ ] Page DOM — not used for data; nav tray injection uses DOM selector fallbacks
- [x] TornW3B (`https://weav3r.dev/api`) — unconditional, 5-min background poll for P50 fair value

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  trades:        [],      // current torn_trades snapshot; refreshed on every Store op
  scanResults:   null,    // { candidates: [], sellEvents: [] } | null after Scan Now
  fairValues:    {},      // { [itemName]: { p50 } } from TornW3B
  fetchError:    null,    // string | null; shown in panel
  lastW3BPoll:   0,       // epoch ms of last TornW3B fetch
  panelOpen:     false,   // nav tray panel visibility
  showClosed:    false,   // toggle: include closed trades in table
};
```

### Store keys (localStorage)

| Key | Type | Purpose |
|-----|------|---------|
| `torn_trades` | JSON array | Shared trade records (schemaVersion 1); written by this script and source scripts |
| `ldgr_apikey` | string | Torn API key (if not injected by PDA) |
| `ldgr_migrated` | boolean | Set to true after st_trades → torn_trades migration runs |

### Key modules / functions

| Module/Function | Owns | Interface | Invariants |
|----------------|------|-----------|------------|
| `Store` | localStorage | `get(k)`, `set(k, v)` | try/catch, never throws |
| `TradeStore` | All CRUD for `torn_trades` | `add`, `update`, `partialClose`, `fullClose`, `list`, `getByStatus` | Status transitions open→partial→closed; remainingQty drives transitions |
| `LogParser` | Parse Torn API log entries | `parseBuyCandidates(entries)`, `parseSellEvents(entries)` | Pure functions; no network, no DOM; returns `[]` on malformed input |
| `LogFetcher` | Torn API `user?selections=log` | `fetch()` → `{ entries, error }` | User-triggered only; disables key on error 2/13 |
| `W3BFetcher` | TornW3B P50 data | `fetch(itemNames)` → `{ [name]: { p50 } }` | Silent failure on PDA (expected); 5-min background timer |
| `SellAlertEngine` | Sell alert crossing logic | `checkAlerts(positions, fairValues)` → positions to alert | Pure function; alertFired resets when P50 drops below sellTarget |
| `MigrationRunner` | One-time st_trades → torn_trades | IIFE on load | No-op if `ldgr_migrated` set or `st_trades` absent |
| `NavIcon` | Nav tray icon + badge | Injected on load | Multiple CSS fallbacks; no fallback mount if Torn changes nav |
| `render()` | Full panel UI | Called on every state change | Rebuilds from MEM only; no partial patching |

---

## Trade Record Schema (torn_trades, schemaVersion 1)

```js
{
  id:              string,           // unique; "migrated_name_timestamp" for migrated records
  schemaVersion:   1,
  source:          'snipe-tracker' | 'rw-advisor' | 'manual' | 'scan',
  itemId:          number | null,    // always null from Torn log entries
  itemName:        string,
  buyPrice:        number,           // per unit
  qty:             number,
  remainingQty:    number,           // decremented by partialClose
  buyVenue:        'item-market' | 'auction' | 'bazaar' | 'manual',
  sellTarget:      number | null,    // per unit; null for migrated records
  fairValueAtOpen: number | null,    // TornW3B P50 at time of add
  floodPlay:       boolean,
  notes:           string,
  openedAt:        number,           // epoch ms
  status:          'open' | 'partial' | 'closed',
  sells:           Array<{ qty, price, venue, closedAt }>,
  alertFired:      boolean,          // resets when P50 drops below sellTarget
}
```

---

## P&L Formula

Net per sell event: `price × qty × (1 − feeRate)`
- bazaar: `feeRate = 0`
- item-market: `feeRate = 0.05`
- auction: `feeRate = 0.03`

Total realized P&L per position: sum of net across all sell events minus `buyPrice × totalQtySold`.

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| trade | A single buy position with one or more associated sell events | position, order |
| open | Trade with no sell events; remainingQty = qty | active |
| partial | Trade with at least one sell event but remainingQty > 0 | half-sold |
| closed | Trade where remainingQty = 0 | complete, done |
| sell event | A single sell transaction appended to `sells` | sale |
| scan | Torn API log fetch + parse triggered by Scan Now button | poll, auto |
| sell target | Per-unit price the user wants to reach before selling | target price |
| fair value | TornW3B P50 for the item at a given moment | market price |
| flood play | A buy made specifically because a large flood listing appeared | flood snipe |
| deployed capital | Sum of `buyPrice × remainingQty` across all open/partial positions | open value |

---

## Active State

- **Version:** 1.4.0
- **Open issues:** #234, #235, #236, #237
- **Closed:** #229 (scaffold), #230 (NavIcon + panel shell), #231 (manual add form + partial sell UI + P&L), #232 (LogParser + LogFetcher + API key UI), #233 (W3BFetcher + live market value column)
- **Next up:** #234
- **PRD:** #228

---

## ADRs

None yet.

---

## Notes / Gotchas

- `torn_trades` is the shared contract. Source scripts (Snipe Tracker, etc.) push schemaVersion 1 records directly to this key. JS single-threaded event loop prevents race conditions within a tab.
- itemId is always null in Torn log entries — matching is by item name + approximate timestamp + price (fuzzy). Ambiguous matches surface both candidates in the scan list; no auto-resolution.
- TornW3B calls fail silently on Torn PDA (CSP blocks `GM_xmlhttpRequest` to weav3r.dev). Script falls back to `fairValueAtOpen` with a `*` stale indicator. This is expected and non-fixable — do not add a workaround.
- W3BFetcher uses `GET https://weav3r.dev/api/marketplace` (bulk, no auth, 60s cache). Returns all items; we filter by name. `p50` = `bazaar_average ?? market_price`. One call per 5-min cycle regardless of how many open positions exist.
- Auction house is a floor price reference (BB floor source), not a preferred sell venue. The UI should not suggest it as a sell default.
- The 5-minute TornW3B poll is not rate-limited against the Torn API 100 req/min cap — TornW3B is a separate service.
- After migration, the Snipe Tracker's own ledger panel becomes redundant. Cleanup is a separate follow-up, not in scope here.
