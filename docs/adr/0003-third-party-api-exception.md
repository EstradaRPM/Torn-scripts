# RW Trading Hub talks to weav3r and a Supabase pricelist for inline price intel

## Context

Every other userscript in this repo, and v0.1.0 of the RW Trading Hub itself, runs `@grant none` and only ever talks to `api.torn.com`. That rule has paid for itself: zero CORS surprises, no host allow-list to maintain, no third-party that can break the script by going down or changing a contract, and a TOS posture that is trivial to defend ("the script only reads what Torn already shows me").

v0.2.0 cannot keep that rule. Inline price intel scores a listing against reference pricing; that pricing does not exist inside the Torn API. The only sources that hold it are:

- **weav3r.dev** — community-built RW market dashboards. Pages like `/ranked-weapons?tab=armor&armorSet=Riot` return live aggregated armor/weapon comps.
- **btrmmuuoofbonmuwrkzg.supabase.co** — a Supabase project hosting the user's own pricelist / historical sales as a second reference source.

A page-side `fetch()` to either host is blocked by Torn's CSP. The only way for a userscript to reach them is `GM_xmlhttpRequest`, which requires switching `@grant none` → `@grant GM_xmlhttpRequest` and declaring each host as `@connect`. That switch is a one-way door — once the script is permitted to call the open internet, the self-contained guarantee is gone — so it gets an ADR before any feature code touches it.

## Decision

The Hub is permitted to call exactly two third-party hosts, via `GM_xmlhttpRequest` only, under the constraints below.

**Allowed hosts** (declared in the userscript header as `@connect`):

- `weav3r.dev`
- `btrmmuuoofbonmuwrkzg.supabase.co`

**Request shape:**

- Method: `GET` only. The script never `POST`s, `PUT`s, or `DELETE`s to either host — it is read-only.
- Headers: no Torn API key, no Torn cookies, no user-identifying header. weav3r is hit as an anonymous page request; Supabase uses its own anon key embedded in the script.
- Body: none.
- One request per listing batch per surface render — never one request per row.

**Caching:**

- Responses are cached in `localStorage` under `rwth_cache_<host>_<key>` as a 5-minute LRU. A cache hit short-circuits the fetch entirely.
- A failed fetch is non-fatal: the affected row simply shows no verdict and the cache is not poisoned.

**TOS basis** — the four guard-rails that keep this advisory-only:

1. **Advisory-only.** The script displays a verdict next to a row. It never auto-buys, auto-bids, or writes anything to Torn.
2. **Current-page-only.** DOM scanning and third-party fetches happen only for the page the user has actively loaded in the foreground. No background scraping, no unfocused tabs.
3. **User-initiated.** Every fetch is downstream of a page the user manually navigated to. There is no poll, no timer, no prefetch.
4. **Expand-gated on the auction page.** Auction rows fetch and render a verdict only after the user expands the row — never on the bulk auction list. The item market and bazaar surfaces render on the visible rows of the page the user loaded.

## Consequences

- The `@grant none` invariant from v0.1.0 is gone. Future readers who assume "this script only talks to Torn" are wrong from 0.2.0 onward — they need to read this ADR.
- The two `@connect` entries are the script's complete third-party allow-list. Adding a third host needs a new ADR (or an amendment to this one), not a one-line header tweak.
- Userscript managers will surface the `GM_xmlhttpRequest` permission to the user on install/update. That is a feature, not a bug — it is the user's chance to refuse the new capability.
- Test seam: `GM_xmlhttpRequest` joins `localStorage` / `document` / `window` in the Node shim's stub list (ADR-0002). The pure `PricingEngine` verdict math stays testable; the fetch shell stays out of the test surface, same pattern as `LogScanner`.
- If either host goes down, the affected verdicts disappear gracefully. The ledger and Advertise tabs are unaffected — they do not touch the network.

## Alternatives rejected

- **Keep `@grant none`, ask the user to paste pricing in.** Pricing goes stale in minutes; pasting defeats the entire point of *inline* intel.
- **Proxy through a single allow-listed host we control.** Adds an operational dependency (a server to host, monitor, and pay for) to a zero-dependency userscript repo. The two-host allow-list is cheaper and more honest about what the script actually reads.
- **Use `fetch()` and rely on CORS.** Blocked by Torn's CSP on `torn.com` pages; this is precisely why `GM_xmlhttpRequest` exists.
