# Documentation Drift Audit

> **ARCHIVE:** Historical audit snapshot. This file explains prior drift, but it is not current implementation authority. Use `docs/doc-authority.md` and `docs/current-rwth.md` for new agent sessions.

Audit date: 2026-06-07

Source of truth used: current source files, tests, package/config files, and CI/config files present in the repo. Claims depending on current Torn/community behavior or GitHub issue state are marked **unverified** unless the repo itself proves them.

## Inventory

Audited project docs:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTEXT.md`
- `UBIQUITOUS_LANGUAGE.md`
- `docs/torn-script-sharing-requirements.md`
- `docs/torn-domain.md`
- `docs/agents/triage-labels.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- `docs/scripts/_template.md`
- `docs/scripts/api-monitor.md`
- `docs/scripts/gym-optimizer.md`
- `docs/scripts/rw-advisor.md`
- `docs/scripts/rw-trading-hub.md`
- `docs/scripts/rwth-assets.md`
- `docs/scripts/snipe-tracker.md`
- `docs/scripts/trade-ledger.md`
- `docs/scripts/RW Weapon Bonus Rankings.md`
- `docs/rw-api-reference.md`
- `docs/rw-pricing-logic.md`
- `docs/rw-community-context.md`
- `docs/rw-armor-guide.md`
- `docs/prd-steps-i-through-l.md`
- `docs/KING UPDATED RW LOGIC.md`
- `docs/engineering-principles.md`
- `docs/adr/0001-poll-only-snipe-alerts.md`
- `docs/adr/0002-rwth-pure-test-seam.md`
- `docs/adr/0003-third-party-api-exception.md`
- `docs/audits/rw-trading-hub-gap-analysis.md`
- `docs/audits/rw-trading-hub-coverage-matrix.md`

No root `README*` or `CHANGELOG*` files were found by `rg --files`.

Excluded from drift classification: hidden agent skill docs under `.agents/` / `.claude/`, `.claude/worktrees/**` copies, and `auction-db/node_modules/**/README.md` vendor docs. These are not project documentation for the Torn scripts.

## High-Signal Drift

| Doc | Classification | Outdated claim | Current reality | Evidence | Recommended action |
|---|---|---|---|---|---|
| `docs/scripts/rw-trading-hub.md` | Partially outdated | Active State says version `0.1.11`, next slice is sell logging, open issues are `#246-#248`. | Current userscript is `0.3.97`; sell logging, pricing intel, advertising theming/copy, ledger dashboard, velocity, BB pricing, official item-market comps, Supabase comps, and many later slices exist. | Doc: `docs/scripts/rw-trading-hub.md:270-275`. Code: `TORN-RW-trading-hub.user.js:4`, `TORN-RW-trading-hub.user.js:18`, `TORN-RW-trading-hub.user.js:1245`, `TORN-RW-trading-hub.user.js:3589`, `TORN-RW-trading-hub.user.js:5162`, `TORN-RW-trading-hub.user.js:5389`. | Patch active-state section; keep as canonical per-script doc but refresh version, completed scope, test command list, and known open items. |
| `docs/scripts/rw-trading-hub.md` | Partially outdated | Store-key table only lists `rwth_ledger`, `rwth_transactions`, `rwth_settings`, `rwth_seen_wins`, and `rwth_items`; it also says `rwth_cache_*` was dropped from the original draft. | Current code reads/writes additional keys: `rwth_scan`, `rwth_adv_mode` migration, `rwth_collapsed`, `rwth_sort`, `rwth_bb_rate`, `rwth_intel_settings`, `rwth_velocity_log`, `rwth_cache_*`, and likely other settings nested under `rwth_settings`. | Doc: `docs/scripts/rw-trading-hub.md:116-128`. Code: `TORN-RW-trading-hub.user.js:448-506`, `TORN-RW-trading-hub.user.js:3589-3602`, `TORN-RW-trading-hub.user.js:5173`, `TORN-RW-trading-hub.user.js:5226`. | Patch store-key table; separate persistent keys, migrated legacy keys, and transient/cache keys. |
| `docs/adr/0003-third-party-api-exception.md` | Seriously outdated | Allowed Supabase host is `btrmmuuoofbonmuwrkzg.supabase.co`; weav3r and Supabase are both active inline price-intel sources; item market and bazaar surfaces render visible-row verdicts. | Current header allows `weav3r.dev` and `kozewwpyssyzuyksnoqu.supabase.co`. Current pricing comments say Supabase auction history plus Torn official item-market API are the live sources. `Weav3rClient` still exists/exported but no live call site was found in the userscript search; `ListingsFetcher` uses `/v2/market/{id}/itemmarket` and returns `bazaar: []`. `AuctionScanner` is `amarket.php` only. | Doc: `docs/adr/0003-third-party-api-exception.md:1`, `docs/adr/0003-third-party-api-exception.md:7-12`, `docs/adr/0003-third-party-api-exception.md:18-22`, `docs/adr/0003-third-party-api-exception.md:37-40`. Code: `TORN-RW-trading-hub.user.js:9-10`, `TORN-RW-trading-hub.user.js:5162-5169`, `TORN-RW-trading-hub.user.js:5359-5369`, `TORN-RW-trading-hub.user.js:5389-5546`, `TORN-RW-trading-hub.user.js:8056-8097`. | Rewrite or supersede with a new ADR. Keep the original only as historical context if ADRs are immutable. |
| `docs/torn-domain.md` | Seriously outdated | Says current scripts are v1, permitted sources are official API/page DOM/TornW3B only, TornW3B is unconditional with no opt-in, and all current scripts are local-only. | Current repo rule is Torn API v2 only for new work. Current RW Hub uses Supabase PostgREST with an embedded publishable key and `GM_xmlhttpRequest`. Current scripts are mixed: RW Hub uses `/v2/...`; Snipe/Gym/Trade Ledger still contain older v1-style URLs; RW Hub and Trade Ledger use third-party services. | Doc: `docs/torn-domain.md:19-22`, `docs/torn-domain.md:64-67`, `docs/torn-domain.md:95`, `docs/torn-domain.md:103-108`. Code/rules: `AGENTS.md:19`, `TORN-RW-trading-hub.user.js:9-10`, `TORN-RW-trading-hub.user.js:5162-5169`, `torn-snipe-tracker-v1.user.js:573`, `torn-gym-optomizer-v5.js:1951`, `torn-trade-ledger-v1.user.js:177`, `torn-trade-ledger-v1.user.js:201`. | Rewrite shared compliance doc. Split "legacy scripts currently do X" from "rules for new work." |
| `CONTEXT.md` | Partially outdated | Currently active list omits RW Trading Hub and says domain language/architecture details live in per-script docs. | `AGENTS.md` and `CLAUDE.md` identify `TORN-RW-trading-hub.user.js` as the current script and say recent context/memory lives in GitHub, not docs. | Doc: `CONTEXT.md:3`, `CONTEXT.md:5-13`. Current repo guidance: `AGENTS.md:5-13`, `CLAUDE.md:5-13`. | Patch to list RW Trading Hub as active and clarify that per-script docs are references, not current-memory source. |
| `docs/agents/domain.md` | Partially outdated | File tree omits `rw-trading-hub.md`, `trade-ledger.md`, `api-monitor.md`, `rwth-assets.md`, and current root `AGENTS.md`; it says new scripts require adding a row to a Current Scripts table in `CLAUDE.md`. | `CLAUDE.md` has no Current Scripts table; the root current-script pointer lives in both `AGENTS.md` and `CLAUDE.md`. | Doc: `docs/agents/domain.md:15-30`, `docs/agents/domain.md:32-39`. Current docs: `AGENTS.md:5-13`, `CLAUDE.md:5-13`; inventory includes more script docs. | Patch. |
| `docs/agents/issue-tracker.md` | Mostly current with minor drift | Says use `gh` CLI for all operations and inline/heredoc bodies. | Current repo instructions say `gh` is only at `C:\Program Files\GitHub CLI\gh.exe` and long bodies must go through `--body-file`, never inline. | Doc: `docs/agents/issue-tracker.md:3`, `docs/agents/issue-tracker.md:7-12`. Current rule: `AGENTS.md:23`. | Patch command examples. |
| `UBIQUITOUS_LANGUAGE.md` | Partially outdated | Title and generated-from list are for RW Auction Advisor; ledger result vocabulary uses `Won/Lost/Passed`; `actualNet` formula says sell price less market fee and mug buffer minus current bid. | Current focus is RW Trading Hub. Current hub ledger statuses are `held/listed/sold`; ROI/profit uses authoritative `saleNet - buyPrice`, not a second fee/mug deduction. | Doc: `UBIQUITOUS_LANGUAGE.md:1-4`, `UBIQUITOUS_LANGUAGE.md:81-85`, `UBIQUITOUS_LANGUAGE.md:101-105`. Code: `TORN-RW-trading-hub.user.js:555-559`, `TORN-RW-trading-hub.user.js:764`, `TORN-RW-trading-hub.user.js:1269-1386`. | Rewrite for RW Trading Hub or archive as RW Auction Advisor glossary. |
| `docs/audits/rw-trading-hub-coverage-matrix.md` | Partially outdated | Subject is `v0.3.87` and 8159 lines; claims `docs/scripts/rw-trading-hub.md` still scopes personal-bazaar inline as in-scope and old NC17 branding as locked; claims `test-rwth.js` and `rwth-assets.md` are stale based on project memory. | Current script is `v0.3.97` and 8379 lines. Current `rw-trading-hub.md` explicitly says personal-bazaar inline was intentionally cut and branding is configurable/neutral. `test-rwth.js` imports the shipped userscript through `__RwthPure`; some other tests still copy function bodies. The stale-memory claim is **unverified** from source. | Doc: `docs/audits/rw-trading-hub-coverage-matrix.md:4`, `docs/audits/rw-trading-hub-coverage-matrix.md:49`, `docs/audits/rw-trading-hub-coverage-matrix.md:55`, `docs/audits/rw-trading-hub-coverage-matrix.md:71-73`. Current docs/code: `docs/scripts/rw-trading-hub.md:23`, `docs/scripts/rw-trading-hub.md:233`, `TORN-RW-trading-hub.user.js:4`, line count 8379, `test-rwth.js:21-29`, `test-pricing-engine.js:3`. | Archive or regenerate. Do not patch piecemeal; it is an audit snapshot. |
| `docs/audits/rw-trading-hub-gap-analysis.md` | Mostly current with minor drift | Subject is `v0.3.87` and line references are stale; says "live v0.3.87 script is the only source of truth." | Current script is `v0.3.97`; several line references have shifted. Its qualitative claims about dead `Weav3rClient`, vestigial `bazaar: []`, and test duplication are mostly supported, but some tests now use `__RwthPure`. | Doc: `docs/audits/rw-trading-hub-gap-analysis.md:4`, `docs/audits/rw-trading-hub-gap-analysis.md:9`, `docs/audits/rw-trading-hub-gap-analysis.md:30-32`, `docs/audits/rw-trading-hub-gap-analysis.md:51-56`. Code/tests: `TORN-RW-trading-hub.user.js:4`, `TORN-RW-trading-hub.user.js:5359-5369`, `TORN-RW-trading-hub.user.js:5389-5546`, `test-rwth.js:21-29`, `test-pricing-engine.js:3`. | Archive as historical or regenerate against `v0.3.97`. |
| `docs/rw-pricing-logic.md` | Seriously outdated | Describes "RW Auction Advisor" and a static/default formula with `target_margin` default 15%, price reference hierarchy using Torn `GET /market/{id}/auctionhouse`, live item market, and forum/bazaar listings. | Current RW Hub default margin target is 5 after migration; pricing engine uses own Supabase auction history, official `/v2/market/{id}/itemmarket`, BBEngine, widened comp bands, bonus/quality ladders, trash-bonus guard, velocity, and no live bazaar comps from Torn. | Doc: `docs/rw-pricing-logic.md:1-3`, `docs/rw-pricing-logic.md:199-216`, `docs/rw-pricing-logic.md:237-245`. Code: `TORN-RW-trading-hub.user.js:414-419`, `TORN-RW-trading-hub.user.js:524-529`, `TORN-RW-trading-hub.user.js:5162-5169`, `TORN-RW-trading-hub.user.js:5389-5546`. | Rewrite for RW Hub or archive as advisor-era reference. |
| `docs/rw-api-reference.md` | Seriously outdated | Documents TornW3B as a major API source and says TornW3B use needs opt-in constraints; does not describe current Supabase auction-history backend. | Current RW Hub contains Supabase PostgREST constants, a local `auction-db/` backend, official Torn item-market fetches, and only leftover/exported Weav3r client plus an ad pricelist link/smoke diagnostic. | Doc: `docs/rw-api-reference.md:268-285`, `docs/rw-api-reference.md:351-417`. Code/config: `TORN-RW-trading-hub.user.js:5162-5169`, `TORN-RW-trading-hub.user.js:5300-5354`, `TORN-RW-trading-hub.user.js:5389-5546`, `auction-db/schema.sql:1-41`, `auction-db/lib.mjs:92-147`. | Rewrite for current RW Hub data flow. |
| `docs/prd-steps-i-through-l.md` | Historical/archive only | Describes planned RW Auction Advisor `v1.29.0-v1.32.0` modules such as `detectFloorCluster`, `classifyListing`, `computeListingMetrics`, `buildContextPanel`, `KEYS.MIN_FLOOR_PROFIT`, and says no existing test infrastructure exists. | Current active work is RW Trading Hub `v0.3.97`; those named modules are not the current module names. Current repo has multiple Node tests and many RW Hub tests import `__RwthPure`. | Doc: `docs/prd-steps-i-through-l.md:1-2`, `docs/prd-steps-i-through-l.md:70-106`, `docs/prd-steps-i-through-l.md:122`, `docs/prd-steps-i-through-l.md:126-131`. Code/tests: `TORN-RW-trading-hub.user.js:4`, `test-rwth.js:21-29`, `test-pricing-settings.js:22-28`, `test-pricing-engine.js:3`. | Archive. Do not use as current implementation guidance. |
| `docs/scripts/rwth-assets.md` | Historical/archive only | Salvaged asset snippets include old Supabase host and hardcoded user/bazaar examples; source note says anything else from transcript should be re-grilled. | Current code uses neutral configurable identity, current Supabase host `kozewwpyssyzuyksnoqu`, and generated ad outputs from `AdvertiseGenerator`/`AdvConfig`. | Doc: `docs/scripts/rwth-assets.md:1-5`, `docs/scripts/rwth-assets.md:21`, `docs/scripts/rwth-assets.md:416-424`. Code: `TORN-RW-trading-hub.user.js:32-52`, `TORN-RW-trading-hub.user.js:196-292`, `TORN-RW-trading-hub.user.js:5167`. | Archive; keep only if clearly labelled as salvaged historical input. |
| `docs/scripts/api-monitor.md` | Mostly current with minor drift | Header says current version `1.0.0`. | Source and Active State are `1.2.0`; API endpoint claim matches code. | Doc: `docs/scripts/api-monitor.md:6`, `docs/scripts/api-monitor.md:74`. Code: `torn-api-monitor.user.js:4`, `torn-api-monitor.user.js:15`, `torn-api-monitor.user.js:106-113`. | Patch version line. |
| `docs/scripts/snipe-tracker.md` | Partially outdated | Target page says `imarket.php`; data sources claim TornW3B unconditional; doc says script polls market API and uses TornW3B. | Current script matches all Torn pages, detects market/background mode, has no `@connect weav3r.dev`, and no `weav3r` source references were found. It does contain v2 user log calls and a legacy v1 `torn/?selections=items` catalog call. It also uses a `MutationObserver`, though ADR-0001 only restricts alert triggering. | Doc: `docs/scripts/snipe-tracker.md:4-16`, `docs/scripts/snipe-tracker.md:52-58`, `docs/scripts/snipe-tracker.md:89-106`. Code: `torn-snipe-tracker-v1.user.js:7-9`, `torn-snipe-tracker-v1.user.js:17-23`, `torn-snipe-tracker-v1.user.js:512`, `torn-snipe-tracker-v1.user.js:573`, `torn-snipe-tracker-v1.user.js:1090-1092`. | Patch data sources, target/scope, and v1/v2 reality. |
| `docs/scripts/gym-optimizer.md` | Mostly current with minor drift | Target page says `gym.php`; data source says `user?selections=battlestats,bars` without noting additional `education,properties`, 60s bars refresh, 5m stats refresh, and all-page mode. | Current script matches all Torn pages; it returns early off `gym.php` unless test/all-page setting is active. It fetches `education,properties`, `battlestats,bars`, `bars`, and `battlestats` with v1-style URLs; it also reads energy from DOM and has a MutationObserver. | Doc: `docs/scripts/gym-optimizer.md:4-15`, `docs/scripts/gym-optimizer.md:89-96`. Code: `torn-gym-optomizer-v5.js:7`, `torn-gym-optomizer-v5.js:17`, `torn-gym-optomizer-v5.js:45`, `torn-gym-optomizer-v5.js:1951`, `torn-gym-optomizer-v5.js:1984-2065`. | Patch target/data-source details. |
| `docs/scripts/trade-ledger.md` | Mostly current with minor drift | Says Torn API `user?selections=log`; does not call out older v1 URL style or the current source script writes from Snipe. | Broad architecture and version match code; code uses `api.torn.com/user/?selections=log`, `api.torn.com/torn/?selections=items`, W3B bulk marketplace, `torn_trades`, and 5m W3B polling. | Doc: `docs/scripts/trade-ledger.md:4-18`, `docs/scripts/trade-ledger.md:118-139`. Code: `torn-trade-ledger-v1.user.js:4-10`, `torn-trade-ledger-v1.user.js:18`, `torn-trade-ledger-v1.user.js:116-201`, `torn-trade-ledger-v1.user.js:1025-1143`. | Minor patch to distinguish legacy API URL style from current new-work rule. |
| `docs/scripts/rw-advisor.md` | Mostly current with minor drift | Says parked script uses Torn API v2 item listings/auction data plus unconditional TornW3B. | Version and parked status match. Source also uses v1-style `torn/?selections=items` for item catalog/cache and current item-market v2; Supabase historical sales is mentioned in source comments but not the doc data sources. | Doc: `docs/scripts/rw-advisor.md:3-28`, `docs/scripts/rw-advisor.md:80-90`. Code: `torn-rw-auction-advisor-v1.user.js:4-10`, `torn-rw-auction-advisor-v1.user.js:18`, `torn-rw-auction-advisor-v1.user.js:659-672`, `torn-rw-auction-advisor-v1.user.js:870-895`, `torn-rw-auction-advisor-v1.user.js:2776-2782`. | Patch if the parked doc is still used; otherwise leave as parked historical. |
| `docs/scripts/_template.md` | Partially outdated | Template says TornW3B is unconditional if used and no opt-in; does not reflect current "Torn API v2 only" rule or third-party disclosure/ADR expectations for Supabase-like services. | Current repo rules require Torn API v2 only for new work, and current RW Hub has a third-party ADR for non-Torn hosts. | Doc: `docs/scripts/_template.md:22-30`. Rules/docs: `AGENTS.md:19`, `docs/adr/0003-third-party-api-exception.md:14-22`. | Patch template before creating future script docs. |

## Current Or Mostly Current Docs

| Doc | Classification | Notes | Evidence | Recommended action |
|---|---|---|---|---|
| `AGENTS.md` | Current | Correctly identifies `TORN-RW-trading-hub.user.js` as current script and states current work rules. "Context/memory lives in GitHub" is **unverified** from source code, but it matches the user's instruction. | `AGENTS.md:5-23`; script exists and header is current at `TORN-RW-trading-hub.user.js:1-18`. | Keep. |
| `CLAUDE.md` | Current | Same content as `AGENTS.md`; no source drift found. | `CLAUDE.md:5-23`; `TORN-RW-trading-hub.user.js:1-18`. | Keep, or deliberately dedupe later if both are not needed. |
| `docs/agents/triage-labels.md` | Current, unverified | No code source of truth for GitHub label vocabulary exists in repo. Could not verify actual GitHub labels without treating GitHub state as source of truth. | `docs/agents/triage-labels.md:1-15`. | Keep unless GitHub label audit says otherwise. |
| `docs/torn-script-sharing-requirements.md` | Current with unverified external rule text | General compliance guidance is not contradicted by current code. It is external-policy material, so current Torn staff interpretation is **unverified** from repo code. | `docs/torn-script-sharing-requirements.md:4-31`, `docs/torn-script-sharing-requirements.md:46-58`. | Keep; optionally fix typo "ant" -> "and" later. |
| `docs/engineering-principles.md` | Current | Engineering principles doc makes process claims, not code claims. No drift found. | `docs/engineering-principles.md:1-31`. | Keep. |
| `docs/adr/0001-poll-only-snipe-alerts.md` | Mostly current with minor nuance | ADR says snipe alerts are poll-only, not MutationObserver. Current source still has a MutationObserver, but the ADR allows observer as non-alert path. Alert wiring was not fully audited. | Doc: `docs/adr/0001-poll-only-snipe-alerts.md:1-3`. Code: `torn-snipe-tracker-v1.user.js:1090-1092`. | Keep; patch only if alert path has changed. |
| `docs/adr/0002-rwth-pure-test-seam.md` | Mostly current with minor drift | The ADR decision is current: many RW tests require the shipped `.user.js` and read `__RwthPure`. Minor drift: ADR says drift is impossible by construction, but some RW tests still copy function bodies. | Doc: `docs/adr/0002-rwth-pure-test-seam.md:9-20`. Tests: `test-rwth.js:21-29`, `test-rowmodel.js:21-29`, `test-pricing-settings.js:22-28`, `test-pricing-engine.js:3`, `test-manual-entry.js:3`. | Patch consequences to say the seam prevents drift only for tests that use it; migrate copied tests separately if desired. |
| `docs/rw-armor-guide.md` | Historical/reference, mostly current unverified | This is domain/reference material, not implementation documentation. Current code uses related BB floor, armor classification, quality, rarity, and pricing concepts, but factual market/community claims are **unverified** from repo source. | Doc: `docs/rw-armor-guide.md:1-9`, `docs/rw-armor-guide.md:214-245`, `docs/rw-armor-guide.md:283`. Code concepts: `TORN-RW-trading-hub.user.js:556`, `TORN-RW-trading-hub.user.js:6323` by search result, `TORN-RW-trading-hub.user.js:5389-5546`. | Keep as reference; label as domain research, not current implementation spec. |
| `docs/rw-community-context.md` | Historical/reference, mostly current unverified | Community trading/mugging/advertising guidance cannot be verified against code. Some ideas are reflected in current mug buffer, advertising hub, and pricing caution, but it should not be read as source of current algorithm behavior. | Doc: `docs/rw-community-context.md:1-5`, `docs/rw-community-context.md:96-146`, `docs/rw-community-context.md:216-242`. Code: `TORN-RW-trading-hub.user.js:418-419`, `TORN-RW-trading-hub.user.js:2098-2104`, `TORN-RW-trading-hub.user.js:2470-2575`. | Keep as reference; add "not implementation spec" label if edited later. |
| `docs/KING UPDATED RW LOGIC.md` | Historical/archive only | Looks like source research/transcribed guide. It includes "last edited" external date and market claims; those are **unverified** from repo code. It should not be treated as current code architecture. | Doc: `docs/KING UPDATED RW LOGIC.md:7-9`, `docs/KING UPDATED RW LOGIC.md:71-75`, `docs/KING UPDATED RW LOGIC.md:582-602`, `docs/KING UPDATED RW LOGIC.md:709`. | Archive/reference only. |
| `docs/scripts/RW Weapon Bonus Rankings.md` | Historical/reference, unverified | Large reference ranking doc. No current code/test source of truth proves the ranking values. | Inventory only; no implementation dependency found during drift pass. | Keep as reference or archive. |

## Summary By Recommended Action

Keep:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/agents/triage-labels.md` (unverified externally)
- `docs/torn-script-sharing-requirements.md`
- `docs/engineering-principles.md`
- `docs/adr/0001-poll-only-snipe-alerts.md`
- `docs/rw-armor-guide.md` as reference
- `docs/rw-community-context.md` as reference

Patch:

- `CONTEXT.md`
- `UBIQUITOUS_LANGUAGE.md` if it remains current glossary
- `docs/agents/domain.md`
- `docs/agents/issue-tracker.md`
- `docs/scripts/_template.md`
- `docs/scripts/api-monitor.md`
- `docs/scripts/gym-optimizer.md`
- `docs/scripts/rw-advisor.md` if parked docs remain maintained
- `docs/scripts/rw-trading-hub.md`
- `docs/scripts/snipe-tracker.md`
- `docs/scripts/trade-ledger.md`
- `docs/adr/0002-rwth-pure-test-seam.md`

Rewrite:

- `docs/torn-domain.md`
- `docs/adr/0003-third-party-api-exception.md` or supersede with a new ADR
- `docs/rw-api-reference.md`
- `docs/rw-pricing-logic.md`

Archive:

- `docs/audits/rw-trading-hub-coverage-matrix.md`
- `docs/audits/rw-trading-hub-gap-analysis.md`
- `docs/prd-steps-i-through-l.md`
- `docs/scripts/rwth-assets.md`
- `docs/KING UPDATED RW LOGIC.md`
- `docs/scripts/RW Weapon Bonus Rankings.md` if not actively maintained

Delete:

- No delete recommendation from this pass. The stale docs still have historical or research value, but they need clearer archive labels so agents do not treat them as current architecture.
