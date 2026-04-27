# Ubiquitous Language — RW Auction Advisor

_Generated from: CLAUDE.md, .claude/memory.md, docs/rw-pricing-logic.md, docs/rw-armor-guide.md, docs/rw-community-context.md, docs/rw-api-reference.md_

---

## Auction House

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Listing** | A single item put up for auction on `amarket.php`, as seen in the DOM | "auction", "item on sale" |
| **Current bid** | The highest bid placed on a listing at the time the page was scraped | "price", "bid amount", "listed price" |
| **Max offer** | The advisor's computed ceiling — the highest amount the player can bid and still hit their target margin after all fees | "max bid", "recommended bid", "offer price" |
| **Safe bid** | A bid placed by a friend of the seller at the seller's minimum acceptable price, acting as a floor; if nobody beats it the item returns to the seller | "fake bid", "floor bid" |
| **Proxy bidding** | Torn's auction mechanic where the displayed price equals the second-highest bid + $1; the winning bidder's true maximum is hidden | — |
| **Cashier's check** | The refund a losing bidder receives; sits outside the wallet for up to 24 hours and is vulnerable to mugging if auto-deposited | — |

---

## Market Channels

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Item market** | Torn's fixed-price marketplace where sellers list gear at a set price; subject to a 5% seller fee and script mug risk | "market", "player market", "Torn market" |
| **Bazaar** | Player-run storefronts accessible via the TornW3B API; a separate channel from the item market with different pricing dynamics | "market", "player shop" |
| **Comp** | A comparable listing — a live or recent sale of the same armor piece type and rarity used as a price reference | "reference", "market data", "price point" |
| **Ref price** | The single best-available price reference selected from comps for use in the max offer formula; ranked by reliability (auction history > item market > bazaar) | "reference price", "market price", "comp price" |
| **Dead inventory** | Gear that cannot sell at its target price and ties up the player's liquid capital | "stuck inventory", "unsold item" |

---

## Pricing and Fees

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **BB floor** | The minimum fair value of an armor piece, computed as `bb_multiplier × (cache_price / 20)`; acts as a hard floor for max offer on Riot/Dune pieces | "BB price", "bunker price", "BB value" |
| **BB rate** | The current value of one Bunker Buck in cash, derived from `cheapest small arm cache price ÷ 20` | "BB value per buck", "BB price" |
| **Market fee** | Fixed 5% deducted from the seller's proceeds when selling on the item market | "sell fee", "market tax", "5% fee" |
| **Auction fee** | Fixed 3% deducted from the seller's proceeds on the final auction sale price | "seller fee", "auction tax" |
| **Mug buffer** | A user-configured percentage (default 10%) subtracted from the projected sell proceeds to account for mugging risk; included in every max offer calculation | "mug rate", "mug tax", "mug protection", "mug loss" |
| **Target margin** | The user-configured minimum profit percentage the player requires to make a flip worthwhile; drives the max offer formula | "profit target", "target profit", "profit %", "margin" |
| **Net profit** | The actual profit after deducting market fee, mug buffer, and buy price from the sell price | "profit", "P&L", "gain" |
| **Flip** | Buying a listing at auction with the intent to resell it on the item market or bazaar at a profit | "trade", "arbitrage" |
| **ROI** | Net profit expressed as a percentage of the amount paid at auction | "return", "return on investment" |

---

## Armor

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Armor set** | One of the eight named full sets (Riot, Assault, Dune, Delta, Marauder, Vanguard, Sentinel, EOD); a set consists of five pieces | "armor type", "gear set" |
| **Piece** | One of the five slots within an armor set: Helmet, Body, Pants, Gloves, Boots | "item", "part", "piece of armor" |
| **Rarity** | The quality tier of a piece: yellow (standard), orange (one or two bonuses), or red (one or two bonuses); determines BB multiplier and pricing behavior | "color", "tier" (when meaning rarity), "grade" |
| **Quality %** | The numeric armor stat percentage scraped from the listing DOM (format: `Q 12.8%`); represents raw damage mitigation | "quality", "armor quality", "Q value" |
| **Bonus %** | The percentage value of the piece's special bonus (e.g. Impregnable 21%); higher is more valuable, especially for orange/red | "bonus", "special bonus", "Impregnable %", "Impenetrable %" |
| **Base bonus %** | The minimum bonus % for a given set at yellow rarity (Riot = 20%, Assault = 20%, Dune = 30%); used as the reference point in King's score formula | "floor bonus", "default bonus" |
| **Score** | King's composite value rating: `quality_pct + (bonus_pct - base_bonus_pct) × 5`, plus +5 if bonus_pct exceeds the tier threshold; used to compare two pieces of the same type | "King's score", "value score", "composite score" |
| **Full set bonus** | The additional effect granted when wearing all five pieces of the same armor set (e.g. Riot: +10% melee reduction / Impregnable) | "set bonus", "bonus for full set" |
| **Mixed set** | A configuration where the player wears pieces from more than one armor set, forfeiting the full set bonus of both | "hybrid set", "partial set" |

---

## Quality Tiers (Pricing Classification)

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Base tier** | A piece with quality < 25% AND bonus ≤ base_bonus_pct + ~3%; priced relative to BB floor or lowest market undercut | "low quality", "standard", "normal" |
| **HQ tier** | A piece with quality ≥ 25% OR bonus meaningfully above base; commands a premium over base-tier comps | "high quality", "good", "above average" |
| **Exceptional tier** | A piece with both high quality AND high bonus %; commands 2.5–3× base listing and warrants manual research | "great", "top tier", "elite", "best in slot" |

---

## Script UI

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Advisory strip** | The inline UI row injected beneath each auction listing on `amarket.php`; shows max offer, ROI, and color-coded signal | "strip", "banner", "bar" |
| **Context panel** | The expandable `▼ Details` section that shows BB floor, comp source, quality badge, King's cap warning, and net profit | "details panel", "expanded view", "detail row" |
| **Comp panel** | The two-column Market/Bazaar table of comparable listings shown inside the context panel | "comparables panel", "market panel", "price panel" |
| **Ledger** | The sidebar log of listings the player has chosen to track; persists to localStorage | "trade log", "history", "journal" |
| **Ledger entry** | One row in the ledger; captures item, rarity, quality, bonus, bid, max offer, score, and outcome | "log entry", "record", "row" |
| **Result** | The outcome of a tracked listing: `—` (pending), `Won`, `Lost`, or `Passed` | "outcome", "status", "resolution" |
| **Actual sell price** | The price the player received when selling a Won piece; entered manually and used to compute actual net profit | "sell price", "sale price", "final price" |
| **actualNet** | The computed net profit for a Won entry: `actualSellPrice × (1 − marketFee) × (1 − mugBuffer) − currentBid` | "actual profit", "real profit", "net" |

---

## Actors

| Term | Definition | Aliases to avoid |
|------|-----------|-----------------|
| **Player** | The Torn City account running the script; the entity making bidding decisions | "user", "you", "buyer" (when ambiguous) |
| **Trader** | A player who buys RW gear specifically to resell at a profit; often controls large inventory | "seller", "dealer", "flipper" |
| **Script mugger** | An automated mugging script that detects item market sales via the Torn API or WebSockets and attacks the seller immediately | "mugger", "API mugger" |

---

## Relationships

- A **listing** has one **rarity**, one **quality %**, and one **bonus %**; the **score** combines the latter two via King's formula.
- The **ref price** is selected from **comps** and fed into the max offer formula alongside **target margin**, **mug buffer**, and **market fee** to produce the **max offer**.
- The **BB floor** overrides the formula result for Riot/Dune pieces when the formula produces a lower value.
- A **ledger entry** captures a **listing** snapshot at log time; its **result** unlocks the **actual sell price** input, which produces **actualNet**.
- A **flip** is profitable when **actualNet** > 0 after **market fee** and **mug buffer** are applied.

---

## Example Dialogue

> **Dev:** "This Riot Body has a quality of 46% and a bonus of 25% — what's the ref price based on?"
>
> **Player:** "I need to see the **comps**. Pull the top **item market** and **bazaar** listings for the same **piece** and **rarity**. The cheapest bonus-matched comp with similar **quality %** becomes the **ref price**."
>
> **Dev:** "The comp panel shows five listings — which one do we use?"
>
> **Player:** "The one whose **quality %** and **bonus %** sit closest to this **listing**'s stats. We're not just taking the cheapest — we want a true peer, not a base-stat piece. That's what the **comp panel** is showing: the window of pieces centred around this piece's position."
>
> **Dev:** "The **max offer** comes out to 180m. The current bid is 175m. Do we bid?"
>
> **Player:** "Only if 175m clears our **target margin** after **market fee** and **mug buffer**. Run the **actualNet** — if we could sell the piece today at the **ref price**, what do we net? If that number is positive and above our floor, the bid is live."
>
> **Dev:** "It's a **base tier** piece — does the **BB floor** matter here?"
>
> **Player:** "Yes. For Riot, the **max offer** can never go below **BB floor**. Even if the formula says 160m and BB floor is 170m, we use 170m. We're not bidding below what we could recover from a BB trade."

---

## Flagged Ambiguities

- **"Tier"** is used for two unrelated concepts: *rarity tier* (yellow/orange/red) and *quality tier* (base/HQ/exceptional). Use **rarity** for the color classification and **tier** only when explicitly qualified as quality tier (e.g. "base tier", "HQ tier").
- **"Price"** appears as: current bid, max offer, ref price, comp price, list price, and BB floor. Always use the specific term — never bare "price" in code comments or UI labels.
- **"Market"** ambiguously refers to the item market, the auction house, or the general trading ecosystem. Use **item market**, **auction house**, or **bazaar** specifically.
- **"Max bid"** (docs/rw-pricing-logic.md) and **"max offer"** (script UI, memory.md) refer to the same computed value. Canonical term: **max offer** — consistent with the advisory strip label and the variable name in code.
- **"Quality"** used as an adjective ("high quality piece") collides with **quality %** as a numeric stat. Use **quality %** for the stat, and **HQ tier** or **exceptional tier** for qualitative descriptions.
- **"Comp"** is used for both the act of comparison and a single comparable listing. Use **comp** as a noun (a single comparable listing) and **comps** for the set of them.
