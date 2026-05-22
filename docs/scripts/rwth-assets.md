# RW Trading Hub — Salvaged Assets

> **Captured from grilling session 2026-05-21 (abandoned mid-flow).**
> **Design decisions from that session are NOT locked.** Only the artifacts in this file are trustworthy: things the user produced directly, visual iterations the user explicitly approved, and code/API research findings.
> Anything else from the session transcript should be re-grilled from scratch.

---

## 1. Forum HTML post template (user's verbatim paste)

The user's existing trading-post forum HTML, pasted in full. This is the **source of truth** for markup, classes, structure, and the visual style. Any forum-output generator must match this.

Brand identifiers in the template that need to become configurable settings (not hardcoded):

- `NC17` — brand name
- `// Trading Post //` — subtitle
- `Open shop // Competitively priced` — sub-banner
- `Rotating collection of RW weapons/gear...` — intro
- `Also rotating: drugs, plushies, flowers...` — rotating-note line
- `drugs, guns & bitches` — footer tagline
- `/bazaar.php?userId=1171127` — bazaar link (player ID 1171127 is the user's; must come from settings or API, not hardcoded)
- Forum URL: appears to be the user's trading-post thread URL

```html
<div>
  <div class="table-wrap">
    <table
      style="background: #080e18; border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;"
      width="100%"
    >
      <tbody>
        <tr>
          <td
            style="background: #080e18; padding: 22px 22px 18px; text-align: center; border-bottom: 1px solid rgba(0,255,136,0.08);"
          >
            <div
              style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.32em; text-transform: uppercase;"
            >
              NC17
            </div>
            <div
              style="color: #8aa898; font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; padding-top: 6px;"
            >
              //&nbsp; Trading Post &nbsp;//
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; padding: 11px 22px 9px; text-align: center;">
            <strong
              ><span style="font-size: 13px; letter-spacing: 0.16em; color: #6dc488; text-transform: uppercase;"
                >Open shop &nbsp;//&nbsp; Competitively priced</span
              ></strong
            >
          </td>
        </tr>
        <tr>
          <td
            style="background: #080e18; padding: 14px 22px 16px; border-top: 1px solid rgba(0,30,15,0.6); text-align: center; color: #c5dccc; font-size: 13px; line-height: 1.7;"
          >
            Rotating collection of RW weapons/gear and other useful items.<br /><br /><span style="color: #9ab5a5;"
              >If something below isn't currently listed, message me.</span
            >
          </td>
        </tr>
        <tr>
          <td
            style="background: #080e18; padding: 10px 22px 4px; border-top: 1px solid rgba(0,255,136,0.08); text-align: center;"
          >
            <span
              style="color: #6dc488; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: bold;"
              >&gt; Currently Available</span
            >
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; padding: 10px 22px;">
            <div>
              <div class="table-wrap">
                <table
                  style="background: #0c1422; border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse; table-layout: fixed;"
                  width="100%"
                >
                  <tbody>
                    <tr>
                      <td style="background: #060a12; padding: 0; line-height: 0; width: 100%;">
                        <a
                          href="https://i.gyazo.com/d6d87842068be6b4d8133b0984d78345.jpg"
                          target="_blank"
                          rel="noopener"
                          ><img
                            style="display: block; height: auto;"
                            src="https://i.gyazo.com/d6d87842068be6b4d8133b0984d78345.jpg"
                            alt=""
                            width="100%"
                        /></a>
                      </td>
                    </tr>
                    <tr>
                      <td style="background: #0c1422; padding: 12px 16px;">
                        <div>
                          <div class="table-wrap">
                            <table width="100%">
                              <tbody>
                                <tr>
                                  <td style="text-align: left; vertical-align: middle;">
                                    <span
                                      style="color: #5dc6f0; font-size: 16px; font-weight: bold; letter-spacing: 0.04em;"
                                      >Enfield SA-80: $118m</span
                                    >
                                  </td>
                                  <td style="text-align: right; vertical-align: middle;">
                                    <span
                                      style="color: #8aa898; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;"
                                      >Available</span
                                    >
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; padding: 10px 22px;">
            <div>
              <div class="table-wrap">
                <table
                  style="background: #0c1422; border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse; table-layout: fixed;"
                  width="100%"
                >
                  <tbody>
                    <tr>
                      <td style="background: #060a12; padding: 0; line-height: 0; width: 100%;">
                        <a
                          href="https://i.gyazo.com/e287f28557f24f29398d0f245b031275.jpg"
                          target="_blank"
                          rel="noopener"
                          ><img
                            style="display: block; height: auto;"
                            src="https://i.gyazo.com/e287f28557f24f29398d0f245b031275.jpg"
                            alt=""
                            width="100%"
                        /></a>
                      </td>
                    </tr>
                    <tr>
                      <td style="background: #0c1422; padding: 12px 16px;">
                        <div>
                          <div class="table-wrap">
                            <table width="100%">
                              <tbody>
                                <tr>
                                  <td style="text-align: left; vertical-align: middle;">
                                    <span
                                      style="color: #5dc6f0; font-size: 16px; font-weight: bold; letter-spacing: 0.04em;"
                                      >Riot Body (20% Impregnable): $78m</span
                                    >
                                  </td>
                                  <td style="text-align: right; vertical-align: middle;">
                                    <span
                                      style="color: #8aa898; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;"
                                      >Available</span
                                    >
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; padding: 4px 22px 14px; color: #8aa898; font-size: 12px; font-style: italic;">
            Also rotating: drugs, plushies, flowers. Check bazaar for live stock.
          </td>
        </tr>
        <tr>
          <td
            style="background: #080e18; padding: 10px 22px 4px; border-top: 1px solid rgba(0,255,136,0.08); text-align: center;"
          >
            <span
              style="color: #6dc488; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: bold;"
              >&gt; Recent Transactions</span
            >
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; padding: 6px 22px 16px;">
            <div>
              <div class="table-wrap">
                <table
                  style="background: rgb(12,20,34); border: 1px solid rgba(0,255,136,0.08); border-collapse: collapse; height: 100.8px;"
                  width="100%"
                >
                  <tbody>
                    <tr style="height: 14.4px;">
                      <td
                        style="padding: 9px 14px; color: rgb(138, 168, 152); font-size: 12px; font-family: Consolas, 'Courier New', monospace; border-bottom: 1px solid rgba(0,255,136,0.05); height: 14.4px;"
                      >
                        <span style="font-size: 10px; color: var(--te-text-color-gray4);"
                          ><em>You sold a&nbsp;Riot Body (Impregnable)</em
                          ><em
                            >&nbsp;on your bazaar to&nbsp;<a
                              style="color: var(--te-text-color-gray4);"
                              href="/profiles.php?XID=3108944"
                              target="_blank"
                              rel="noopener"
                              >Apocolypse_</a
                            >
                            at $84,150,000</em
                          ></span
                        >
                      </td>
                    </tr>
                    <!-- ... additional <tr> rows follow the same pattern; full markup pasted by user in session. -->
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background: #080e18; border-top: 1px solid rgba(0,30,15,0.6); padding: 0;">
            <div>
              <div class="table-wrap">
                <table width="100%">
                  <tbody>
                    <tr>
                      <td
                        style="background: #080e18; padding: 11px 22px 13px; text-align: left; vertical-align: middle;"
                      >
                        <span
                          style="font-size: 12px; letter-spacing: 0.14em; color: #7ed098; text-transform: uppercase; font-style: italic;"
                          >drugs, guns &amp; bitches</span
                        >
                      </td>
                      <td
                        style="background: #080e18; padding: 11px 22px 13px; text-align: right; vertical-align: middle;"
                      >
                        <strong
                          ><a
                            style="color: #5dc6f0; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; border-bottom: 1px solid rgba(93,198,240,0.4); padding-bottom: 2px;"
                            href="/bazaar.php?userId=1171127"
                            target="_blank"
                            rel="noopener"
                            >Visit Bazaar ↗</a
                          ></strong
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

## 2. Polished item card (visually approved during session)

The user iterated on the "Currently Available" card and approved this final form. Replaces the `<tr><td>` block in section 1 that wraps each item card. Key features the user signed off on:

- Image on top, full width (unchanged)
- 2px green left-accent strip on the info cell
- Two cells in one row: name + bonus chip stacked on the left, big monospace green price on the right
- No "Available" pill (redundant — the section header already says these are available)
- No horizontal divider between rows of info (felt clunky)

```html
<td style="background: #0c1422; padding: 16px 18px 16px 14px; border-left: 2px solid rgba(109,196,136,0.45);">
  <div>
    <div class="table-wrap">
      <table width="100%" style="border-collapse: collapse;">
        <tbody>
          <tr>
            <td style="text-align: left; vertical-align: middle; width: 60%; padding-left: 6px;">
              <div style="color: #5dc6f0; font-size: 17px; font-weight: bold; letter-spacing: 0.04em; line-height: 1.15;">
                Enfield SA-80
              </div>
              <div style="margin-top: 7px;">
                <span style="display: inline-block; background: rgba(109,196,136,0.10); border: 1px solid rgba(109,196,136,0.30); color: #7ed098; font-size: 10px; font-weight: bold; letter-spacing: 0.16em; text-transform: uppercase; padding: 3px 9px; border-radius: 2px;">
                  Fury &nbsp;24%
                </span>
              </div>
            </td>
            <td style="text-align: right; vertical-align: middle; white-space: nowrap; padding-right: 4px;">
              <span style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.02em; font-family: Consolas, 'Courier New', monospace;">
                $118,000,000
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</td>
```

Rules for variants:
- **No bonus**: omit the chip `<div>` entirely; the name sits alone on the left.
- **Multiple bonuses**: stack chips vertically below the name with a 4px gap.

---

## 3. Polished section headers (visually approved)

Replaces the plain `> Currently Available` and `> Recent Transactions` text. Centered pill flanked by hairlines, with a green dot inside the pill. Same structure for both headers; only the label text varies.

```html
<td style="background: #080e18; padding: 18px 22px 10px;">
  <div class="table-wrap">
    <table width="100%" style="border-collapse: collapse;"><tbody><tr>
      <td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td>
      <td style="text-align: center; vertical-align: middle; padding: 0 14px; white-space: nowrap;">
        <span style="display: inline-block; background: rgba(109,196,136,0.08); border: 1px solid rgba(109,196,136,0.35); color: #7ed098; font-size: 11px; font-weight: bold; letter-spacing: 0.28em; text-transform: uppercase; padding: 5px 14px; border-radius: 2px;">
          ● Currently Available
        </span>
      </td>
      <td style="width: 35%; border-top: 1px solid rgba(109,196,136,0.18); height: 1px; line-height: 0;">&nbsp;</td>
    </tr></tbody></table>
  </div>
</td>
```

For "Recent Transactions" — same markup, swap `Currently Available` for `Recent Transactions`.

---

## 4. Polished brand-header tweak (visually approved)

Adds a thin green hairline above the `NC17` block so the top of the post is bookended by a rule. Single attribute change on the existing brand `<td>`:

```html
<td style="background: #080e18; padding: 22px 22px 18px; text-align: center; border-top: 1px solid rgba(0,255,136,0.15); border-bottom: 1px solid rgba(0,255,136,0.08);">
```

---

## 5. Trade Chat blurb — user's original format (verbatim)

```
🔹🔷 <u>Floor Prices</u> 🔷🔹
[S] <b>Riot Body (6.5% q)</b> - $78m
[S] <b>Enfield (Deadeye 29%)</b> - $118m
[<a href="https://www.torn.com/bazaar.php?userId=1171127#/">Bazaar</a>]
[<a href="https://www.torn.com/forums.php#/p=threads&f=10&t=15951654&b=0&a=0">Forum</a>]
```

Notes the user supplied:
- The user shortens item display names (e.g. `Enfield` instead of `Enfield SA-80`) to keep chat lines narrow.
- The user picks the parens content per item — sometimes the bonus name + value (selling point), sometimes the quality % (transparency when quality is low).
- The user prefers **narrow lines over wide lines**; separate lines over packing things together.

---

## 6. Trade Chat blurb — polished iteration (visually approved)

```
🔹🔷 <u>NC17</u> 🔷🔹
🟢 <u>Floor Prices</u> 🟢
[S] <b>Riot Body</b> (6.5% q) — <b>$78m</b>
[S] <b>Enfield</b> (Deadeye 29%) — <b>$118m</b>
<a href="https://www.torn.com/bazaar.php?userId=1171127#/">Bazaar</a>
<a href="https://www.torn.com/forums.php#/p=threads&f=10&t=15951654&b=0&a=0">Forum</a>
```

Changes vs. original:
- Header split into two lines: brand `NC17` on top with original emoji bookends; subtitle `Floor Prices` on second line with single green dots either side.
- Item lines: bold moved off the attribute, onto the price; em-dash separator before price.
- Footer: links stacked, one per line, no brackets around them.

---

## 7. Research findings (factual, not interpretation)

### Torn API — bonuses & quality availability

| Endpoint | Returns bonuses? | Returns quality? | Returns uid? |
|---|---|---|---|
| `v1 /user/inventory` | **Discontinued** ("no longer available") | — | — |
| `v2 /user/inventory` | No | No | Yes |
| `v2 /user/equipment` | Yes (via `TornItemDetails` → `ItemMarketListingItemDetails`) | Yes (`stats.quality`) | Yes |
| `v2 /user/itemmarket` | Yes (same schema as equipment) | Yes | Yes |
| `v1 /user/log` | No | No | No (just itemId, price, source, timestamp) |

There is **no endpoint** that, given a uid of an item you own (sitting in your inventory, not equipped, not listed), returns its bonuses or quality. The data exists in DOM when the user views the item on a Torn page.

### Auction-win log entry format (user-supplied example)

```
14:03:05 - 21/05/26 You won Shadowjacktar's auction of a Diamond Bladed Knife (Fury) for a final price of $200,000,001
```

The bonus **name** is in the parenthetical (`(Fury)`). The bonus **value** (e.g. `24%`) is NOT in the log. Quality is NOT in the log. For multi-bonus items, only the primary bonus name appears.

### Cross-origin fetch pattern (works on PDA — verified from Auction Price Checker source)

`TORN-Auction-Price-Checker.js` lines 13–16:

```js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      btrmmuuoofbonmuwrkzg.supabase.co
// @connect      weav3r.dev
```

Then `GM_xmlhttpRequest(...)` used at every cross-origin call site (lines 876, 1080). Works on both PC Tampermonkey and Torn PDA — no degradation needed.

(The previous session-memory claim that GM_xmlhttpRequest "does NOT bypass page CSP" on PDA was wrong and has been removed from `.claude/memory.md`.)
