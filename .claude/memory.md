# Claude Session Memory — Torn Scripts

_Last updated: 2026-04-26_

---

## Current WIP

**File:** `torn-rw-auction-advisor-v1.user.js`
**Branch:** `claude/inline-auction-advisor-MxQCI` → PR #138 → `main`
**Version:** `1.17.0`
**Active plan file:** `/root/.claude/plans/analyze-the-torn-rw-auction-advisor-js-playful-gray.md`

### Step currently completed: Step 1 — Inline advisory strip

All floating panel code has been removed and replaced with inline injection per auction listing. Verified working.

### Key line numbers (post-Step 1)

| Symbol | Line | Notes |
|--------|------|-------|
| `parseAuctionListings()` | ~827 | Added `el: li` to each result object |
| `computeListingMetrics(l)` | ~1188 | New — computes bbFloor, maxOffer, netProfit, roi, signalColor |
| `injectAdvisoryStrip(listing)` | ~1228 | New — removes old strip, builds `.rwa-strip`, appends to `listing.el` |
| `renderInline()` | ~1264 | New — calls `showError()` + `injectAdvisoryStrip()` for all listings |
| `showError(msg)` | ~1130 | New — shows/hides `#rwa-error-toast` in gear cluster |
| `enrichListingsFromMarketData()` | ~1446 | Unchanged logic; stale comment updated |
| `init()` | ~1540 | Updated: all `render()` calls → `renderInline()`; error msg updated |
| `safeInit()` | ~1564 | Updated: `refreshBtn` → `rwaRefreshBtn`; `rw-spinning` → `rwa-spinning` |

### New DOM structure (injected by script)

```
#rwa-gear-cluster          fixed bottom-right; contains:
  #rwa-error-toast           hidden by default; shown via .rwa-visible
  #rwa-refresh-btn           ↻ spins during init via .rwa-spinning
  #rwa-gear-btn              ⚙ opens settings modal

#rwa-settings-modal        native <dialog>; all original settings fields preserved
  .rwa-modal-header
  .rwa-modal-body            API key, Pricing, Comp Tolerances sections
  .rwa-modal-footer          version + data disclosure line

.rwa-strip                 injected as last child of each auction <li>
  .rwa-strip-main
    .rwa-strip-offer         Max Offer label + value (green/red) + ROI %
    .rwa-strip-actions       ▼ Details | Market | Bazaar | Log  ← UNWIRED (stubs)
```

### Removed in Step 1

- `#rw-panel` floating panel (CSS, HTML, element refs, tabs, collapse logic)
- `render()` function (145-line table renderer)
- Drag code (`clampPos`, `applyPos`, `savePos`, all mouse/touch handlers)
- `KEYS.COLLAPSED`, `KEYS.POSITION`
- `MEM.collapsed`, `MEM.position`

---

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| Native `<dialog>` for settings modal | Handles Escape key and backdrop automatically; no z-index fighting with Torn's own modals |
| `computeListingMetrics()` extracted as standalone helper | Steps 2 and 3 will reuse it for the context panel and comp panel without duplicating pricing logic |
| Function declarations for `renderInline`, `injectAdvisoryStrip`, `computeListingMetrics` | Hoisted within IIFE — safe to reference in event handlers defined earlier in the file |
| `escHtml()` applied to inline style color values | Defensive; signalColor is derived from internal logic but keeps XSS surface area at zero |
| Step 1 split into 6 sub-steps (1a–1f) | Required after API stream idle timeout on large single-write attempts; each sub-step is a self-contained commit |
| Placeholder buttons rendered but unwired | Avoids partial-feature commits; each button gets wired in its designated step |

---

## Open Questions / Blockers

- None currently blocking. All design decisions for Steps 2–5 are settled in the plan file.
- Step 3 (comp panel) will need to decide whether Market and Bazaar panels can both be open simultaneously per listing, or exclusive — plan says simultaneous is fine.

---

## Concrete Next Steps

Follow the 6-step plan in `/root/.claude/plans/analyze-the-torn-rw-auction-advisor-js-playful-gray.md`.
Each step requires user confirmation before starting.

### Step 2 — Expandable ROI/context panel (version → 1.18.0)
Wire the `▼ Details` button per listing to toggle a `.rwa-context` panel inside the `<li>` showing:
- BB floor (rarity-colored)
- Market comp price + source badge (`interp` / `floor` / `ceil` / `~`)
- Quality score + tier badge (`EXCEP` / `HQ`)
- King's cap warning (amber `!` badge) if applicable
- Net profit value

Only one context panel open at a time (opening one collapses any other). Toggle via CSS class, no re-render.

### Step 3 — Comp listings split-column panel (version → 1.19.0)
Wire `Market` and `Bazaar` buttons to fetch and display top-5 lowest-priced comps from each source in a two-column `.rwa-comps` panel. Loading spinner per column, cache staleness timestamp.

### Step 4 — Settings modal polish (version → 1.20.0)
Add Data Sources section (cache freshness per data type), API key mask/reveal on focus, full field validation feedback.

### Step 5 — Ledger framework scaffold (version → 1.21.0)
Add `KEYS.ledger = 'rw_ledger'` and `MEM.ledger = []`. Wire `Log` button to snapshot listing data. Ledger sidebar panel with table skeleton (Date | Item | Rarity | Q% | Bonus% | Score | Bid | Max Offer | ROI | Result). Result column empty — future.

### Step 6 — CLAUDE.md future ledger steps + final cleanup (version → 1.21.1)
Document 5 remaining ledger features in CLAUDE.md (result capture, P&L, CSV export, filtering, summary stats). Final version bump and cleanup.

---

## Memory System Protocol

After every committed step, update this file before the user approves the next step.
Required sections: Current WIP, Key Decisions, Open Questions, Concrete Next Steps.
Update the `_Last updated_` date at the top.
