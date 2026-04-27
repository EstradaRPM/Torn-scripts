# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (Step B done)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/rw-auction-tool-next-step-A2b3A`
**Version:** `1.23.0`

### Completed steps

| Step | Description | Version |
|------|-------------|---------|
| 1 | Inline advisory strip | 1.17.0 |
| 2 | `▼ Details` expandable context panel | 1.18.0 |
| 3 | Market/Bazaar split-column comp panel | 1.19.0 |
| 4 | Settings modal polish | 1.20.0 |
| 5 | Ledger framework scaffold | 1.21.0 |
| 6 | CLAUDE.md documentation + memory.md | 1.21.1 |
| A | Result capture dropdown — —/Won/Lost/Passed per row | 1.22.0 |
| **B** | **P&L — actualSellPrice input (Won rows only), actualNet computed on blur/Enter, in-place span update** | **1.23.0** |

### Key function locations

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `computeListingMetrics(l)` | ~1300 | Returns bbFloor, maxOffer, netProfit, roi, signalColor |
| `injectAdvisoryStrip(listing)` | ~1340 | Builds `.rwa-strip`, wires all 4 buttons |
| `buildContextPanel(listing)` | ~1500 | Returns `.rwa-context` div with 5 metric rows |
| `buildCompsPanel(listing)` | ~1550 | Returns `.rwa-comps` 2-column panel with `_refreshCol` / `_isStale` |
| `logListing(listing)` | ~1695 | Snapshots listing into MEM.ledger; schema includes actualSellPrice/actualNet |
| `renderLedger()` | ~1715 | Rebuilds ledger table; Won rows get sell-price input + data-anet-id span |
| `commitSellPrice(input)` | ~1322 | Computes actualNet, persists, updates data-anet-id span in-place |
| `refreshDataSources()` | ~1750 | Populates Data Sources section in settings modal |
| `renderInline()` | ~1685 | Re-runs injectAdvisoryStrip for all listings |
| `init()` | ~1810 | Main data pipeline: parse → BB rate → comps → enrich → render |
| `safeInit()` | ~1840 | MutationObserver debounce wrapper with 30s cooldown |
| ledgerBody change listener | ~1310 | result-select: updates entry.result, clears P&L if not Won, calls renderLedger() |
| ledgerBody blur listener (capture) | ~1337 | Delegates to commitSellPrice for .rwa-sell-input |
| ledgerBody keydown listener | ~1342 | Enter on .rwa-sell-input commits + blurs |

### DOM structure (final)

```
#rwa-gear-cluster          fixed bottom-right
  #rwa-error-toast           shown via .rwa-visible
  #rwa-refresh-btn           ↻ spins via .rwa-spinning
  #rwa-ledger-btn            ☰ toggles ledger sidebar
  #rwa-gear-btn              ⚙ opens settings modal

#rwa-ledger-panel           fixed full-height sidebar; slides in via .rwa-ledger-open
  .rwa-ledger-hdr
    #rwa-ledger-clear        wipes MEM.ledger + localStorage
    #rwa-ledger-close
  #rwa-ledger-body           renderLedger() target

#rwa-settings-modal         native <dialog>
  .rwa-modal-body
    API / Pricing / Data Sources / Comp Tolerances sections
  .rwa-modal-footer

.rwa-strip                  per auction <li>
  .rwa-strip-main
    .rwa-strip-offer         Max Offer + ROI %
    .rwa-strip-actions       ▼ Details | Market | Bazaar | Log
  .rwa-context               toggled via .rwa-open (one at a time)
  .rwa-comps                 market col + bazaar col, each toggled independently
```

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Native `<dialog>` for settings modal | Handles Escape + backdrop automatically |
| `computeListingMetrics()` as standalone helper | Reused by strip, context panel, log snapshot — no duplicated pricing logic |
| Function declarations (not const arrows) for render/build fns | Hoisted within IIFE — safe to reference from event handlers defined earlier |
| `buildCompsPanel._refreshCol()` / `._isStale()` as panel-attached methods | Keeps fetch logic co-located with the panel it modifies; avoids closure over strip |
| Step size limit: ~50–80 lines per edit | Prevents API stream idle timeout; each sub-step is a self-contained commit |
| Delegated `change` listener on `ledgerBody` for result select | Container persists across `innerHTML` resets — no need to re-attach on each renderLedger call |
| `sel.value || null` for result storage | Empty string (—) stored as null for consistent `!e.result` checks |
| In-place `data-anet-id` span update (no full re-render on sell price commit) | Preserves scroll position; full re-render only needed when result dropdown changes (show/hide input column) |
| Clear actualSellPrice/actualNet when result switches away from Won | Prevents stale P&L data on result edit |

---

## Open Questions / Blockers

- None. Steps A and B are committed and pushed.

---

## Concrete Next Steps

1. **Step C — CSV export (→ 1.24.0)**: "Copy CSV" button in ledger header. Serialize all MEM.ledger entries to CSV (header + one row per entry, all columns). Copy via `navigator.clipboard.writeText()`. Brief "Copied!" label reset after 2s.
2. **Step D — Filtering (→ 1.25.0)**
3. **Step E — Summary stats (→ 1.26.0)**

---

## Memory System Protocol

After every committed step, update this file before the user approves the next step.
Required sections: Current WIP, Key Decisions, Open Questions, Concrete Next Steps.
Update the `_Last updated_` date at the top.
