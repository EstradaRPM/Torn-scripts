# Gym Optimizer

> **Status:** Active
> **File:** `torn-gym-optomizer-v5.js` *(filename typo is intentional — preserves install URLs; do not rename)*
> **Target page:** `https://www.torn.com/gym.php`
> **Current version:** check `@version` in the file header

## Purpose

Multi-month gym training planner for Torn City. Given a player's current combat stats, energy budget, and faction buff configuration, projects optimal gym assignments across a planning horizon and tracks real-time energy expenditure against the plan.

## Data Sources

- Torn API (`https://api.torn.com/`) — selections: `user?selections=battlestats,bars`
- Page DOM (`torn.com/gym.php`) — energy bar (DOM read preferred over API for freshness)

See `docs/torn-domain.md` for API rules, rate limits, and compliance checklist.

---

## Architecture

### MEM shape

```js
const MEM = {
  stats: null,      // { str, def, spd, dex } — from API battlestats
  energy: null,     // number — current energy from DOM or API
  buffs: {},        // user-configured faction buff multipliers per stat
  plan: [],         // computed training schedule (derived from stats + buffs)
  fetchError: null,
};
```

### Store keys (localStorage)

Namespace prefix: `gymopt_`

| Key | Type | Purpose |
|-----|------|---------|
| `gymopt_buffs` | JSON object | User-configured faction buff % per stat |
| `gymopt_horizon` | number | Planning horizon in days |

### Key modules / functions

| Module/Function | Owns | Interface | Invariants |
|----------------|------|-----------|------------|
| `fetchStats()` | API calls | async, writes to MEM | DOM fallback for energy; checks `d.error` |
| `computeHeadroom(stats)` | Gym eligibility runway | pure fn | Per-stat distance to eligibility flip |
| `assignGym(stats, buffs)` | Optimal gym selection | pure fn | Returns gym best matching current stat ratios |
| `render()` | Full UI | Called on every state change | Reads MEM only |
| `Store` | localStorage | `get(k)`, `set(k, v)` | try/catch; `gymopt_` prefix |

---

## Domain Language

| Term | Definition | Avoid |
|------|-----------|-------|
| **Headroom** | How far a stat can grow before the gym eligibility condition reverses and the gym becomes inaccessible | margin, space |
| **Buff** | Faction-granted training multiplier applied on top of the base gym multiplier. Rotates monthly — always user-configured, never hardcoded. | bonus |

---

## Gym Reference

| Gym | Stats | Multiplier | Energy/train |
|-----|-------|-----------|-------------|
| Mr. Isoyama's | DEF | 8× | 50 |
| Gym 3000 | STR | 8× | 50 |
| Total Rebound | SPD | 8× | 50 |
| Elites | DEX | 8× | 50 |
| Frontline Fitness | STR + SPD | 7.5× | 25 |
| Balboa's | DEF + DEX | 7.5× | 25 |
| George's | All stats | 7.3× | 10 |

### Eligibility conditions

- **Isoyama's**: `DEF ≥ 1.25 × max(STR, SPD, DEX)`
- **Frontline Fitness**: `STR + SPD ≥ 1.25 × (DEF + DEX)`
- All others: always accessible

### Headroom formula (Isoyama's example)

`headroom = (DEF / 1.25) − max(STR, SPD, DEX)` — when this hits 0, training DEF any further closes the gym.

---

## Active State

- **Version:** check `@version` in `torn-gym-optomizer-v5.js`
- **Open issues:** check GitHub Issues with label `gym-optimizer`

---

## Notes / Gotchas

- Faction buffs rotate monthly and vary per faction — always accept as user input. Never hardcode.
- Filename typo (`optomizer`) is preserved intentionally — do not rename the file.
