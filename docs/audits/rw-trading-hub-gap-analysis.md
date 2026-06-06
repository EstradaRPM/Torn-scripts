# RW Trading Hub — Gap Analysis

> Audit pass: identify real, code-verified gaps in the **live** script (no fixes, no implementation detail).
> Subject: `TORN-RW-trading-hub.user.js` @ `v0.3.87` (8159 lines, single IIFE).
> Source of truth: the **shipped code**, read directly. Corrected 2026-06-05 after an earlier draft asserted findings that the code disproves.

## Authority

The **live `v0.3.87` script is the only source of truth.** The v0.1.0 design doc, the coverage matrix's "divergence" language, ADR-0003, and the stale Store-key/host tables carry **no** weight over shipped behavior — where they disagree with the code, the docs are wrong (housekeeping), not the code. Every item below was read in the code before being listed.

## Three findings from the first draft were wrong — removed

The earlier pass speculated instead of reading. Corrected against the code:

- **Recent Transactions is NOT manually promoted.** `commitSells` (3953–3981) auto-adds every parsed sale to Recent Transactions on sale-log; `sellToTx` builds the record, logs are the stated source of truth. No manual step. *Not a gap.*
- **Ad generation is NOT high-effort.** The Advertise tab is robust and close to intended (user-confirmed). No fabricated "time-to-first-ad" problem. *Not a gap.*
- **The price-check / auction badge already shows confidence.** `renderAuctionBadge` (6608–6628) shows the comps-used count, the `±tolerance% bonus` band, a dedicated **"Few sales"** thin-confidence tier, asking count + median, projected price at quality, and bazaar floor. *Confidence is already surfaced — not a gap.*

Also reaffirmed as intentional features (not gaps): personal-bazaar inline was deliberately cut (auction-only by design, `AuctionScanner` guard 7847); branding is fully user-configurable (#316); **click-to-activate intel** (price check / item-market comp fires only on click, like expanding an auction row) is deliberate API-spend control and an advertisable selling point.

---

## Prioritized gap list (code-verified only)

| # | Gap | Type | Severity |
|---|-----|------|----------|
| 1 | **The Ledger UI is thin** — logged-item rows lack the context a trader's workbench wants. Velocity/days-to-clear is recorded (`VelocityTracker.recordSale`, 3970) and per-class baselines exist, but the ledger rows never show it. *(User-directed: "the ledger itself leaves a lot to be desired"; dashboard is fine.)* | missing surfacing | **High** |
| 2 | Deduction double-count (~5%) in the buy-max math — `auctionPlan` deducts the ~20% cut off `ladder.bazaar = market ÷ 1.05`, double-counting ~5%. *(User's own open item; fix not approved — wants to challenge the logic.)* | comparison / logic | **High** |
| 3 | No trusted regression net — tests copy function bodies instead of importing the `__RwthPure` seam (8075), so they drift; the gate is disavowed for cost. Correctable. | tooling | **Medium-High** |
| 4 | `Weav3rClient` (5048) is dead code — never called; live listings come from Torn `/v2/market/{id}/itemmarket`. `@connect weav3r.dev`, `WEAV3R_API` (4858), and `smokeWeav3r` (1827) service only this dead path. | redundancy | **Medium** |
| 5 | Vestigial `bazaar: []` — `ListingsFetcher` always returns an empty bazaar array (Torn removed the API, 5079); the #300 floor cross-check silently degrades to nothing on its side. | outdated logic | **Low-Medium** |
| 6 | Docs lag the live code (ADR-0003 names weav3r as live; Store-key/host tables stale — live Supabase host `kozewwpyssyzuyksnoqu` vs documented old host). Housekeeping, not a product gap. | doc housekeeping | **Low** |
| 7 | Pricing-brain intel is off by default behind a Settings toggle (`ledgerIntelOn`, 805); nothing in the Ledger hints that enabling it adds per-row price checks. One-time first-run discovery. | missing surfacing | **Low** |

---

## Findings by category

### Missing surfacing

- **The Ledger UI is the real gap (user-directed).** The dashboard is good; the per-row ledger is thin. Velocity is the clearest example — a full subsystem (`VelocityTracker`, persisted `rwth_velocity_log`, per-class baselines, recorded at 3970) with **no home on the ledger row**, even though each row already carries `buyTimestamp`→`soldTimestamp`. The direction is an **expanded ledger row with added context** (days-to-clear among it), not a new tab and not more dashboard.
- **Pricing brain is off by default** (`ledgerIntelOn` gates the price-check button at 805) with no in-Ledger hint that enabling it unlocks per-row price checks. Minor first-run discovery only.

### Comparison / pricing logic

- **Buy-max may be ~5% low.** The `auctionPlan` deduction double-count (memory: `project-deduction-anchor-rule`) is the one open correctness question on the headline number. User wants to challenge the logic; fix not approved — standing item, not closed.
- Confidence display is **already adequate** (comps-used, tolerance band, "Few sales" tier, asking count, projection, floor) — explicitly not flagged.

### Redundancy

- **`Weav3rClient` dead code** (5048, exported at 8106, never invoked). The `@connect weav3r.dev` host, `WEAV3R_API` constant, and `smokeWeav3r` diagnostic exist only for it. (The separate weav3r **price-list link** in ad outputs, `resolveWeav3rUrl` 1679, is a live, intentional feature and stays.)
- **Tests duplicate the implementation** — every `test-*.js` copies function bodies ("keep in sync with the IIFE", `test-pricing-engine.js:3`) rather than importing the `__RwthPure` seam that already exports them. Two sources of truth, guaranteed drift.

### Outdated logic

- **`bazaar: []` is vestigial** — threaded through the fetch/merge shape but always empty (5079–5083); the #300 floor cross-check's bazaar side silently no-ops rather than being removed.
- Deduction double-count (above) is also outdated/incorrect logic.

### Data flow

- **Items-dict warm race** — `ListingsFetcher._resolveItemId` (5134) returns `null` until the dict warms, dropping a price check to auction-only comps with no user-visible "still warming" note. Edge case, minor.
- **Doc/code host drift** — live `@connect` Supabase host differs from documented host. Housekeeping.

### Error handling

- Per-feature typed states are actually **good** (loading / error / no-comp / skipped-trash all present across badge, price-check, scan, sell). No unified status surface, but that's acceptable for a userscript — not elevated.
- **Test gate disavowed** (see Redundancy). Correctable by wiring tests to the `__RwthPure` seam + a single runner, so a fix touches one source of truth — not a reason to keep shipping an untrusted file.

---

## Most damaging issues

1. **Buy-max may be ~5% low** (deduction double-count). The core promise is "the right max bid"; a known error in that number is the biggest trust risk. *Your open item to challenge.*
2. **The Ledger UI is thin.** The dashboard is strong but the per-row ledger under-delivers for a trader's workbench — velocity has no home there, and you've said it leaves a lot to be desired. This is the clearest product-improvement direction.
3. **No trusted regression net.** Disavowed, drifting tests mean a pricing regression (incl. #1) can ship unseen. Correctable via the existing seam.

> Reaffirmed as features, not bugs: click-to-activate intel (API-spend control + selling point), auction-only inline scope, configurable branding, auto-filled Recent Transactions. Scope note: this pass identifies and ranks only — no implementation proposed.
