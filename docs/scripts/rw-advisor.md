# RW Auction Advisor

> **Status:** PARKED at v1.33.1
> **File:** `torn-rw-auction-advisor-v1.user.js`
> **Target page:** `https://www.torn.com/amarket.php`
> **Current version:** 1.33.1

## PARKED

Do not modify this script until the user explicitly resumes it. When they do:

1. Run `/grill-me` before writing any code
2. Read all reference docs listed under **Reference Docs** below
3. Check GitHub Issues for open RW advisor tickets

---

## Purpose

Auction house advisor for Riot Weapon and Assault armor items. Evaluates each listed item's flip potential using buyback floor pricing, market comps, quality scoring, and a configurable target margin. Surfaces buy/pass recommendations directly on the auction market page.

## Data Sources

- Torn API v2 (`https://api.torn.com/v2/`) — item listings, auction data
- Page DOM (`torn.com/amarket.php`) — live auction prices, item details
- TornW3B (`https://weav3r.dev/api`) — unconditional, no opt-in

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  listings: [],    // current auction listings from DOM + API
  bbFloor: {},     // Map<itemId, price> — buyback floor prices
  comps: {},       // Map<itemId, CompData> — market comp data from TornW3B
  fetchError: null,
  lastFetch: 0,
};
```

### Store keys (localStorage)

Namespace prefix: `rwadv_`

| Key | Type | Purpose |
|-----|------|---------|
| `rwadv_margin` | number | Target flip margin % |
| `rwadv_quality_weights` | JSON | Per-stat quality scoring weights |

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| **BB Floor** | Buyback price — minimum Torn will pay for the item; hard price floor | buyback, base price |
| **Comp** | Comparable market listing used to estimate resale ceiling | comparable, market price |
| **Quality Score** | Weighted score of an item's stat bonuses, normalized 0–100 | rating, grade |
| **Target Margin** | User-configured minimum profit % required to show a buy recommendation | threshold, cutoff |

---

## Reference Docs

Read all of these before touching this script:

- `docs/rw-pricing-logic.md` — fee structure, formulas, effective sell-side take rate
- `docs/rw-api-reference.md` — Torn API v2 endpoints and response shapes for RW items
- `docs/rw-armor-guide.md` — RW/armor item taxonomy, stat definitions, quality tiers
- `docs/rw-community-context.md` — market conventions and community pricing norms
- `docs/prd-steps-i-through-l.md` — planned PRD steps not yet implemented

---

## Active State

- **Version:** 1.33.1 (parked)
- **Parked reason:** Pricing engine redesign completed at v1.33.1. Ledger UI requires a `/grill-me` design session before implementation begins.
- **Next step when resuming:** `/grill-me` on ledger UI design first — no code before that session completes

---

## Notes / Gotchas

- TornW3B calls fail silently on Torn PDA (same CSP issue as snipe tracker) — expected behavior, not a bug.
- Auction house fee (3%) differs from item market fee (5%) — see `docs/rw-pricing-logic.md`.
- Quality scoring weights are user-configurable — do not bake in defaults from the armor guide without user confirmation.
