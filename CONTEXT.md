# Domain Context

This repo contains active scripts, parked scripts, reference material, stale generated docs, and historical planning artifacts. Do not treat all docs as equally current.

## Currently active

- **RW Trading Hub** → `TORN-RW-trading-hub.user.js`

Doc authority map:

- `docs/doc-authority.md`

Test policy:

- `docs/test-policy.md`

## Parked or separate scripts

These scripts are separate work surfaces. Do not modify them during RW Trading Hub work unless the user explicitly asks.

- **Snipe Tracker** → `torn-snipe-tracker-v1.user.js`
- **Gym Optimizer** → `torn-gym-optomizer-v5.js`
- **RW Advisor** (parked) → `torn-rw-auction-advisor-v1.user.js`
- **Trade Ledger** → `torn-trade-ledger-v1.user.js`
- **API Monitor** → `torn-api-monitor.user.js`

## For agent skills

When a skill asks to read domain context or glossary terms, read `docs/doc-authority.md` first. Use docs marked `ACTIVE` as current guidance. Use `REFERENCE` docs only as background. Do not use `STALE-NEEDS-UPDATE`, `ARCHIVE`, or `UNKNOWN` docs as implementation authority unless the user explicitly asks for historical context.
