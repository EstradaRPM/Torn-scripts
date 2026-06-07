# Torn API Monitor

> **Status:** In Development
> **File:** `torn-api-monitor.user.js`
> **Target page:** `https://www.torn.com/*`
> **Current version:** 1.2.0

---

## Purpose

Developers running multiple API-consuming scripts on Torn have no visibility into how close any given key is to the 100 req/min hard limit. This script floats on every Torn page as a collapsible widget. The user loads API keys with human-readable labels; one click fetches the last 100 log entries per key and displays a color-coded heat bar showing current req/min load. Expanding a key card reveals an endpoint breakdown and raw recent entries for forensic investigation.

## Data Sources

- [x] Torn API (`https://api.torn.com/`) — selections: `v2/key/log`

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  keys: [],        // [{ id, label, maskedKey, rawKey }] — loaded keys
  logs: {},        // { [keyId]: { entries, fetchedAt, error } }
  expanded: {},    // { [keyId]: boolean } — card expanded state
  collapsed: false, // widget collapsed state
  refreshing: false, // refresh in flight
};
```

### Store keys (localStorage)

| Key | Type | Purpose |
|-----|------|---------|
| `mon_keys` | array | Serialized key list with labels |
| `mon_collapsed` | boolean | Widget collapsed state |
| `mon_expanded` | object | Per-card expanded states |
| `mon_next_id` | number | Auto-increment ID counter for keys |

### Key modules / functions

| Module/Function | Owns | Interface | Invariants |
|----------------|------|-----------|------------|
| `KeyStore` | CRUD for saved keys+labels | `add(label, rawKey)`, `remove(id)`, `list()` | Persists to `mon_keys`; masks raw key for display |
| `LogFetcher` | API call to `v2/key/log` | `fetchLog(rawKey, limit)` → `{ entries, error }` | 1 req per call; uses `GM_xmlhttpRequest`; handles error codes 2 + 13 |
| `LogAnalyzer` | Pure analysis of log entries | `calcReqPerMin(entries, nowMs)`, `calcEndpointBreakdown(entries)`, `getRecentEntries(entries, n)`, `calcHeatLevel(reqPerMin)` | No side effects; no DOM; no network |
| `Widget` | Floating DOM shell | Mounts once; delegates to `render()` | Fixed bottom-right; z-index above Torn UI |
| `render()` | Full UI rebuild | Called on every state change | Rebuilds from MEM only; no partial patching |
| `Store` | localStorage | `get(k)`, `set(k, v)` | try/catch; never throws |

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| key card | The per-key UI row showing label, heat bar, and expand toggle | "row", "entry" |
| heat bar | Color-coded progress bar showing req/min as a fraction of 100 | "progress bar", "meter" |
| heat level | Categorical risk: `low`, `medium`, `high`, `critical` | "severity", "status" |
| req/min | Count of log entries with timestamp within the last 60 seconds | "requests per minute" (too long in code) |
| endpoint breakdown | Grouped count of calls by `type` + `selections` | "endpoint summary", "call breakdown" |
| refresh | Manual fetch of `v2/key/log` for all loaded keys | "poll", "sync" |
| loaded key | A key that has been pasted into the monitor and saved | "watched key", "tracked key" |

---

## Active State

- **Version:** 1.2.0
- **Open issues:** none
- **Closed:** #221 (PRD), #222 (LogAnalyzer + tests), #223 (scaffold + Widget + KeyStore), #224 (LogFetcher + Refresh All + heat bars), #225 (expanded card view)

---

## ADRs

None yet.

---

## Notes / Gotchas

- The `v2/key/log` call itself appears in the log on the *next* refresh — inflates req/min by 1. Acceptable noise; document but do not try to subtract it.
- `GM_xmlhttpRequest` + `@connect api.torn.com` required — `fetch()` is blocked cross-origin from torn.com to api.torn.com.
- Not supported on Torn PDA — `GM_xmlhttpRequest` on PDA WebView does not bypass CSP. Silent failure expected; not a bug to fix.
- Log entries use `timestamp` in Unix seconds (not ms) — multiply by 1000 before comparing to `Date.now()`.
- Heat thresholds: 0–33 green, 34–66 yellow, 67–90 orange, 91–100 red.
- Error codes 2 (bad key) and 13 (owner banned) must disable the key immediately and stop further requests for that key.
