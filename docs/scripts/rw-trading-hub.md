# RW Trading Hub

> **Status:** In Development
> **File:** `TORN-RW-trading-hub.user.js`
> **Target page:** multiple — `amarket.php`, `page.php?sid=ItemMarket`, `bazaar.php`, `item.php`, `displaycase.php`, plus any page (for the floating ledger window)
> **Current version:** 0.1.0 (draft)

---

## Purpose

A trader's workbench for ranked-war (RW) armor and weapon flipping. Combines three jobs that currently require switching between scripts and manual spreadsheets:

1. **Price intel** — wherever an RW item shows up (auction house, item market, bazaar, item page), surface inline relative-price comparisons against historical auction sales and current market/bazaar listings, ranked by similarity of bonuses + quality.
2. **Inventory ledger** — automatically log RW armor/weapon purchases by scanning Torn's item log API; track each piece from buy → list → sell with ROI.
3. **Advertising hub** — turn selected ledger items into ready-to-paste Trade Chat blurbs and HTML forum posts (with optional gyazo image URL embedded), so the entire "I bought this, here's my price, here's where to find me" workflow is one click.

The user does differently because of this script: they stop juggling Auction Price Checker, the RW Advisor, a manual ledger spreadsheet, and a forum-post template — it all lives in one panel.

---

## Data Sources

- [x] **Torn API** (`https://api.torn.com/`) — selections:
  - `user?selections=log` — scan recent item-buy log entries to auto-detect RW armor/weapon purchases for ledger entry
  - `user?selections=log` — also used to detect sales for the Sales tab + ROI calc
  - `user?selections=bazaar` — pull current listings (to confirm what's still up)
  - Item metadata as needed for item ID → name / type resolution
- [x] **Page DOM** — auction house item rows, item market listings, bazaar listings, item page — read item name, bonuses, quality, listed price to drive the inline comparison
- [x] **TornW3B** (`https://weav3r.dev/api/ranked-weapons`) — unconditional; live market/bazaar comparison data for ranked weapons (ripped from Auction Price Checker)
- [x] **Third-party auction-history API** (Supabase: `btrmmuuoofbonmuwrkzg.supabase.co`) — historical sold-auction lookups by item + bonus + quality tolerance (ripped from Auction Price Checker)

Requires `@grant GM_xmlhttpRequest` and `@connect` directives for both third-party hosts. This is an intentional exception to the "no external dependencies / fully self-contained" rule; the third-party calls **are** the comparison logic — re-implementing them is out of scope.

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  // --- Inline price comparison (per-page) ---
  inline: {
    activeItem: null,      // { name, bonuses:[{id,value}], quality, listedPrice, source:'auction'|'market'|'bazaar'|'item' }
    historyResults: [],    // Supabase hits, similarity-scored
    marketResults: [],     // weav3r hits, similarity-scored
    loading: false,
    error: null,
  },

  // --- Ledger ---
  ledger: {
    open: false,           // collapsible window visibility
    activeTab: 'purchases',// 'purchases' | 'sales' | 'advertise'
    items: [],             // ledger rows (see LedgerItem shape below)
    lastLogScan: 0,        // epoch ms; throttle log scans
    scanError: null,
  },

  // --- Advertise tab ---
  advertise: {
    selectedIds: [],       // ledger item ids checkbox-selected for output
    chatPreview: '',       // generated trade-chat blurb
    forumPreview: '',      // generated forum HTML
  },

  // --- Settings ---
  settings: {
    bonusTolerance: 10,    // ± for bonus value similarity
    qualityTolerance: 10,  // ± for quality similarity
    apiKey: '',            // Torn API key (PDA injects)
  },

  fetchError: null,        // last API error surfaced in UI
};

// LedgerItem shape
// {
//   id: string,            // uuid
//   itemId: number,
//   itemName: string,
//   type: 'weapon'|'armor',
//   bonuses: [{id, value}],
//   quality: number,
//   buyPrice: number,
//   buyTimestamp: number,
//   buySource: 'auction'|'market'|'bazaar',
//   advertisedPrice: number|null,
//   gyazoUrl: string|null,
//   status: 'held'|'listed'|'sold',
//   soldPrice: number|null,
//   soldTimestamp: number|null,
//   soldVenue: 'bazaar'|'market'|'auction'|null, // for fee-adjusted ROI
// }
```

### Store keys (localStorage)

Prefix: `rwth_` (RW Trading Hub).

| Key | Type | Purpose |
|-----|------|---------|
| `rwth_ledger` | JSON array | Persisted `MEM.ledger.items` |
| `rwth_settings` | JSON object | Persisted `MEM.settings` |
| `rwth_window_pos` | JSON object | Ledger window position/size (PC drag/resize) |
| `rwth_cache_history` | JSON object | TTL'd Supabase query cache (5 min) |
| `rwth_cache_market` | JSON object | TTL'd weav3r query cache (5 min) |
| `rwth_log_cursor` | number | Last-seen log entry timestamp, for incremental scans |

### Key modules / functions

| Module/Function | Owns | Interface | Invariants |
|---|---|---|---|
| `Store` | localStorage I/O | `get(k)`, `set(k,v)` | try/catch wrapped; never throws |
| `setState` | Sole MEM mutation path | `setState(patch)` — applies patch, calls `render()` | All MEM mutations route through here. Never `MEM.foo = bar` directly. May batch via `queueMicrotask`. |
| `PricingEngine` | Third-party price lookups | `searchHistory(query)`, `searchMarket(query)` | Both via `GM_xmlhttpRequest`; results cached 5 min; bonus/quality tolerance applied |
| `DomScanner` | Page DOM extraction | `detectItem()` returns `inline.activeItem` or null | Per-page selectors with regex fallbacks |
| `InlineRenderer` | Inline expandable comparison widget | `mount(host, item)` | RW-Advisor-styled; collapsed by default; one widget per detected item |
| `LogScanner` | Torn API log scan for buys + sells | `scan()` updates `ledger.items` via `setState` | Throttled to 5 min minimum; incremental via `rwth_log_cursor` |
| `matchSells` | Pure sell-matching | `match(sellEvents, openPositions) → {autoClosed, ambiguous}` | Pure; in `__RwthPure` |
| `Ledger` | Ledger items CRUD | `add()`, `update(id, patch)`, `remove(id)`, `markSold(id, price, venue)` | All mutations via `setState({ledger: ...})` |
| `ROI` | Profit + ROI calc | `compute(item) → number` | Pure; fee-adjusted by `soldVenue`: bazaar 0%, market 5%, anon +10% (in `__RwthPure`) |
| `similarity` | Bonus/quality similarity scoring | `score(activeItem, candidate) → number` | Pure; bonus + quality tolerance from `MEM.settings` (in `__RwthPure`) |
| `AdvertiseGenerator` | Chat + forum output | `toChat(items)`, `toForumHtml(items, gyazoUrls)` | Pure; output exactly matches user's forum-post template (in `__RwthPure`) |
| `build*` | Pure HTML builders | `buildLedgerTab(state)`, `buildAdvertiseTab(state)`, `buildInlineWidget(state)` → htmlString | Pure; state in, HTML out (in `__RwthPure`) |
| `render` | DOM dispatcher | `render(MEM)` | Wires delegated listeners once on stable shell at first call; rewrites inner content via `innerHTML` on subsequent calls. No partial DOM patching above the content container. |

### Test seam

The IIFE exports a `globalThis.__RwthPure` block holding all pure functions (`ROI.compute`, `AdvertiseGenerator.toChat`/`toForumHtml`, `similarity.score`, `matchSells`, every `build*`). A Node shim stubs `localStorage` / `GM_xmlhttpRequest` / `document` and `require`s the `.user.js` directly — tests run the exact shipped code, not a re-implementation. Runner: `node:test`. See ADR-NNNN for rationale.

### Render contract

- `render(MEM)` is the only impure dispatcher; everything below it is pure.
- First call: builds outer shell, wires delegated event listeners on a stable container.
- Subsequent calls: rewrites `#rwth-content` via `innerHTML = buildContent(MEM)`. Listeners survive because they live on the outer shell.
- `setState(patch)` is the sole mutation path: `Object.assign(MEM, patch); render();`. No call site sets `MEM.foo = bar` directly.
- Do not call `render()` while a form input is focused mid-typing — only on submit/cancel.

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| RW item | Ranked-war weapon or armor (bonus-bearing) | "war item", "PvP item" |
| Inline widget | Expandable price-comparison element injected into existing page rows | "popup", "tooltip" |
| Ledger | Persistent record of bought / listed / sold RW items owned by user | "inventory", "log" |
| Held / Listed / Sold | Ledger item status states | "open", "active", "closed" |
| Advertise | Generating chat blurb + forum HTML from ledger selection | "post", "share", "broadcast" |
| Similarity score | How closely a comparison result matches active item (bonus IDs equal, value within tolerance, quality within tolerance) | "match score", "relevance" |
| Bonus tolerance | ± percentage band for bonus value matching (default 10) | "fuzz", "range" |
| Quality tolerance | ± percentage band for quality matching (default 10) | — |
| Fee-adjusted ROI | Profit calc using sell venue's fee (bazaar 0%, market 5%, anon +10%) | "net profit", "real profit" |
| Gyazo URL | Optional screenshot URL embedded in forum HTML for a ledger item | "image link", "screenshot" |

---

## Active State

- **Version:** 0.1.0 (draft — no code yet)
- **Open issues:** none filed yet
- **Next up:** review doc → file PRD via `/to-prd` → break into issues via `/to-issues`

---

## ADRs

- *(none yet — anticipated: ADR on intentional third-party-API exception to self-contained rule)*
- [ADR-0002](../adr/0002-rwth-pure-test-seam.md) — pure functions exposed via `globalThis.__RwthPure` for Node testing

---

## Notes / Gotchas

- **PDA + cross-origin fetches**: per session memory, `GM_xmlhttpRequest` on Torn PDA's WebView does not bypass page CSP — `weav3r.dev` and Supabase calls may fail silently on PDA. Script must continue to function (ledger, advertise output, Torn-API-driven log scan) when third-party lookups fail; inline widget should show a graceful "comparison unavailable" state.
- **Log scan throttling**: 5-minute minimum poll. Use `rwth_log_cursor` to fetch only new entries; never re-process the full log.
- **Forum HTML must match user's template exactly** — template HTML will be pasted by user and is the source of truth for markup/classes/structure.
- **Mug risk threshold**: $10M+ listings carry mug risk per session memory; advertise generator should not surface this as a feature unless user requests it.
- **Inline widget hosts**: auction rows, market rows, bazaar rows, item-page header — each needs its own mount point selector with fallbacks.
