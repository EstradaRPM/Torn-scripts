# RW Trading Hub exposes pure functions via `globalThis.__RwthPure` for Node testing

## Context

Tests for prior scripts (`test-snipe-engine.js`, `test-trade-ledger.js`, `test-pricing-engine.js`) copy function bodies out of the IIFE into the test file and translate them — `Store` becomes `makeStore(ls)`, `TradeStore` becomes `makeTradeStore(Store)`. The IIFE keeps shipping bare-object modules; the tests keep using factory-style rewrites. Drift between the two is guaranteed and silent: a bug fix in the shipped code is not exercised by the test suite unless the maintainer remembers to re-translate. The header comment "keep in sync with the IIFE implementation" is the only enforcement.

The RW Trading Hub has more pure surface than any prior script (`ROI.compute`, `AdvertiseGenerator.toChat`/`toForumHtml`, `similarity.score`, `matchSells`, every `build*` HTML builder). Carrying the copy-paste pattern forward would mean translating 6+ functions by hand, forever.

## Decision

The Hub's IIFE assigns its pure functions to a single object on `globalThis.__RwthPure`. A small Node shim stubs the browser globals the IIFE references (`localStorage`, `GM_xmlhttpRequest`, `document`, `window`) and `require`s the `.user.js` file directly. Test files then read functions off `globalThis.__RwthPure` and assert against them with `node:test`.

The block is the only place pure functions are named for external access; the rest of the IIFE references them through normal closure. Adding a new pure function is one line in the `__RwthPure` block.

## Consequences

- Tests run the **exact shipped code**. Drift is impossible by construction.
- `render()`, `setState`, DOM wiring, and the network shells of `LogScanner` / `PricingEngine` / `W3BFetcher` are intentionally outside the test surface — their interface is "mutate the store, then call render," not "given X, return Y." Tests of those would re-describe mutations rather than pin behaviour.
- `__RwthPure` is visible to other scripts running on the same page. Acceptable: contents are read-only pure functions, no secrets or mutation hooks. Other scripts cannot use it to influence Hub state.
- The pattern is unusual for userscripts. Without this ADR, a future reader is likely to "clean up" the global as a leak, or inline the block and delete it — silently breaking the test suite. This ADR exists primarily to defend the seam against well-intentioned cleanup.

## Alternatives rejected

- **Factory pattern everywhere** (`makeStore(ls)`, `makeTradeStore(Store)`, …). Widens every module's interface with explicit dependency wiring. Pushes interface complexity onto every call site to solve a problem only tests have.
- **Copy-paste with a sync-check script.** Detects drift but doesn't prevent it; adds tooling without removing the translation step.
- **jsdom + bundler.** Introduces a toolchain to a zero-dependency, single-file repo. Cost dwarfs the problem.
