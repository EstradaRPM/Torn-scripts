# RW Trading Hub Current Handoff

This is the current handoff for `TORN-RW-trading-hub.user.js`.

## Status

- Active script: `TORN-RW-trading-hub.user.js`
- Current version in source: `0.3.131`
- Current development goal: finish the RW Trading Hub script without stale docs, old audits, or broad test runs hijacking the work.
- Current implementation authority: the shipped userscript, then focused tests that import the shipped userscript through `globalThis.__RwthPure`.

## What this script is

RW Trading Hub is a standalone Tampermonkey/Torn PDA userscript for ranked-war trading work:

- Ledger for held/listed/sold items.
- RW-only log scanning for auction wins, sales, simple trades, and clear mug events, plus manual/manual-entry ledger intake.
- Pricing intelligence using current in-script data flows.
- Advertising outputs and configurable shop identity/copy/theme.

This file is not a full spec. It exists so a new agent starts from current state instead of stale planning artifacts.

## Current non-negotiables

- Work only on `TORN-RW-trading-hub.user.js` unless the user asks for another file.
- Do not treat `docs/scripts/rw-trading-hub.md`, old audits, old PRDs, or `rwth-assets.md` as current requirements without checking `docs/doc-authority.md`.
- Preserve the pure test seam in `globalThis.__RwthPure`.
- Do not replace scoped testing with "no testing."
- Do not broaden work into other scripts.

## Known doc risk

Several RWTH docs are known stale or historical. Their old requirements have repeatedly re-entered agent work. Before using any doc as guidance, check `docs/doc-authority.md`.

## Focused verification

Normal RWTH edits should use the smallest relevant test command from `docs/test-policy.md`.

The default smoke check is:

```powershell
node test-rwth.js
```

Run broader tests only when the touched code justifies it or the user explicitly asks.
