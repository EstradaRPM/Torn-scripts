# RW Auction Advisor — Armor Guide

Riot vs Assault use cases, piece priority, set bonuses, mixed set logic,
armor tier breakdown, and budget recommendations.
Sourced from: King's RW Guide, RW Buyer's Math, and Steps 1–2 web research.

---

## 1. Armor Set Overview

| Set | Damage reduction | Primary use case | Price tier |
|-----|-----------------|-----------------|-----------|
| Dune | Incoming damage when below 1/4 life | Comeback weapon synergy only | Cheapest (~BB) |
| Riot | Incoming melee damage | Chains, missions, anti-mug | Low (~BB to small premium) |
| Assault | Incoming gun damage | Wars | Medium (above BB) |
| Delta | Negative status effects (debuffs) | Dex builds, grouped war targets | Medium-High |
| Marauder | Increased life | High-stat non-level-holders | High |
| Vanguard | Increased dexterity (+150–190%) | Dex whores | High |
| Sentinel | Increased defense (+150–190%) | Def whores | High |
| EOD | Chance to fully block incoming damage (~30%+) | Rich players, glass cannons | Very High |

---

## 2. Set-by-Set Use Cases

### Dune
Activates only when the wearer drops below 1/4 life. In practice:
- At low stats, players die before reaching the 1/4 threshold
- At high stats, execute pistols kill before any damage reduction helps
- Only genuinely useful paired with a comeback bonus weapon

**Verdict:** Do not buy Dune armor unless running a comeback build.
Price target: at or very close to BB floor.

---

### Riot
Reduces incoming **melee** damage. Underrated by most players.

**Strengths:**
- Great armor coverage — reduces deadly crits from armor gaps
- In low-stat fights, opponents often have no ammo and resort to melee
- Riot Helmet specifically blocks pepper spray
- Best armor for missions and chains where targets are inactive (no ammo)
- Solid anti-mug armor

**Full set bonus:** +10% additional reduction to melee damage (Impregnable bonus)

**Verdict:** Strong budget pick. Best entry armor for new players.
Price target: at or within ~25m of BB floor for base-stat pieces.

---

### Assault
Reduces incoming **gun** damage. The war armor.

**Strengths:**
- Most effective in ranked wars where opponents use guns
- Large supply keeps prices accessible

**Weaknesses:**
- Low head coverage — head crits are a significant vulnerability
- Assault Helmet provides the weakest head protection in the set

**Full set bonus:** +10% additional reduction to gun damage (Impenetrable bonus)

**Verdict:** Essential for war-focused players. Buy both Riot and Assault
if budget allows — use each in the right context.
Price target: 10–20% below current item market value on auction.

---

### Delta
Reduces effectiveness of incoming debuffs (smoke grenades, eviscerate,
slow, weaken, wither, etc.). Delta Gas Mask also protects against tear
gas and pepper spray.

**Weaknesses:**
- Delta Gas Mask has extremely low head coverage — called a "paper mask"
  by the community; head crits are a serious problem

**Verdict:** Niche. Best for high-stat players who are frequently grouped
on in wars and face heavy debuff loadouts.

---

### Marauder
Increases maximum life. High armor points and great head/throat coverage.

**Verdict:** For top players who are not level-holding. Health as the
"fifth stat" only matters at the highest tier of play.

---

### Vanguard
Full set grants approximately **+150–190% dexterity**.

**Verdict:** Dex-focused builds only. Pairs with delta for debate on
which is better for dex whores — community is divided.

---

### Sentinel
Full set grants approximately **+150–190% defense**.

**Verdict:** Among Marauder, Assault, and Sentinel — Sentinel is the
clear winner for def-focused players. Head crit vulnerability still applies;
consider pairing with EOD Helmet.

---

### EOD
Provides a **30%+ chance to fully block any incoming attack** regardless
of stats. Highest armor point values and best coverage of all sets.

**Key mechanic:** Block chance is independent of the wearer's defensive stats —
even a glass cannon build benefits fully.

**Weakness:** Puncture bonus weapons are more effective against EOD.

**Verdict:** Strongest armor in the game. Price tag reflects it.
Recommended only for players with sufficient networth to absorb the cost
without disrupting liquidity.

---

## 3. Piece Priority

### Priority order within a set

For both Riot and Assault, the body piece provides the highest armor points
and coverage, followed by pants, then helmet, gloves, and boots.

**Riot Helmet exception:** The Riot Helmet has a special role beyond its
armor stats — it is the only piece that blocks pepper spray. This makes
it valuable in mixed sets regardless of how it ranks by pure armor points.

### Mixed set — recommended budget configuration

**Beginner (~200m total):**
```
Dune Vest + Riot Helmet
```
- Dune Vest: cheapest body piece available, near-BB price
- Riot Helmet: pepper spray immunity + melee head protection
- Best coverage-per-cost ratio at entry level

**Alternative beginner:**
```
Riot Body + Riot Helmet
```
- Slightly more expensive than Dune Vest variant
- Better melee protection overall

---

## 4. Mixed Set Logic — Riot Helmet + Assault Body

The most common mid-tier mixed configuration:

```
Riot Helmet + Assault Body + Assault Pants + Assault Gloves + Assault Boots
```

**Why this works:**
- Assault set bonus requires all 5 assault pieces — losing it by swapping
  the helmet is an acceptable trade
- Riot Helmet's pepper spray immunity and superior head coverage compensates
  for losing the assault helmet's gun damage reduction on the head slot
- Net result: better head protection + pepper spray immunity while retaining
  gun damage reduction on all major body locations

**Use case:** Players who want war effectiveness (gun damage reduction) but
dislike the head crit vulnerability of the Assault Helmet.

**Full Assault set bonus lost:** The +10% Impenetrable bonus requires all
5 Assault pieces. Swapping the helmet forfeits this bonus. Whether the
trade is worthwhile depends on how often the player faces pepper spray
and head crits vs. gun damage from full assault builds.

---

## 5. Full Set Bonuses

| Set | Full set bonus | Requirement |
|-----|---------------|-------------|
| Riot | +10% melee damage reduction (Impregnable) | All 5 Riot pieces |
| Assault | +10% gun damage reduction (Impenetrable) | All 5 Assault pieces |
| Sentinel | +25% defense | All 5 Sentinel pieces |
| Vanguard | ~+150–190% dexterity | All 5 Vanguard pieces |
| Marauder | Increased max life | All 5 Marauder pieces |
| EOD | Block chance enhancement | All 5 EOD pieces |

### Company bonuses that stack with armor
- **7★+ Private Security Firm:** +25% full-set damage mitigation bonus
- **10★ Clothing Shop:** +20% armor bonus

These stack on top of the armor set's own bonus. PSF membership is a
significant multiplier for players running full sets.

---

## 6. Yellow Armor Quality vs Bonus % Tradeoff

For yellow (standard) range armor, two competing variables affect value:
**quality** (armor points = raw damage mitigation) and **bonus %**
(the Impregnable / Impenetrable percentage).

### Community consensus
Quality is generally considered more important than bonus % for yellow
range armor. More armor points means more damage absorbed on every hit;
a higher bonus % only improves one damage type.

### King's scoring method (see also rw-pricing-logic.md)
```
score = quality_pct + (bonus_pct - base_bonus_pct) × 5
```
With +5 bonus if bonus_pct ≥ 26% (Riot/Assault) or ≥ 37% (Dune).

Base bonus values: Riot = 20%, Assault = 20%, Dune = 30%.

Higher score wins regardless of which variable drove it.

### Practical bonus range notes
- Riot/Assault yellow bonus range: **20–25%** (base to high)
- 26%+ is exceptional for yellow tier — commands a meaningful premium
- Quality range: pieces vary widely; higher quality % = more armor points

---

## 7. Orange and Red Armor

### Pricing behavior
Orange and red armor prices are largely controlled by a small number of
wealthy traders. Market prices are not reliable fair-value references —
treat them as upper bounds only.

### Price trend
Counterintuitively, orange/red armor prices have held steady or increased
over time despite RW gear being theoretically depreciating. The community
attributes this to active market manipulation and low supply of high-quality
pieces.

### Buying strategy for orange/red
- Check market price trend over the last 3 years for reference
- Buy from auction one piece at a time — patience wins
- Watch for end users liquidating full sets on forums; they typically
  offer better prices than traders
- Do not buy orange/red armor before reaching sufficient networth
  (~10b+) to absorb a slow sale without liquidity pressure

### Orange/red bonus % priority
Unlike yellow range where quality dominates, in orange and red range
the **bonus % becomes more important**. For EOD specifically, a high
bonus % is always the priority over quality.

---

## 8. Armor Tier Summary

### By combat role

| Role | Recommended armor |
|------|------------------|
| Missions / chains / anti-mug | Full Riot set |
| Wars (gun-heavy) | Full Assault set, or Riot Helmet + Assault body/legs/gloves/boots |
| Dex build | Full Vanguard or Full Delta |
| Def build | Full Sentinel (consider EOD Helmet swap) |
| Max survivability (rich) | Full EOD |
| Pure budget | Dune Vest + Riot Helmet |

### By stat level / progression

| Stage | Armor recommendation |
|-------|---------------------|
| Entry level (<1b stats) | Riot set or Dune Vest + Riot Helmet |
| Mid tier (1–10b stats) | Riot set + Assault set (context-swap) |
| High tier (10b+ stats) | Full Assault or begin Delta/Sentinel/Vanguard |
| Top tier (100b+ stats) | EOD; Sentinel or Vanguard depending on build |

---

## 9. Armor the RW Auction Advisor Targets

The advisor is scoped to **Riot** and **Assault** armor — the two most
commonly traded yellow-tier sets with active auction house liquidity.

**In scope:**
- Riot Helmet, Riot Body, Riot Pants, Riot Gloves, Riot Boots
- Assault Helmet, Assault Body, Assault Pants, Assault Gloves, Assault Boots
- Yellow rarity (primary target), orange/red (secondary, limited comps)

**Out of scope (for initial version):**
- Dune, Delta, Marauder, Vanguard, Sentinel, EOD
- Weapons of any type
