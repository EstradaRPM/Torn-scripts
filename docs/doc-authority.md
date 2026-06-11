# Documentation Authority Map

This file classifies docs so agents know what is current, reference-only, stale, or archive material.

Classification meanings:

- `ACTIVE` - may be used as current implementation/process guidance.
- `REFERENCE` - background research or domain context; not an implementation requirement.
- `STALE-NEEDS-UPDATE` - known to contain outdated claims; do not use as current authority.
- `ARCHIVE` - historical artifact; only use when explicitly asked for history.
- `UNKNOWN` - do not rely on it until classified.

## Active

| File | Status | Notes |
|---|---|---|
| `AGENTS.md` | ACTIVE | Root startup contract for Codex-style agents. |
| `CLAUDE.md` | ACTIVE | Root startup contract for Claude Code. |
| `docs/agent-contract.md` | ACTIVE | Shared operating contract for all agents. |
| `docs/current-rwth.md` | ACTIVE | Current RW Trading Hub handoff. |
| `docs/doc-authority.md` | ACTIVE | This authority map. |
| `docs/test-policy.md` | ACTIVE | Scoped test policy. |
| `CONTEXT.md` | ACTIVE | Current pointer model for domain context and doc authority. |
| `docs/engineering-principles.md` | ACTIVE | Process guidance. |
| `docs/torn-script-sharing-requirements.md` | ACTIVE | Compliance guidance; external policy details may still need verification. |
| `docs/agents/triage-labels.md` | ACTIVE | Issue label vocabulary, subject to GitHub state. |

## Reference

| File | Status | Notes |
|---|---|---|
| `docs/rw-armor-guide.md` | REFERENCE | Domain research, not current implementation spec. |
| `docs/rw-community-context.md` | REFERENCE | Community/trading research, not current algorithm authority. |
| `docs/scripts/api-monitor.md` | REFERENCE | Per-script doc; use only for that script. |
| `docs/scripts/gym-optimizer.md` | REFERENCE | Per-script doc; use only for that script. |
| `docs/scripts/rw-advisor.md` | REFERENCE | Parked script doc. |
| `docs/scripts/snipe-tracker.md` | REFERENCE | Per-script doc; use only for that script. |
| `docs/scripts/trade-ledger.md` | REFERENCE | Per-script doc; use only for that script. |
| `docs/adr/0001-poll-only-snipe-alerts.md` | REFERENCE | Current for Snipe Tracker only unless user asks otherwise. |
| `docs/adr/0002-rwth-pure-test-seam.md` | REFERENCE | Current concept for RWTH tests, but `docs/test-policy.md` controls test scope. |

## Stale Needs Update

| File | Status | Notes |
|---|---|---|
| `UBIQUITOUS_LANGUAGE.md` | STALE-NEEDS-UPDATE | Generated for RW Advisor-era language, not current RWTH authority. |
| `docs/torn-domain.md` | STALE-NEEDS-UPDATE | Mixes older API/source assumptions with current rules. |
| `docs/agents/domain.md` | STALE-NEEDS-UPDATE | File tree and instruction model drifted. |
| `docs/agents/issue-tracker.md` | STALE-NEEDS-UPDATE | GitHub CLI usage details drifted. |
| `docs/scripts/_template.md` | STALE-NEEDS-UPDATE | Template does not reflect current v2/third-party guidance. |
| `docs/scripts/rw-trading-hub.md` | STALE-NEEDS-UPDATE | Contains old RWTH version/scope claims. Use `docs/current-rwth.md` instead. |
| `docs/rw-api-reference.md` | STALE-NEEDS-UPDATE | Does not reflect current RWTH data flow. |
| `docs/rw-pricing-logic.md` | STALE-NEEDS-UPDATE | Advisor-era/current-RWTH mismatch. |
| `docs/adr/0003-third-party-api-exception.md` | STALE-NEEDS-UPDATE | Host/source details drifted. |

## Archive

| File | Status | Notes |
|---|---|---|
| `docs-audit-report.md` | ARCHIVE | Audit snapshot used to create later planning artifacts; not current authority. |
| `docs/prd-steps-i-through-l.md` | ARCHIVE | Historical PRD/planning artifact. |
| `docs/scripts/rwth-assets.md` | ARCHIVE | Salvaged historical input; not current implementation authority. |
| `docs/KING UPDATED RW LOGIC.md` | ARCHIVE | Forum-derived/source research. |
| `docs/scripts/RW Weapon Bonus Rankings.md` | ARCHIVE | Historical/reference ranking material. |
| `docs/audits/rw-trading-hub-coverage-matrix.md` | ARCHIVE | Historical audit snapshot if present. |
| `docs/audits/rw-trading-hub-gap-analysis.md` | ARCHIVE | Historical audit snapshot if present. |

## Unknown

Any new doc not listed here is `UNKNOWN` until classified. Agents must not use `UNKNOWN` docs as current implementation guidance.
