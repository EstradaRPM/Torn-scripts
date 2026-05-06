# Domain Docs

How engineering skills should consume domain documentation in this repo.

## Before exploring, read these

1. `CONTEXT.md` — points to the relevant per-script doc(s)
2. `docs/scripts/[name].md` — domain language, architecture, active state for the script being worked on
3. `docs/adr/` — read ADRs that touch the area you're about to change

If any of these files don't exist, **proceed silently**. Don't flag their absence upfront.

## File structure

```
/
├── CLAUDE.md                    # Universal rules, routing table
├── CONTEXT.md                   # Pointer to active per-script docs
├── docs/
│   ├── scripts/
│   │   ├── _template.md         # Copy this to start a new script doc
│   │   ├── snipe-tracker.md
│   │   ├── gym-optimizer.md
│   │   └── rw-advisor.md
│   ├── torn-domain.md           # Shared: Torn API, compliance checklist
│   ├── engineering-principles.md
│   ├── agents/                  # You are here
│   └── adr/
└── torn-*.user.js
```

## Adding a new script

When the user starts a new script:

1. Copy `docs/scripts/_template.md` → `docs/scripts/[name].md`
2. Fill in: Purpose, Data Sources, Architecture (MEM shape + Store keys + modules), Domain Language, Active State
3. Add a row to the Current Scripts table in `CLAUDE.md`
4. The script doc is the canonical reference for that script going forward

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, refactor proposal, test name, or doc), use the term as defined in the relevant script doc. Don't drift to synonyms the glossary explicitly lists under "Avoid."

If the concept you need isn't in the glossary, either you're inventing language the project doesn't use (reconsider) or there's a real gap — note it for a `/grill-me` session.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly:

> _Contradicts ADR-0001 (poll-only snipe alerts) — worth reopening because…_
