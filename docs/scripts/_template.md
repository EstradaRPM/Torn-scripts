# [Script Name]

> **Status:** Active | Parked vX.Y.Z | In Development
> **File:** `torn-[name]-vN.user.js`
> **Target page:** `https://www.torn.com/[page].php`
> **Current version:** N.0.0

## New Script Workflow

1. `/grill-me` — always, before writing any code
2. If multi-session or multi-subsystem → `/to-prd` → `/to-issues`
3. If single-session scope → write directly after grill

**Signal for step 2:** can you describe the full feature set in 2–3 sentences? If yes, skip the PRD/issues. If you needed a paragraph per feature, file them.

---

## Purpose

One paragraph: what problem this solves, for whom, and why it exists. What does the user do differently because this script exists?

## Data Sources

Check all that apply — and list only what the script actually uses:

- [ ] Torn API (`https://api.torn.com/`) — selections: `[list here]`
- [ ] Page DOM (`torn.com/[page].php`) — what is read from the DOM?
- [ ] TornW3B (`https://weav3r.dev/api`) — unconditional if used, no opt-in

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  // Top-level fields and their types/purpose
  // Example:
  // items: [],          // array of watched items
  // fetchError: null,   // string or null; surfaced in UI
  // lastPoll: 0,        // epoch ms of last API poll
};
```

### Store keys (localStorage)

Prefix all keys with a script-specific namespace (e.g., `snipe_`, `gym_`).

| Key (with prefix) | Type | Purpose |
|-------------------|------|---------|
| `[prefix]_setting` | string | ... |

### Key modules / functions

Describe the main logical units — what each one owns, its interface, and any invariants.

| Module/Function | Owns | Interface | Invariants |
|----------------|------|-----------|------------|
| `render()` | Full UI | Called on every state change | Rebuilds from MEM only |
| `Store` | localStorage | `get(k)`, `set(k, v)` | try/catch; never throws |
| ... | ... | ... | ... |

---

## Domain Language

Terms specific to this script. Use these exact words in code, issues, comments, and docs. List synonyms to avoid so language stays consistent.

| Term | Definition | Avoid |
|------|-----------|-------|
| ... | ... | ... |

---

## Active State

- **Version:** N.0.0
- **Open issues:** #NNN (title), #NNN (title)
- **Next up:** brief description of the next planned work
- **Parked reason** *(if parked)*: why it was parked and what must happen before resuming — run `/grill-me` first

---

## ADRs

List any `docs/adr/` entries that govern this script's design decisions. If none exist yet, leave blank.

- `docs/adr/NNNN-example.md` — decision summary

---

## Notes / Gotchas

Non-obvious constraints, workarounds, environment quirks, or invariants that would surprise a future reader. Only include things that aren't obvious from reading the code.
