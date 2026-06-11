# Agent Contract

This file is the shared contract for Claude Code, Codex, and any other agent working in this repo.

## Repo model

This repository contains several different kinds of material:

- Active standalone Torn City userscripts.
- Parked or older standalone userscripts.
- Community/reference scripts and forum-derived research.
- Generated planning docs, audits, PRDs, and issue-slicing artifacts.
- Node tests for selected pure logic in the scripts.

Agents must not treat all of those files as equally current.

## Current priority

Unless the user explicitly changes focus, the active script is:

- `TORN-RW-trading-hub.user.js`

The current handoff for that script is:

- `docs/current-rwth.md`

The doc authority map is:

- `docs/doc-authority.md`

The test policy is:

- `docs/test-policy.md`

## Source of truth order

When working on RW Trading Hub, use this order:

1. The user's current message.
2. `TORN-RW-trading-hub.user.js`.
3. Focused tests that directly require the shipped userscript through `globalThis.__RwthPure`.
4. `docs/current-rwth.md`.
5. Current docs listed as `ACTIVE` in `docs/doc-authority.md`.
6. Reference docs listed as `REFERENCE`, only as background.
7. Archived/stale docs listed as `ARCHIVE` or `STALE-NEEDS-UPDATE`, only when the user explicitly asks for historical context.

If a lower-priority source conflicts with a higher-priority source, the higher-priority source wins.

## Required behavior

- Before proposing or making structural changes, state the exact files you intend to touch.
- Keep work scoped to the current script unless the user explicitly asks for cross-script work.
- Ask before deleting, moving, archiving, or rewriting docs.
- Ask before replacing old tests, deleting tests, or broadening test scope.
- Ask before applying old audit/PRD/issue text as current requirements.
- Mark assumptions as assumptions.
- Prefer small changes that can be verified independently.

## Prohibited behavior

- Do not resurrect old artifacts as current requirements.
- Do not use stale docs to override the shipped userscript.
- Do not run the full test pile after every small edit.
- Do not infer that the user dislikes testing. The problem is unscoped, expensive testing.
- Do not modify multiple standalone scripts in one task unless explicitly asked.
- Do not turn reference/community/forum logic into implementation requirements without user confirmation.

## Script work rules

- Userscript edits must bump both `@version` and `SCRIPT_VERSION`.
- Torn API v2 only for new work unless v2 has no equivalent.
- Keep third-party host changes explicit and documented.
- Work in PowerShell by default.
- On this machine, GitHub CLI is at `C:\Program Files\GitHub CLI\gh.exe`; long issue/PR bodies should go through `--body-file`.

## Handoff rule

If you finish a meaningful RW Trading Hub change, update `docs/current-rwth.md` only when the current-state facts changed. Do not update broad docs or audits unless the user requested a doc-maintenance task.
