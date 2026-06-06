# RW Trading Hub

> **Status:** In Development
> **File:** `TORN-RW-trading-hub.user.js`
> **Target page:** any page (the launcher injects into Torn's chat-icon row); reads `displaycase.php` / `bazaar.php` only as needed
> **Current version:** 0.1.0 (draft)

> **Grill sessions:** initial 2026-05-21 (interrupted; salvage in `rwth-assets.md`), resumed & completed 2026-05-21. Design below is **locked**.

---

## Purpose

A trader's workbench for ranked-war (RW) armor and weapon flipping. Replaces juggling a manual ledger spreadsheet and a forum-post template with one panel that does two jobs:

1. **Inventory ledger** — log RW armor/weapon purchases (auction wins scanned from the Torn item log; other buys added manually); track each piece buy → list → sold with fee-accurate ROI.
2. **Advertising hub** — turn the ledger + a curated transaction list into five ready-to-paste outputs (forum title, forum post HTML, trade-chat blurb, bazaar description HTML, profile signature HTML).

### Scope — v0.1.0 vs v0.2.0

**v0.1.0: Ledger + Advertise.** Frozen — v0.2.0 is purely additive.

**v0.2.0 (shipped): inline price intel.** One surface only — the **auction house** (verdict rendered only after the user expands a row). The **personal-bazaar** inline surface was intentionally cut and is **not** built (the auction house is the only page where the verdict renders); the item-market inline widget and the bazaar-list inline widget are likewise **out**. Reference pricing comes from our **own Supabase auction-history DB** (cleared comps via PostgREST) plus Torn's official **item-market API** (`/v2/market/{id}/itemmarket`) for live asking listings. The legacy weav3r data connection has been dropped — `Weav3rClient` is now unused dead code (see [ADR-0003](../adr/0003-third-party-api-exception.md)). The verdict engine is **median-of-comps + raw slope** — for each listing, take the median price of similar comps (bonus + quality within tolerance), then compare the listing's price-vs-bonus slope against the comp set's slope. No tiered "good/fair/overpriced" buckets; the badge shows the median and the slope delta and lets the user judge. Modules introduced: `DomScanner`, `PricingEngine`, `similarity`, `InlineRenderer`.

---

## Data Sources (v0.1.0)

- [x] **Torn API v2** (`https://api.torn.com/v2/`):
  - `/v2/user/log?log=4320` — auction-win entries ("Auction house item win"). The API gives **item type id only** (`data.item[0].id`), the winning bid (`data.final_price`), the seller (`data.owner`) and a `listing_id` — **no item name, no bonus**. `d.log` is an **array**; each entry carries its own `id`.
  - `/v2/torn/items` — item dictionary, fetched once and cached a week (`rwth_items`) to resolve item id → name. A fetch failure is non-fatal: names degrade to `Item #<id>`.
  - Item name (resolved from the dictionary, editable), **bonus name**, bonus *value %* and *quality* are all entered/confirmed by the user in the scan checklist — none come from the API.
- [x] **User paste** — sells are logged by pasting Torn transaction-log lines into a "Log a sale" box (see Sell logging below). No sell-side API scan.

`@grant GM_xmlhttpRequest` from v0.2.0; `@connect weav3r.dev` and `@connect btrmmuuoofbonmuwrkzg.supabase.co` are the only declared third-party hosts. See [ADR-0003](../adr/0003-third-party-api-exception.md) for the request shape, 5-minute LRU cache, and the TOS basis (advisory-only, current-page-only, user-initiated, expand-gated on auction).

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape (v0.1.0)

```js
const MEM = {
  ui: {
    open: false,            // panel visibility
    activeTab: 'ledger',    // 'ledger' | 'advertise' | 'settings'
  },

  ledger: {
    items: [],              // LedgerItem[] — see shape below
    statusFilter: 'all',    // 'all' | 'held' | 'listed' | 'sold'
    editingId: null,        // null | 'new' | itemId — add/edit form
    expandedId: null,       // null | itemId — tap-expanded row
    scanResults: [],        // un-seen auction wins from last scan (ScanHit[]), awaiting confirm
    scanMessage: '',        // transient scan feedback (e.g. "No new auction wins found.")
    scanning: false,        // a scan request is in flight
    lastScan: 0,            // epoch ms of last completed scan
  },

  advertise: {
    selectedIds: [],        // ledger item ids checkbox-selected for item-driven output
    transactions: [],       // Transaction[] — curated Recent Transactions list
    outputs: {              // last-generated output strings (shown in copy windows)
      title: '', forumHtml: '', chat: '', bazaarHtml: '', signatureHtml: '',
    },
  },

  settings: {
    playerId: '',           // drives bazaar + display-case URLs
    forumThreadUrl: '',
    weav3rPricelistUrl: '',
    bannerImageUrl: '',     // Torn-hosted bazaar banner
    forumHeaderImageUrl: '',// Torn-hosted forum header (reused for signature)
    apiKey: '',             // Torn API key (PDA injects ###PDA-APIKEY###)
  },

  fetchError: null,
};

// LedgerItem
// {
//   id: string,            // uuid
//   itemId: number|null,
//   itemName: string,
//   type: 'weapon'|'armor',
//   bonuses: [{name, value}],  // MAX 2. name from log (primary) or manual; value user-entered %
//   quality: number,           // user-entered %
//   buyPrice: number,
//   buyTimestamp: number,
//   buySource: 'auction'|'market'|'bazaar',  // auction = scanned; market/bazaar = manual +add
//   gyazoUrl: string|null,     // per-item screenshot for the forum card ([IMG] button)
//   status: 'held'|'listed'|'sold',
//   // --- sale fields, populated when a pasted sell line matches this row ---
//   saleGross: number|null,    // "$X each" from the log line
//   saleFees: number|null,     // "after $Y in fees" (0 for bazaar)
//   saleNet: number|null,      // "for a total of $Z" — authoritative net proceeds
//   soldTimestamp: number|null,
//   soldVenue: 'bazaar'|'market'|null,  // display only; not used for fee math
//   buyer: string|null,
// }

// Transaction (Recent Transactions — curated social proof, separate from the ledger)
// {
//   id: string, itemName: string, bonusName: string|null,
//   buyer: string, price: number, timestamp: number|null,
//   origin: 'paste'|'ledger',  // pasted historical sale, or promoted from a ledger sale
// }

// ScanHit (a detected auction win not yet in the ledger / not yet dismissed)
// { key: string /* log entry timestamp */, itemName, bonusName, buyPrice, buyTimestamp }
```

### Store keys (localStorage)

Prefix: `rwth_`.

| Key | Type | Purpose |
|-----|------|---------|
| `rwth_ledger` | JSON array | Persisted `MEM.ledger.items` |
| `rwth_transactions` | JSON array | Persisted `MEM.advertise.transactions` |
| `rwth_settings` | JSON object | Persisted `MEM.settings` |
| `rwth_seen_wins` | JSON array | Auction-win log entry ids already added **or dismissed** — scan dedup |
| `rwth_items` | JSON object | `{ts, map}` — item id → name dictionary, cached one week |

(Dropped from the original draft: `rwth_window_pos` — window no longer drag/resizable; `rwth_cache_*` — third-party caching is v0.2.0.)

### Constants (not settings — static, in-file)

- `BRAND` — all brand copy (see Branding below). Editable in-file; not exposed in the Settings UI.
- `ITEM_ABBREV` — display-name abbreviation map for the chat blurb (`Diamond Bladed Knife → DBK`, `Cobra Derringer → Cobra`, etc.). Static display dictionary — **not** faction data, does not violate the hardcoding ban. Seed from common Torn trade-chat usage at build time.

### Key modules / functions (v0.1.0)

| Module/Function | Owns | Notes |
|---|---|---|
| `Store` | localStorage I/O | `get(k)` / `set(k,v)`; try/catch wrapped; never throws |
| `setState` | Sole MEM mutation path | `setState(patch)` → `Object.assign(MEM, patch)` → `render()` |
| `Launcher` | Chat-row button injection | Anchors next to a native chat-header button (`#people_panel_button`, selector fallbacks) via `insertAdjacentElement('afterend')`; a `MutationObserver` on `#chatRoot` re-injects after every Torn chat re-render. **Falls back to a fixed bottom-right element** if no chat / no anchor. Never a free FAB. Approach adapted from the Enhanced Chat Buttons script (Callz/Weav3r). |
| `LogScanner` | Auction-win detection | `scan()` — manual trigger only (button); queries `/v2/user/log?log=4320` (log type **4320** = "Auction house item win"); produces `ScanHit[]` of entry ids not in `rwth_seen_wins`. Full fetch each scan — dedup is `rwth_seen_wins` only. Pure core `parseAuctionWin` + `toScanHits` in `__RwthPure`. |
| `ItemDict` | Item id → name | `ensure(key)` — fetches `torn?selections=items` once, caches in `rwth_items` for a week. Non-fatal on failure. |
| `SellParser` | Parse pasted sell lines | `parse(text) → ParsedSell[]` — handles multi-line blocks. Pure; in `__RwthPure`. |
| `matchSell` | Tie a parsed sell to a ledger row | `match(parsedSell, openPositions) → row|null` (item name; bonus name as tiebreaker). Pure; in `__RwthPure`. |
| `ROI` | Profit + ROI | `compute(item) → number` = `saleNet − buyPrice`. Log is authoritative; **no venue fee table**. Pure; in `__RwthPure`. |
| `Ledger` | Ledger item CRUD | `add()`, `update(id,patch)`, `remove(id)`, `markListed(id)`, `applySale(id, parsedSell)` — all via `setState` |
| `AdvertiseGenerator` | The 5 outputs | `toForumTitle()`, `toForumHtml(items,brand)`, `toChat(items)`, `toBazaarHtml(brand)`, `toSignatureHtml(items,brand)`. Pure; in `__RwthPure`. Output must match user templates exactly. |
| `build*` | Pure HTML builders | `buildLedgerTab`, `buildAdvertiseTab`, `buildSettingsTab` → htmlString. Pure; in `__RwthPure`. |
| `render` | DOM dispatcher | First call builds the anchored shell + delegated listeners; later calls rewrite `#rwth-content` via `innerHTML`. |

### Test seam

`globalThis.__RwthPure` exports all pure functions (`SellParser.parse`, `matchSell`, `ROI.compute`, every `AdvertiseGenerator.*`, every `build*`). A Node shim stubs `localStorage` / `document` and `require`s the `.user.js` directly — tests run shipped code. Runner: `node:test`. See [ADR-0002](../adr/0002-rwth-pure-test-seam.md).

### Render contract

- `render(MEM)` is the only impure dispatcher; everything below it is pure.
- First call builds the anchored panel shell + delegated listeners on a stable container.
- Subsequent calls rewrite `#rwth-content` via `innerHTML = buildContent(MEM)`.
- `setState(patch)` is the sole mutation path. No call site sets `MEM.foo = bar` directly.
- Do not `render()` while a form input is focused mid-typing — only on submit/cancel.

---

## UI

### Launcher & window

- Launcher = a button injected into Torn's **chat-icon row**, styled to look like a native chat icon (the `NC17` mark or a small icon). Selector fallbacks; degrades to a fixed bottom-right anchored element if the chat bar can't be found (covers Torn DOM changes and PDA).
- Clicking it opens an **anchored, fixed-size panel** that expands upward from the corner — same gesture as opening a chat window. No drag, no resize, no position persistence. Full-width on PDA.

### Tabs

| Tab | Contents |
|-----|----------|
| **Ledger** | Item list (compact rows, status filter); `+ add` manual button; `Scan` button + scan-result checklist; `Log a sale` paste box |
| **Advertise** | Item checkbox-selection; Recent Transactions editor; the 5 output windows (each with a copy-to-clipboard button) |
| **Settings** | `playerId`, `forumThreadUrl`, `weav3rPricelistUrl`, `bannerImageUrl`, `forumHeaderImageUrl`, `apiKey` |

### Ledger row

Compact single line, **tap-to-expand**:
- **Collapsed:** item name + bonus · buy price · status (held/listed/sold; shown as ROI once sold).
- **Expanded:** quality, buy date, buy source, and actions — `[mark listed]`, `[Log sale]`, `[IMG]`, `[edit]`, `[delete]`.

### Auction-win scan flow

1. User clicks `Scan` (manual only — no scan-on-open, no background poll).
2. `LogScanner` queries the auction-win log category, filters out keys in `rwth_seen_wins`.
3. Panel shows a **checklist** of detected wins not yet added.
4. User checkbox-selects which to add; for each selected win, enters **quality %** and **bonus value %** (numeric inputs, not sliders — precision) and optionally a **second bonus** (name + value; max 2 bonuses total).
5. On confirm: selected wins become `held` ledger rows; **all shown wins** (added or not) are written to `rwth_seen_wins` so they don't reappear. `+ add` is the escape hatch for a dismissed win.

### Sell logging (paste-to-log)

User pastes one or more Torn transaction-log lines into the "Log a sale" box. `SellParser` handles a multi-line block; per line it extracts timestamp, item name, bonus name, venue, buyer, gross/fees/net. Line grammar to support:

- optional `anonymously`
- `sold a` **and** `sold a pair of` (strip article/quantifier for the item name)
- venue: `on your bazaar` | `on the item market`
- `at $X each for a total of $Y` — `$Y` ("total") is the **net proceeds**
- optional ` after $Z in fees` (absent for bazaar = 0% fee)
- timestamps on their own interleaved lines — best-effort association; null if none adjacent

Per parsed sell:
- **Matches an open `held`/`listed` ledger row** (by item name; bonus name disambiguates) → close it: `status: 'sold'`, store `saleGross`/`saleFees`/`saleNet`/`soldTimestamp`/`soldVenue`/`buyer`. ROI = `saleNet − buyPrice`. Offer one-click "add to Recent Transactions".
- **No match** (pre-ledger historical sale) → straight into Recent Transactions as social proof; never touches the ledger.

The confirmation step shows a parsed summary ("N sales parsed, M matched, K → Recent Transactions") before committing.

### Advertise — five outputs

Each renders into a windowed copy box with a copy-to-clipboard button.

| # | Output | Type | Image |
|---|--------|------|-------|
| 1 | Forum title | static brand | — |
| 2 | Forum post HTML | item-driven (`listed` items selected) + Recent Transactions | forum header #2 + per-item `[IMG]` shots |
| 3 | Trade-chat blurb | item-driven; uses `ITEM_ABBREV`; auto-default then user edits in the window | — |
| 4 | Bazaar description HTML | static brand | bazaar banner |
| 5 | Profile signature HTML | item-driven, condensed | forum header #2 (reused) |

- **Currently Available** in the forum post = hand-picked `listed` rows via `selectedIds` checkboxes (default-checked: all `listed`).
- **Recent Transactions** = the curated `transactions` list — editable on the Advertise tab, seeded by pasted historical sales and optionally fed by promoted ledger sales. Buyer name is kept (it is the verifiable proof).
- Chat blurb: generator truncates names, applies `ITEM_ABBREV` for known items, defaults parens to the bonus — user tweaks the output text directly before copying.
- `[IMG]` button per ledger row → floating textbox to paste a screenshot URL (gyazo or Torn-hosted); injected into the forum card. Item-shot images are per-item; the two brand banners are Torn-hosted and set once via Settings.

---

## Branding

**Customizable branding for the user.** Branding is no longer a fixed `NC17` identity — every brand-bearing field is user-configurable through the Advertise tab's "Brand & look" section (shop-identity config, #316). The script ships **neutral placeholder defaults**; the user's overrides persist and flow into all five Advertise outputs. (The old hardcoded `NC17` wordmark / MPAA-rating gag is retired and no longer present in the code.)

| `BRAND` field | Source |
|---|---|
| Mark / shop name | User-set in Brand & look (neutral default ships) |
| Bazaar name (Torn field) | User-set |
| Forum thread title | User-set |
| Footer / flavor line | User-set, editable post copy |
| ~~Subtitle~~ | Dropped 2026-05-21 — panel header reads `RW Trading Hub` + version, no brand subtitle |
| Display-case line | Editable; display-case URL derived from `playerId` |

- **Graphics are made externally**, not generated by the script — the user supplies their own banner / forum-header images (URLs configured per surface). Only the user's own wordmark + evergreen flavor go in images.
- **Functional/editable text** (titles, prices, links) lives in HTML or Torn fields, not in images.
- Bazaar description generator must use the **forum HTML font scheme** (`Verdana` body, `Consolas`/monospace accents) — not the all-`Courier New` of the current bazaar markup (light/dark readability fix).

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| RW item | Ranked-war weapon or armor (bonus-bearing) | "war item", "PvP item" |
| Ledger | Persistent record of bought / listed / sold RW items the user owns | "inventory", "log" |
| Held / Listed / Sold | Ledger item status states | "open", "active", "closed" |
| Scan | Manual button → detect auction wins from the Torn log | "poll", "sync" |
| Scan checklist | The post-scan list of detected wins the user selects from | "queue", "inbox" |
| Log a sale | Pasting a transaction-log line to close a ledger row | "mark sold", "record sale" |
| Recent Transactions | Curated social-proof list of past sales, separate from the ledger | "sales history", "sold tab" |
| Advertise | Generating the five copy-paste outputs | "post", "share", "broadcast" |
| ROI | `saleNet − buyPrice`; `saleNet` is the log's authoritative after-fees total | "net profit", "real profit" |
| Bonus | Up to 2 per item; `{name, value}`; name from the log, value user-entered | — |
| Inline intel | The deferred v0.2.0 per-page price-comparison feature | — |

---

## Active State

- **Version:** 0.1.11 (slice 4 done — auction-win scan: manual `Scan` button, `LogScanner.scan()` via `/v2/user/log?log=4320`, item-name resolution via `ItemDict`/`rwth_items` (`/v2/torn/items`), full-fetch + `rwth_seen_wins` dedup, scan-result checklist with per-win name/bonus/quality inputs, confirm → `held`/`auction` ledger rows, errors via `MEM.fetchError`)
- **Design:** locked (grill complete 2026-05-21)
- **Open issues:** #246–#248 (#242–#245 done)
- **Next up:** slice 5 — #246 sell logging
- **Tests:** `node test-rwth.js` — Node shim requires the shipped `.user.js`, asserts the `__RwthPure` seam
- **Build-time TODO:** seed `ITEM_ABBREV` from common Torn trade-chat abbreviations; user to finalise the footer-line wording.

---

## ADRs

- [ADR-0002](../adr/0002-rwth-pure-test-seam.md) — pure functions exposed via `globalThis.__RwthPure` for Node testing
- [ADR-0003](../adr/0003-third-party-api-exception.md) — third-party-API exception for v0.2.0 inline price intel (weav3r + Supabase)

---

## Notes / Gotchas

- **Chat-bar injection** is Torn DOM the script doesn't own. The launcher anchors next to `#people_panel_button` and a `MutationObserver` on `#chatRoot` re-injects after every chat re-render (Torn rebuilds the chat DOM constantly — without the observer the button vanishes). Selector fallbacks + the fixed-corner fallback keep the launcher reachable on Torn DOM changes / PDA. Do **not** append the launcher directly to `#chatRoot` — it flows at page top.
- **Scan is manual-only.** No background poll, no scan-on-open. Each scan fetches the full auction-win log; `rwth_seen_wins` stops added/dismissed wins from re-nagging. (No incremental cursor — a poisoned cursor silently dropped wins.)
- **The log only carries the primary bonus name** and no bonus value / quality — the user supplies value % + quality and any second bonus at add time.
- **ROI uses the log's stated net** — the sell line states fees exactly, so there is no venue fee table. `soldVenue` is display-only.
- **Forum / bazaar HTML must match the user's templates exactly** — see `rwth-assets.md` (source of truth for markup).
- **Mug risk** ($10M+ listings) is not surfaced as a feature unless the user asks.
