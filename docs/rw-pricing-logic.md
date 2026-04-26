# RW Auction Advisor — Pricing Logic Reference

All formulas, fee structures, and valuation rules for the RW Auction Advisor.
Sourced from: King's RW Guide, RW Buyer's Math, Steps 1–2 web research,
TORN V2 API References, and TornW3B API docs.

---

## 1. Fee Structure

| Fee | Rate | Applied to |
|-----|------|-----------|
| Item market sell fee | **5%** | Seller pays on market sales |
| Auction house sell fee | **3%** | Seller pays on final auction price |
| Mug loss (script muggers, typical) | **7–8%** | Assassinate-gun scripts |
| Mug loss (manual / red plunder) | **10–15%** | Worst-case offline exposure |

### Effective sell-side take rate

When listing on item market and accounting for mug risk:

```
net_received = listing_price × (1 - 0.05) × (1 - mug_rate)
```

For a conservative trader assuming 10% mug exposure:
```
net_received ≈ listing_price × 0.85
```

---

## 2. Bunker Bucks (BB) Floor

### BB value per buck

```
bb_value = cheapest_small_arm_cache_price / 20
```

Example: cache at 120m → `120m / 20 = 6m per BB`

### BB multipliers by rarity (all armor piece types — helmet, body, gloves, boots, pants)

| Rarity | BB per piece |
|--------|-------------|
| Yellow | **12 BB** |
| Orange (1 or 2 bonuses) | **26 BB** |
| Red (1 or 2 bonuses) | **108 BB** |

Applies equally to Riot, Assault, Dune, Delta, Marauder, Sentinel, Vanguard, EOD.

### BB floor price per piece

```
bb_floor = bb_multiplier × bb_value
         = bb_multiplier × (cache_price / 20)
```

Example (yellow piece, cache at 120m):
```
bb_floor = 12 × 6m = 72m
```

### Dune/Riot armor vs BB floor

Dune and Riot prices are correlated to BB value. Target: buy at or within ~25m above BB floor.
Assault armor does **not** approach BB floor — it trades significantly above it.

---

## 3. Auction Max Bid — Weapons

The max bid is derived by discounting the cheapest comparable item market listing:

```
max_bid = reference_market_price × (1 - discount_rate)
```

### Discount rate breakdown

| Component | Rate |
|-----------|------|
| Item market sell fee | 5% |
| Mug loss buffer | 10% |
| Profit margin target | 5–10% |
| **Total discount** | **20–25%** |

```
max_bid = reference_market_price × 0.75   # conservative (25% off)
max_bid = reference_market_price × 0.80   # standard (20% off)
```

### Reference price selection rules

1. Find the cheapest item market listing for the exact weapon + bonus combination
2. Cross-check with similar weapons carrying the same bonus
3. Cross-check with the same weapon carrying similar bonuses
4. If market listings appear inflated (seller is a trader, only 1–2 listings, price far above auction comps), use auction history as the reference instead
5. For high-roll or high-quality weapons (130%+ yellow, 200%+ orange): exclude from standard comps — they command premiums not captured by base references

---

## 4. Auction Max Bid — Armor (Yellow Riot and Assault)

### Riot and Dune armor

```
max_bid_riot = bb_floor + small_premium   # typically within 25m of bb_floor
```

Target: buy as close to BB floor as possible. Base-stat Riot pieces with no special quality or bonus premium should approach BB price in auction.

### Assault armor (base-stat, low quality)

```
max_bid_assault = item_market_value × (1 - 0.10 to 0.20)
                = item_market_value × 0.80 to 0.90
```

Bid 10–20% below current item market value on auction. Assault market is flooded — patience wins.

### High quality / high bonus % armor (any set)

```
max_bid_hq = base_listing_price × multiplier
```

| Quality / bonus tier | Max multiplier |
|----------------------|---------------|
| Good (above average quality or bonus) | 2.0× base listing |
| Exceptional (very high quality AND high bonus %) | 2.5–3.0× base listing |

**Never buy high-quality armor directly from item market** — market prices run 3–4× base listing value for high-quality pieces.

---

## 5. Armor Quality Scoring (King's Method)

Used to compare two pieces of the same armor type when one has higher quality but lower bonus, or vice versa.

```
score = quality_pct + (bonus_pct - base_bonus_pct) × 5
```

With a bonus tier premium:

```
if bonus_pct >= 26% (Riot/Assault) or >= 37% (Dune):
    score += 5
```

### Base bonus reference values

| Armor set | Base bonus % |
|-----------|-------------|
| Riot | 20% |
| Assault | 20% |
| Dune | 30% |

### Example

Riot Body A: quality 46.95%, bonus 25% → `46.95 + (25 - 20) × 5 = 71.95`
Riot Body B: quality 60.98%, bonus 21% → `60.98 + (21 - 20) × 5 = 65.98`
**Body A wins** despite lower quality.

### Community consensus

For yellow range armor, quality is generally considered more important than bonus % by most traders. The formula above reflects King's personal method; adjust weight as needed.

---

## 6. Net Profit Calculation (Trader / Flip Perspective)

### When selling on item market

```
net_profit = sell_price × (1 - market_fee) × (1 - mug_rate) - buy_price
           = sell_price × 0.95 × (1 - mug_rate) - buy_price
```

### Minimum listing price to hit target profit margin

```
min_list_price = (buy_price + target_profit) / (1 - market_fee) / (1 - mug_rate)
               = (buy_price + target_profit) / 0.85   # at 10% mug exposure
```

### Markup rules (trader selling on market)

| Markup on listing | Notes |
|-------------------|-------|
| Minimum 20–30% above buy price | Before negotiation |
| Expect buyer to negotiate 10% off list | Real-world norm |
| Net profit target after fees | 10–20% |

---

## 7. Max Offer Price — RW Auction Advisor Core Formula

The advisor recommends a **max offer price** for any auction listing. The goal: the highest price at which the buyer can resell the item and still hit their target profit margin after all fees.

### Inputs

| Variable | Description |
|----------|-------------|
| `ref_price` | Best available price reference (item market comp or auction comp) |
| `target_margin` | User-defined profit target (default 15%) |
| `mug_buffer` | Optional mug loss buffer (default 10%) |
| `market_fee` | Fixed at 5% |

### Formula

```
max_offer = ref_price × (1 - market_fee) × (1 - mug_buffer) × (1 - target_margin)
          = ref_price × 0.95 × (1 - mug_buffer) × (1 - target_margin)
```

With defaults (10% mug, 15% margin):
```
max_offer = ref_price × 0.95 × 0.90 × 0.85
          = ref_price × 0.7267
          ≈ ref_price × 0.73
```

### Armor-specific override

For Riot/Dune: compare the formula result against BB floor and use **whichever is higher** as the floor guard:
```
max_offer = max(formula_result, bb_floor + small_premium)
```

For Assault: use formula result directly (Assault does not approach BB).

---

## 8. Price Reference Hierarchy

In order of reliability (most → least):

1. **Recent completed auction records** — via `GET /market/{id}/auctionhouse` filtered by timestamp
2. **Live item market listings** with full stats — via `GET /market/{id}/itemmarket`
3. **TornW3B ranked-weapons** — `GET /ranked-weapons?tab=armor&armorSet=...` (opt-in, external)
4. **Current page DOM** — armor stats and bonus visible on `amarket.php` listing
5. **Forum/bazaar listings** — generally inflated; use as upper bound only

---

## 9. Auction Mechanics That Affect Bidding

- **Proxy bidding:** Listed price = second-highest bid + $1. Top bidder's max is hidden.
- **Timer reset:** Any bid within the last 1 minute resets the clock to 1 minute.
- **Bids are final:** Cannot cancel or raise your own bid without being outbid first.
- **Cashier's check:** Returned if outbid; auto-deposits to wallet after 24 hours (mug risk).
- **Seller fee:** 3% of final sale price deducted from seller's proceeds.

### Bidding discipline rules

- Set a hard max before bidding — never adjust upward in the heat of last-minute bidding
- Winning more than 50% of bids = overbidding; pull back
- Ideal buy: confident the item can be re-auctioned and break even or better
