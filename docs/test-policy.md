# Test Policy

The repo does use tests. The problem to avoid is unscoped, expensive, or stale tests being rerun for every small change.

## Default rule

Run the smallest test command that directly covers the touched behavior.

Do not run every `test-*.js` file by default. Do not infer that tests should be ignored entirely.

## RW Trading Hub test tiers

### Tier 0 - no test run

Allowed for comment-only edits, doc-only edits, or a source edit that only changes static copy and can be verified by direct inspection.

State this explicitly in the final response.

### Tier 1 - RWTH smoke

Default for most RWTH source edits:

```powershell
node test-rwth.js
```

This verifies the shipped userscript loads through the `__RwthPure` seam and checks broad tab/build behavior.

### Tier 2 - focused RWTH pure logic

Use when the touched behavior maps to a focused test file:

```powershell
node test-pricing-engine.js
node test-pricing-settings.js
node test-rowmodel.js
node test-manual-entry.js
node test-advconfig.js
node test-availabilityline.js
node test-itemmarketprice.js
node test-ledgerstats.js
node test-ledgersort.js
```

Pick the file or files that match the touched behavior. Do not run the entire list unless the change spans those surfaces.

### Tier 3 - cross-script/full repo tests

Use only when:

- the user explicitly asks for full validation,
- a shared utility used by multiple scripts changed,
- a release/PR handoff requires it,
- or a broad refactor touched multiple scripts.

Suggested PowerShell loop:

```powershell
Get-ChildItem -Filter "test-*.js" | ForEach-Object { node $_.FullName }
```

## Adding or changing tests

Add or update tests when:

- the behavior is pure or can be reached through `globalThis.__RwthPure`,
- the acceptance criteria include branchy edge cases,
- the bug can reasonably regress,
- or the user asks for test-first work.

Avoid copied function-body tests. Prefer requiring the shipped userscript and reading exported pure functions from `globalThis.__RwthPure`.
