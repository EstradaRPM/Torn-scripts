# Torn Domain Reference

Shared knowledge for all scripts in this repo. Read this file when touching API calls, rate-limiting logic, or anything compliance-sensitive.

---

## Torn API

### API References

| Resource | Covers | Use for |
|----------|--------|---------|
| [tornapi-documentation](https://github.com/Torn-Playground/tornapi-documentation) ([live](https://tornapi.tornplayground.eu/)) | v1 API | Selection names, field shapes, access levels |
| [torn-client](https://github.com/neon0404/torn-client) | v2 API | v2 endpoint/model reference; browse `src/generated/endpoints/` and `src/generated/models/` |
| [Official v2 OpenAPI spec](https://www.torn.com/swagger/openapi.json) | v2 API | Raw JSON spec powering the playground and torn-client generator |

Check the relevant reference before writing any new API call.

### v1 (current scripts)

- **Base URL:** `https://api.torn.com/`
- **Auth:** `?key=###PDA-APIKEY###` (PDA injects at install; localStorage for manual installs)
- **Rate limit:** hard cap 100 req/min per player key
- **Minimum poll interval:** 5 minutes for most data; longer when freshness is not critical

### Combat endpoints

| Endpoint | Returns |
|----------|---------|
| `user/?selections=battlestats` | STR, DEF, SPD, DEX values |
| `user/?selections=bars` | Energy, happy, life bars |
| `market/?selections=itemmarket` | Item market listings |

### Error handling (required)

Always check `d.error` before using response data. On error:

- Store in `MEM.fetchError` for UI surfacing
- On **error code 2** (bad key) or **error code 13** (owner banned): immediately remove/disable the key and stop all polling

### Globally cached selections (Torn-side, cannot bypass)

Polling these faster than their cache interval yields stale data regardless of local interval:

| Selection | Cached endpoint |
|-----------|----------------|
| `market` | itemmarket, properties, rentals |
| `company` | companies |
| `user` | bazaar, bounties |
| `torn` | bounties |

---

## Faction Buffs

Faction buffs rotate monthly and vary per faction. **Never hardcode buff values.** Always accept as user-configured input via localStorage or UI settings.

---

## Permitted Data Sources

All scripts in this repo may only use:

1. **Torn official API** (`https://api.torn.com/`) with the player's own key
2. **Page DOM** — only the page currently loaded and actively viewed; no background tabs, no unfocused-window reads
3. **TornW3B** (`https://weav3r.dev/api`) — unconditional where used; no opt-in required; no opt-in UI should be added

No other external sources. No CAPTCHA bypass. No non-API Torn HTTP requests.

---

## Automation Prohibition

No automated clicking, form submission, or game actions of any kind. No non-API Torn polling on a timer. API polling is permitted but must be rate-limited and scoped to data the script genuinely needs.

---

## API Key Rules

- Always use `###PDA-APIKEY###` placeholder in userscript source — never hardcode real keys
- Never request passwords, player names, or player IDs
- Never store keys outside `localStorage`; never transmit externally without explicit opt-in + disclosure table in UI
- On error codes 2 or 13: immediately remove/disable the key and stop polling

---

## Disclosure Requirement

Required **only** when a script stores API data or keys outside `localStorage` OR shares data externally. Display this table in the UI at the key-entry point:

| Data Storage | Data Sharing | Purpose of Use | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| *Only locally* | *Nobody* | *[purpose]* | *Not stored/Not shared* | *[selections used]* |

**All current scripts are local-only** — the filled-in row above is the correct disclosure for them.

---

## Pre-Commit Compliance Checklist

Verify every box before committing any script change:

- [ ] Script only reads from official API, TornW3B, or currently-viewed DOM
- [ ] No background scraping, unfocused-tab reads, or non-API Torn requests
- [ ] No automated game actions (clicks, submissions, etc.)
- [ ] API polling interval ≥ 5 minutes; total requests well under 100/min
- [ ] Only minimum required API selections are requested
- [ ] API key via `###PDA-APIKEY###` or localStorage; never transmitted externally
- [ ] Invalid key (codes 2, 13) immediately removed/disabled
- [ ] No passwords or usernames requested
- [ ] If data/keys leave localStorage, disclosure table shown in UI
- [ ] No hidden, obfuscated, or undisclosed functionality
