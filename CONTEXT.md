# Snipe Tracker

A Torn City userscript that monitors item market and bazaar listings for profitable buy-and-flip opportunities, and tracks the resulting trades in a persistent ledger.

## Language

**Snipe**:
A listing priced below an item's snipe threshold (fair value × (1 − threshold%)) — indicates a buy-and-flip opportunity with potential profit.
_Avoid_: deal, cheap listing, bargain

**Fair Value**:
The P50 price of current listings for an item, weighted by listing count (not quantity). One seller with 500 units counts as one data point.
_Avoid_: market price, median price

**Snipe Threshold**:
The price ceiling below which a listing qualifies as a Snipe. Computed as `fairValue × (1 − threshold%)`. Each item has its own threshold percentage.
_Avoid_: cutoff, trigger price

**Flood**:
A market condition where a large-quantity listing (100+ units) exists below fair value, anchoring the resale ceiling and limiting the sell target for anyone holding the item.
_Avoid_: oversupply, dump, wall

**Flood Play**:
An actionable opportunity arising from a Flood — the flood price is at the true market floor AND fair value is high enough above it (by at least threshold%) to flip profitably. Distinct from a Snipe: the current lowest price may not be below the snipe threshold, but the flood quantity itself is the buy target. More speculative than a Snipe — validity depends on price trend direction.
_Avoid_: flood snipe

**Snipe** vs **Flood Play** in the UI: mutually exclusive status labels. An item shows SNIPE when the lowest listed price is below the snipe threshold. It shows FLOOD only when not in Snipe status but flood play conditions are met.

**Sell Target**:
The recommended resale price for a sniped item. Computed by `computeSmartSellPosition`: anchored just below the first significant volume block above the snipe price, adjusted for trend.
_Avoid_: resale price, exit price

**Volume Block**:
A price tier where total listed quantity × price exceeds 10% of available capital. Indicates a supply wall the user would need to undercut to move inventory.
_Avoid_: wall, supply ceiling

**Available Capital**:
Vault balance minus a user-configurable floor percentage. Represents spendable funds for snipe buys.
_Avoid_: budget, balance

**Pending Queue**:
An in-memory list of items flagged for logging during the current session. Not persisted. Items are pushed when the user clicks Queue on a snipe card, and flushed to the trade ledger when logged.
_Avoid_: cart, watchlist

**Trade**:
A logged buy event stored in the ledger. Captures item, buy price, quantity, timestamp, and sell target at time of logging.
_Avoid_: position, order

## Relationships

- A **Snipe** is detected when the lowest listed price crosses below the **Snipe Threshold**
- A **Snipe Threshold** is derived from **Fair Value** and a per-item threshold percentage
- A **Sell Target** is computed relative to the snipe price, available capital, and **Volume Blocks** above it
- A **Flood Play** uses the same threshold % as its item's Snipe, but the trigger is flood quantity at the floor rather than a cheap individual listing
- A **Pending Queue** entry becomes a **Trade** when the user logs it from the Quick Log strip

## Example dialogue

> **Dev:** "If Xanax drops to $750k and fair value is $850k with a 10% threshold, is that a Snipe?"
> **Domain expert:** "Yes — snipe threshold is $765k, so $750k qualifies. Now check for a Volume Block above $750k to set the Sell Target."

> **Dev:** "What if there are 200 units of Xanax at $780k and nothing below $850k otherwise?"
> **Domain expert:** "That's a Flood condition — the $780k wall anchors anyone's Sell Target. If the trend isn't falling and fair value is high enough above it, it could qualify as a Flood Play."

**Snipe Frequency**:
The number of times an item's lowest listed price has crossed downward through the snipe threshold within a rolling window. Counts transitions (above→below), not sustained below-threshold states. Used for watchlist curation and as a secondary sort criterion.
_Avoid_: snipe count, hit rate

**Snipe Alert**:
A notification + audio chime fired once when an item first enters snipe territory during a poll cycle. Does not repeat while the item remains below threshold — only fires again on the next fresh crossing.
_Avoid_: snipe notification, price alert

**Mug Scenario**:
A risk projection shown when projected sale value (sell target × quantity) exceeds the mug threshold. Computes net outcome after a mugging at a fixed 15% loss rate, accounting for buy cost. Shows whether the trade remains profitable even if mugged.
_Avoid_: mug risk, theft risk

**Mug Threshold**:
The sale value ($10M) above which mug risk is considered material and the Mug Scenario is shown.

## Relationships

- A **Snipe Frequency** is derived from the item's snapshot history using the item's own **Snipe Threshold**
- A **Snipe Alert** fires on the first crossing that would qualify as a **Snipe**, during an API poll cycle
- A **Mug Scenario** is only shown when sell target × quantity exceeds the **Mug Threshold**

## Flagged ambiguities

- "flood" was used to describe both the market condition (large qty below fair value) and the buy opportunity — resolved: **Flood** = condition, **Flood Play** = opportunity.
