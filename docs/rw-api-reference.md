# RW Auction Advisor — API Reference

All API endpoints, response schemas, rate limits, authentication rules,
and compliance constraints for the RW Auction Advisor.
Sourced from: TORN V2 API References.txt, TornW3B API (weav3r.dev).txt,
and Steps 1–2 web research.

---

## 1. Torn Official API v2

**Base URL:** `https://api.torn.com/v2`
**Spec:** OAS 3.1 (v5.7.1) — still in active development
**Auth:** Public API key via `?key=` query param or `Authorization` header
**Key placeholder (PDA):** `###PDA-APIKEY###`

### Notes
- Selections left unmodified default to API v1 behavior
- Unlike v1, v2 accepts both selections and IDs as path and query parameters
- Cache bypass: add `&timestamp=<unix>` to any request where fresh data is needed
- Globally cached selections (marked below) cannot be meaningfully polled faster than their cache TTL

---

### 1.1 `GET /market/auctionhouse`

**Purpose:** Retrieve all auction house listings (paginated)
**Auth:** Public key
**Cache:** Not globally cached

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `limit` | int | 20 | Max records to return |
| `sort` | string | DESC | `DESC` or `ASC` by timestamp |
| `from` | int | — | Unix timestamp lower bound |
| `to` | int | — | Unix timestamp upper bound |
| `timestamp` | string | — | Cache bypass |
| `comment` | string | — | Tool identifier for API logs |
| `key` | string | — | Public API key |

#### Response schema

```json
{
  "auctionhouse": [
    {
      "id": 1073741824,
      "seller": { "id": 1073741824, "name": "string" },
      "buyer":  { "id": 1073741824, "name": "string" },
      "timestamp": 1073741824,
      "price": 1073741824,
      "bids": 1073741824,
      "item": {
        "id": 9007199254740991,
        "uid": 9007199254740991,
        "name": "string",
        "type": "string"
      }
    }
  ],
  "_metadata": {
    "links": { "next": "string", "prev": "string" }
  }
}
```

#### Limitations
- Base response does **not** include weapon/armor stats (damage, accuracy, quality, bonuses)
- Stats require a separate call to `/market/{id}/itemmarket` using the item `id`
- `buyer` is populated for completed auctions; null/absent for active listings

---

### 1.2 `GET /market/{id}/auctionhouse`

**Purpose:** Auction listings filtered to a specific item ID
**Auth:** Public key
**Path param:** `id` — Torn item ID (integer)

Parameters and response schema are identical to §1.1.

#### Usage for RW Auction Advisor
Use this endpoint to pull recent completed auction records for the specific
armor piece being evaluated. Filter by `from`/`to` timestamps to get
the last 30–90 days of sales as comp data.

---

### 1.3 `GET /market/{id}/auctionhouselisting`

**Purpose:** Retrieve a single auction listing by listing ID
**Auth:** Public key
**Path param:** `id` — listing ID (integer, not item ID)

#### Response schema

```json
{
  "id": 1073741824,
  "seller": { "id": 1073741824, "name": "string" },
  "buyer":  { "id": 1073741824, "name": "string" },
  "timestamp": 1073741824,
  "price": 1073741824,
  "bids": 1073741824,
  "item": {
    "id": 9007199254740991,
    "uid": 9007199254740991,
    "name": "string",
    "type": "string"
  }
}
```

---

### 1.4 `GET /market/{id}/itemmarket`

**Purpose:** Item market listings with full weapon/armor stats
**Auth:** Public key
**Cache:** **Globally cached** — do not poll more frequently than cache TTL
**Path param:** `id` — Torn item ID (integer)

#### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `bonus` | string | Any | Filter by bonus name (see full enum below) |
| `limit` | int | 20 | Max records |
| `offset` | int | 0 | Pagination offset |
| `timestamp` | string | — | Cache bypass |
| `comment` | string | — | Tool identifier |
| `key` | string | — | Public API key |

#### Bonus filter enum (full list)
`Any, Double, Yellow, Orange, Red, Achilles, Assassinate, Backstab, Berserk,
Bleed, Blindfire, Blindside, Bloodlust, Burn, Comeback, Conserve, Cripple,
Crusher, Cupid, Deadeye, Deadly, Demoralize, Disarm, Double-edged, Double Tap,
Emasculate, Empower, Eviscerate, Execute, Expose, Finale, Focus, Freeze,
Frenzy, Fury, Grace, Hazardous, Home run, Irradiate, Lacerate, Motivation,
Paralyze, Parry, Penetrate, Plunder, Poison, Powerful, Proficience, Puncture,
Quicken, Rage, Revitalize, Roshambo, Shock, Sleep, Slow, Smash, Smurf,
Specialist, Spray, Storage, Stricken, Stun, Suppress, Sure Shot, Throttle,
Toxin, Warlord, Weaken, Wind-up, Wither`

#### Response schema

```json
{
  "itemmarket": {
    "item": {
      "id": 9007199254740991,
      "name": "string",
      "type": "string",
      "average_price": 9007199254740991
    },
    "listings": [
      {
        "price": 9007199254740991,
        "amount": 1073741824,
        "item_details": {
          "uid": 9007199254740991,
          "stats": {
            "damage": 0.1,
            "accuracy": 0.1,
            "armor": 0.1,
            "quality": 0.1
          },
          "bonuses": [
            {
              "id": 1073741824,
              "title": "string",
              "description": "string",
              "value": 1073741824
            }
          ],
          "rarity": "yellow"
        }
      }
    ],
    "cache_timestamp": 1073741824,
    "cache_delay": 1073741824
  },
  "_metadata": {
    "links": { "next": "string", "prev": "string" }
  }
}
```

Note: Not every listing object includes `item_details` — base-stat or non-RW
items may return the listing without the stats block.

---

### 1.5 `GET /user/money`

**Purpose:** Authenticated user's current wealth breakdown
**Auth:** Limited key (more permissive than public)

#### Response schema

```json
{
  "money": {
    "points": 9007199254740991,
    "wallet": 9007199254740991,
    "vault": 9007199254740991,
    "cayman_bank": 9007199254740991,
    "city_bank": {
      "amount": 9007199254740991,
      "interest_rate": 0.1,
      "until": 9007199254740991
    },
    "faction": { "money": 9007199254740991, "points": 9007199254740991 },
    "daily_networth": 9007199254740991
  }
}
```

---

### 1.6 Torn Item IDs — Riot and Assault Armor

The `/market/{id}/auctionhouse` and `/market/{id}/itemmarket` endpoints
require numeric Torn item IDs. Known values from community sources:

| Piece | Confirmed ID |
|-------|-------------|
| Riot Helmet | **654** |
| Riot Body | **655** |
| Riot Pants | **656** |
| Riot Gloves | **657** (unconfirmed) |
| Riot Boots | **658** (unconfirmed) |
| Assault armor pieces | **659–663** range (exact mapping unconfirmed) |

**Recommended approach:** Resolve IDs at runtime via the v1 endpoint
`GET https://api.torn.com/torn/?selections=items&key=<KEY>` which returns
the full item catalog keyed by ID. Look up by `name` field to map piece
names to IDs without hardcoding.

---

## 2. Auction House Page (DOM)

**URL:** `https://www.torn.com/amarket.php`
**Tampermonkey @match:** `https://www.torn.com/amarket.php*`

### Key DOM selectors

| Purpose | Selector |
|---------|----------|
| Individual listing items | `ul.items-list li` |
| Item name | `span.title` |
| Bonus icons / tooltip data | `.iconsbonuses span` |
| Rarity detection | CSS class prefix `glow-` (e.g. `glow-red`, `glow-orange`, `glow-yellow`) |
| Non-listing entries to skip | `li.last`, `li.clear` |

### Data available from DOM (no API call needed)
- Item name and type
- Bonus name(s) visible via icon tooltips
- Current bid / listed price
- Rarity (glow class)
- Time remaining on listing

---

## 3. TornW3B API (weav3r.dev)

**Base URL:** `https://weav3r.dev/api`
**Spec:** OAS 3.0 (v1.0.0)
**Auth:** None required
**Cache:** 60 seconds
**Rate limit:** 100 calls/min (Cloudflare-enforced)
**Maintained by:** Community developer Weav3r

### ⚠ Compliance Requirement

TornW3B is an **external third-party service** at `weav3r.dev`.
Under Torn's scripting rules, scripts may only consume data from:
1. The official Torn API (`https://api.torn.com/`)
2. The DOM of the page currently viewed by the user

**Using TornW3B requires:**
- Explicit user opt-in toggle in the script UI
- The following ToS disclosure table shown at opt-in:

| Data Storage | Data Sharing | Purpose | Key Storage & Sharing | Key Access Level |
|---|---|---|---|---|
| Not stored | Service owners | Public community tools | Not stored/Not shared | N/A (no key sent) |

---

### 3.1 `GET /marketplace`

**Purpose:** All Torn items with aggregated price data

#### Response schema

```json
{
  "total_count": 0,
  "items": [
    {
      "item_id": 0,
      "item_name": "string",
      "market_price": 0,
      "bazaar_average": 0,
      "lowest_price": 0,
      "total_bazaars": 0
    }
  ],
  "response_time_ms": 0
}
```

---

### 3.2 `GET /marketplace/{itemId}`

**Purpose:** Single item with all current bazaar listings
**Path param:** `itemId` — Torn item ID (integer)

#### Response schema

```json
{
  "item_id": 0,
  "item_name": "string",
  "market_price": 0,
  "bazaar_average": 0,
  "total_listings": 0,
  "listings": [
    {
      "item_id": 0,
      "player_id": 0,
      "player_name": "string",
      "quantity": 0,
      "price": 0,
      "content_updated": 0,
      "last_checked": 0,
      "content_updated_relative": "string",
      "last_checked_relative": "string"
    }
  ]
}
```

---

### 3.3 `GET /ranked-weapons`

**Purpose:** RW weapons and armor with rich filtering — most useful endpoint
for the RW Auction Advisor
**Requirement:** At least one filter parameter must be provided

#### Parameters

| Name | Type | Options / Notes |
|------|------|----------------|
| `tab` | string | `weapons`, `armor` |
| `weaponType` | string | `melee`, `primary`, `secondary`, `defensive` |
| `weaponName` | string | Exact weapon name |
| `rarity` | string | `yellow`, `orange`, `red` |
| `bonus1` | string | Bonus name |
| `bonus2` | string | Second bonus name |
| `bonusCount` | string | `1` or `2` |
| `armorPiece` | string | Piece name (for armor tab) |
| `armorSet` | string | Set name e.g. `Riot`, `Assault` |
| `minPrice` / `maxPrice` | number | Price range filter |
| `minDamage` / `maxDamage` | number | Damage range filter |
| `minAccuracy` / `maxAccuracy` | number | Accuracy range filter |
| `minQuality` / `maxQuality` | number | Quality range filter |
| `minBonus1Value` / `maxBonus1Value` | number | Bonus value range |
| `minBonus2Value` / `maxBonus2Value` | number | Second bonus value range |
| `sortField` | string | `price`, `damage`, `accuracy`, `quality`, `itemName`, `weaponType`, `rarity`, `bonus1`, `bonus2` |
| `sortDirection` | string | `asc` (default), `desc` |

#### Response schema

```json
{
  "total_count": 0,
  "weapons": [
    {
      "uid": "string",
      "itemId": 0,
      "itemName": "string",
      "weaponType": "string",
      "rarity": "Yellow",
      "damage": "string",
      "accuracy": "string",
      "quality": "string",
      "bonuses": {
        "bonus1key": {
          "bonus": "string",
          "value": 0,
          "description": "string"
        }
      },
      "price": 0,
      "playerId": 0,
      "playerName": "string",
      "quantity": 0,
      "marketPrice": 0,
      "lastUpdated": "2026-04-25T23:59:10.527Z",
      "itemImage": "string"
    }
  ],
  "response_time_ms": 0
}
```

#### Usage for RW Auction Advisor (opt-in)
Query `?tab=armor&armorSet=Riot&rarity=yellow&sortField=price&sortDirection=asc`
to get a sorted list of all current yellow Riot armor listings with quality
and bonus data — useful as a quick market comp when the official API cache
is stale.

---

## 4. Rate Limiting Summary

| Source | Limit | Min poll interval |
|--------|-------|------------------|
| Torn official API | 100 req/min across all keys | 5 min for most selections |
| Torn itemmarket (globally cached) | Cache TTL applies | Poll only on user action |
| TornW3B (opt-in) | 100 req/min (Cloudflare) | 60s cache; poll on user action |

### Script polling rules
- Never poll the Torn API on a timer without the user actively viewing the page
- Use `timestamp` cache-bypass parameter only when fresh data is genuinely required
- Request only the selections needed; never batch broad selections for future use
- On API error code 2 (bad key) or 13 (banned key): disable the key immediately
