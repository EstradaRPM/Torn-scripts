# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-27 (Step A done)_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/rw-auction-tool-next-step-A2b3A`
**Version:** `1.22.0`

### Completed steps

| Step | Description | Version |
|------|-------------|---------|
| 1 | Inline advisory strip — replaced floating panel with per-`<li>` injection | 1.17.0 |
| 2 | `▼ Details` expandable context panel per listing | 1.18.0 |
| 3 | Market/Bazaar split-column comp panel (top-5, live fetch, staleness) | 1.19.0 |
| 4 | Settings modal polish — Data Sources section, API key mask/reveal, error feedback | 1.20.0 |
| 5 | Ledger framework scaffold — Log button, sidebar panel, localStorage persistence | 1.21.0 |
| 6 | CLAUDE.md documentation + memory.md final update | 1.21.1 |
| **A** | **Result capture dropdown — —/Won/Lost/Passed per ledger row; delegated change listener persists to localStorage** | **1.22.0** |

### Key function locations

| Symbol | Line (approx) | Notes |
|--------|---------------|-------|
| `computeListingMetrics(l)` | ~1300 | Returns bbFloor, maxOffer, netProfit, roi, signalColor |
| `injectAdvisoryStrip(listing)` | ~1340 | Builds `.rwa-strip`, wires all 4 buttons |
| `buildContextPanel(listing)` | ~1500 | Returns `.rwa-context` div with 5 metric rows |
| `buildCompsPanel(listing)` | ~1550 | Returns `.rwa-comps` 2-column panel with `_refreshCol` / `_isStale` |
| `logListing(listing)` | ~1645 | Snapshots listing into MEM.ledger, persists |
| `renderLedger()` | ~1665 | Rebuilds ledger table from MEM.ledger; renders result dropdown per row |
| `refreshDataSources()` | ~1700 | Populates Data Sources section in settings modal |
| `renderInline()` | ~1635 | Re-runs injectAdvisoryStrip for all listings |
| `init()` | ~1760 | Main data pipeline: parse → BB rate → comps → enrich → render |
| `safeInit()` | ~1790 | MutationObserver debounce wrapper with 30s cooldown |
| ledgerBody change listener | ~1308 | Delegated handler for `.rwa-result-select`; updates entry.result + persists |

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

---

## Open Questions / Blockers

- None. Step A is committed and pushed.
- Future ledger features (Steps B–E) are documented in `CLAUDE.md` under "Future ledger steps".

---

## Concrete Next Steps

1. **Step B — P&L calculation (→ 1.23.0)**: For `result === 'Won'` rows, add an "Actual sell price" input. On blur/enter compute `actualNet = sellPrice × (1 − marketFee) × (1 − mugBuffer) − entry.currentBid`. Persist `actualSellPrice` and `actualNet` to the entry schema.
2. **Step C — CSV export (→ 1.24.0)**
3. **Step D — Filtering (→ 1.25.0)**
4. **Step E — Summary stats (→ 1.26.0)**

---

## Memory System Protocol

After every committed step, update this file before the user approves the next step.
Required sections: Current WIP, Key Decisions, Open Questions, Concrete Next Steps.
Update the `_Last updated_` date at the top.
