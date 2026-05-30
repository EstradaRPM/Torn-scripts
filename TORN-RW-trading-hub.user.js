// ==UserScript==
// @name         Torn RW Trading Hub
// @namespace    estradarpm-rw-trading-hub
// @version      0.3.37
// @description  Trader's workbench for ranked-war armor & weapon flipping — ledger + advertising hub
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      weav3r.dev
// @connect      btrmmuuoofbonmuwrkzg.supabase.co
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/TORN-RW-trading-hub.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/TORN-RW-trading-hub.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.3.37';

  // Skip the DOM bootstrap when required by the Node test shim (ADR-0002).
  const TEST = typeof globalThis !== 'undefined' && globalThis.__RWTH_TEST__ === true;

  // ─── Brand (static, in-file; not exposed in Settings) ────────────────────────
  const BRAND = {
    mark: 'NC17',
    forumThreadTitle: '[S] NC17 Rated // RW Weapons & Armor',
    // Footer line, bottom-left of the forum/bazaar HTML — an NC-17 movie-rating
    // gag (the brand is a film rating). Finalised with the user for slice 7.
    footerTagline: 'Contains explicit deals, weapons, and depictions of violence',
  };

  // Display-name abbreviation map for the trade-chat blurb — keeps chat lines
  // narrow. Static display dictionary (not faction data); seeded from common
  // Torn trade-chat usage. Build-time TODO: extend as new RW items appear.
  const ITEM_ABBREV = {
    'Diamond Bladed Knife': 'DBK',
    'Enfield SA-80': 'Enfield',
    'Cobra Derringer': 'Cobra',
    'Sub-Machine Gun': 'SMG',
    'Heavy Machine Gun': 'HMG',
    'Light Anti-Tank Weapon': 'LAW',
    'Rocket-Propelled Grenade Launcher': 'RPG',
  };

  // Torn v2 API. Log type 4320 ("Auction house item win") filters
  // /v2/user/log to auction wins only.
  const API_BASE = 'https://api.torn.com';
  const LOG_TYPE_AUCTION_WIN = 4320;

  // ─── State ───────────────────────────────────────────────────────────────────
  const MEM = {
    ui: {
      open: false,
      maximized: false,
      activeTab: 'ledger', // 'ledger' | 'advertise' | 'settings'
      // Per-section fold state, persisted under rwth_collapsed. Outputs and the
      // sale-log box start collapsed; the advertised-items list starts open.
      collapsed: { advItems: false, advOutputs: true, saleLog: true },
    },
    ledger: {
      items: [],
      statusFilter: 'all',
      editingId: null,        // null | 'new' | itemId — drives the add/edit form
      expandedId: null,       // null | itemId — the tap-expanded row
      scanResults: [],        // ScanHit[] from the last scan, awaiting confirm
      scanMessage: '',        // transient scan feedback (e.g. "No new auction wins found.")
      scanning: false,        // a scan request is in flight
      lastScan: 0,            // epoch ms of the last completed scan
      sellPreview: null,      // null | { rows, summary, summaryText } — parsed sells awaiting commit
      sellMessage: '',        // transient feedback for the Log-a-sale box
      priceCheckId: null,     // null | itemId — the row whose Price-check panel is open
      priceCheckResults: {},  // { [itemId]: { loading?, error?, suggest?, verdict?, listPrice? } }
    },
    advertise: {
      selectedIds: null,      // null = default (all `listed` rows checked); else id[]
      imgEditId: null,        // null | itemId — the row whose [IMG] popover is open
      transactions: [],
      outputs: { title: '', forumHtml: '', chat: '', bazaarHtml: '', signatureHtml: '' },
    },
    settings: {
      playerId: '',
      forumThreadUrl: '',
      weav3rPricelistUrl: '',
      bannerImageUrl: '',
      forumHeaderImageUrl: '',
      viewCounterUrl: '',
      apiKey: '###PDA-APIKEY###',
    },
    // Intel feature state — persisted to rwth_intel_settings.
    intel: {
      enabled: { auction: true, ledger: true },
      defaults: { ignoreQuality: false },
      qualityClampDefault: false,
      mugBuffer: 10,
      marginTarget: 15,
      markup: 1.20,
      // v0.3.0 slice 9 — user-curated seed data. Empty by design: PRD #265
      // ships the mechanism only, the user supplies the lists in Settings.
      excludedBonuses: [],                                  // ["cupid", "achilles", …]
      // v0.3.0 slice 19a (#285) — user overrides for BONUS_CHANGE_DATES.
      // Merged over the in-code seed; key = lower-cased bonus name, value =
      // ISO YYYY-MM-DD. Comps older than the date are suppressed when the
      // listing carries that bonus.
      bonusChangeDates: {},
      // v0.3.0 slice 19d (#288) — user overrides for SIMILAR_BASES_SEED.
      // Array of clusters; each cluster is an ordered array of lower-cased
      // weapon-base tokens (e.g. ['macana','dbk','metal_nunchakus','kodachi',
      // 'samurai','yasukuni','katana']). Adjacency = neighbours in the array.
      // User overrides concat onto the seed at lookup time.
      similarBases: [],
    },
    bbRate: null,           // { rate, cachePrices, fetchedAt } — hydrated from rwth_bb_rate
    fetchError: null,
  };

  // ─── Store ─────────────────────────────────────────────────────────────────
  // localStorage I/O, rwth_ prefix, try/catch wrapped — never throws.
  const Store = {
    get(k)    { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  function hydrate() {
    const ledger = Store.get('rwth_ledger');
    if (Array.isArray(ledger)) MEM.ledger.items = ledger;

    // Pending scan checklist — survives panel close/reopen and page reload.
    const scan = Store.get('rwth_scan');
    if (Array.isArray(scan)) MEM.ledger.scanResults = scan;

    const transactions = Store.get('rwth_transactions');
    if (Array.isArray(transactions)) MEM.advertise.transactions = transactions;

    const settings = Store.get('rwth_settings');
    if (settings && typeof settings === 'object') {
      MEM.settings = { ...MEM.settings, ...settings };
    }

    const collapsed = Store.get('rwth_collapsed');
    if (collapsed && typeof collapsed === 'object') {
      MEM.ui.collapsed = { ...MEM.ui.collapsed, ...collapsed };
    }

    const bbRate = Store.get('rwth_bb_rate');
    if (bbRate && typeof bbRate === 'object' && typeof bbRate.rate === 'number') {
      MEM.bbRate = bbRate;
    }

    const intel = Store.get('rwth_intel_settings');
    if (intel && typeof intel === 'object') {
      MEM.intel = {
        ...MEM.intel,
        ...intel,
        enabled:  { ...MEM.intel.enabled,  ...(intel.enabled  || {}) },
        defaults: { ...MEM.intel.defaults, ...(intel.defaults || {}) },
        excludedBonuses: Array.isArray(intel.excludedBonuses) ? intel.excludedBonuses.slice() : [],
        bonusChangeDates: (intel.bonusChangeDates && typeof intel.bonusChangeDates === 'object')
          ? { ...intel.bonusChangeDates } : {},
        similarBases: Array.isArray(intel.similarBases)
          ? intel.similarBases.map(c => Array.isArray(c) ? c.slice() : []).filter(c => c.length)
          : [],
      };
    }
  }

  // ─── setState — sole mutation path ───────────────────────────────────────────
  function setState(patch) {
    Object.assign(MEM, patch);
    render();
  }

  // ─── Pure HTML builders (exposed via __RwthPure — ADR-0002) ──────────────────
  function placeholder(label) {
    return `<div class="rwth-placeholder">${label} — coming in a later slice.</div>`;
  }

  // A collapsible-section header — a full-width button carrying the section
  // title and a caret. `key` indexes MEM.ui.collapsed; the click is handled by
  // the delegated `toggle-collapse` action.
  function collapseHead(label, key, collapsed) {
    return `<button class="rwth-collapse-head" type="button" `
      + `data-action="toggle-collapse" data-collapse="${key}">`
      + `<span class="rwth-form-title">${label}</span>`
      + `<span class="rwth-collapse-caret">${collapsed ? '▸' : '▾'}</span></button>`;
  }

  // ROI = net proceeds minus buy price. The sell log states fees exactly, so
  // saleNet is authoritative — no venue fee table. Null until the row is sold.
  const ROI = {
    compute(item) {
      if (!item || item.saleNet == null) return null;
      return item.saleNet - (item.buyPrice || 0);
    },
  };

  // ─── SellParser — parse pasted Torn sell-log lines (pure) ────────────────────
  // The Torn item log states sale fees and net exactly, so the parsed numbers
  // are authoritative — no venue fee table. parse() handles a multi-line block;
  // timestamp lines interleaved between sales are associated best-effort with
  // the next sale line (null if none precedes it).

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  function parseMoney(s) {
    if (s == null) return null;
    const n = Number(String(s).replace(/[,$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // A line that carries only a timestamp → epoch ms, else null. Sale lines are
  // excluded first so a sale's own embedded numbers can't be misread as a date.
  function parseTimestampLine(line) {
    const text = String(line || '');
    if (/\bsold a\b/i.test(text)) return null;
    if (/^\d{9,13}$/.test(text)) {
      const n = Number(text);
      return n < 1e12 ? n * 1000 : n;
    }
    const t = Date.parse(text);
    return Number.isFinite(t) ? t : null;
  }

  // Pure: one Torn sell-log line → ParsedSell, or null if it is not a sell line.
  // Grammar: optional "anonymously"; "sold a" / "sold a pair of"; venue
  // "on your bazaar" | "on the item market"; "at $X each for a total of $Y"
  // ($Y = net proceeds); optional "after $Z in fees" (absent = 0, e.g. bazaar).
  function parseSellLine(line) {
    const raw = String(line || '');
    if (!/\bsold a\b/i.test(raw)) return null;
    const anonymous = /\banonymously\b/i.test(raw);
    // Strip "anonymously" so it can't leak into the item-name capture.
    const text = raw.replace(/\s*\banonymously\b/i, '');

    let venue = null;
    if (/on your bazaar/i.test(text)) venue = 'bazaar';
    else if (/on the item market/i.test(text)) venue = 'market';

    let itemName = '', bonusName = null;
    const m = text.match(/sold a (?:pair of )?(.+?)\s+on (?:your bazaar|the item market)/i);
    if (m) {
      const nm = m[1].trim();
      const bm = nm.match(/^(.*\S)\s*\(([^)]+)\)$/);
      if (bm) { itemName = bm[1].trim(); bonusName = bm[2].trim(); }
      else itemName = nm;
    }

    const buyM = text.match(/\bto\s+(\S+?)\s+(?:at\s+\$|for a total)/i);
    const buyer = buyM ? buyM[1] : null;

    const eachM  = text.match(/\$([\d,]+)\s+each/i);
    const totalM = text.match(/for a total of \$([\d,]+)/i);
    const feesM  = text.match(/after \$([\d,]+) in fees/i);

    const saleGross = eachM  ? parseMoney(eachM[1])  : null;
    const saleNet   = totalM ? parseMoney(totalM[1]) : saleGross;
    const saleFees  = feesM  ? parseMoney(feesM[1])  : 0;

    return { raw, itemName, bonusName, venue, buyer, anonymous,
             saleGross, saleFees, saleNet, timestamp: null };
  }

  const SellParser = {
    parse(text) {
      const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const out = [];
      let pendingTs = null;
      for (const line of lines) {
        const sell = parseSellLine(line);
        if (sell) {
          sell.timestamp = pendingTs;
          pendingTs = null;
          out.push(sell);
        } else {
          const ts = parseTimestampLine(line);
          if (ts != null) pendingTs = ts;
        }
      }
      return out;
    },
  };

  // Pure: tie a parsed sell to one open held/listed ledger row. Matches by item
  // name; when several rows share the name, the sell's bonus name disambiguates.
  // Returns null when nothing matches — the caller treats that as a historical
  // sale destined for Recent Transactions.
  function matchSell(sell, openPositions) {
    if (!sell || !Array.isArray(openPositions)) return null;
    const want = norm(sell.itemName);
    if (!want) return null;
    const candidates = openPositions.filter(p =>
      p && (p.status === 'held' || p.status === 'listed') &&
      norm(p.itemName) === want);
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    if (sell.bonusName) {
      const wb = norm(sell.bonusName);
      const tie = candidates.find(p =>
        (p.bonuses || []).some(b => b && norm(b.name) === wb));
      if (tie) return tie;
    }
    return candidates[0];
  }

  // Pure: counts for the pre-commit confirmation summary. rows = [{ matchedId }].
  function summarizeSells(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const parsed = list.length;
    const matched = list.filter(r => r && r.matchedId).length;
    return { parsed, matched, recent: parsed - matched };
  }

  // First finite, present number among the candidates; 0 if none.
  function firstNum(...vals) {
    for (const v of vals) {
      if (v == null || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  // Pure: pull the fields a ScanHit needs out of one auction-win log entry.
  // The API identifies the item by numeric type id only (data.item[0].id) and
  // gives the winning bid as data.final_price — no item name, no bonus. The
  // name is resolved from the item dictionary; the bonus is user-entered.
  function parseAuctionWin(entry, itemNames) {
    const data = (entry && entry.data) || {};
    const rec = Array.isArray(data.item) ? (data.item[0] || {}) : {};
    const itemId = rec.id != null ? Number(rec.id) : null;
    const uid = rec.uid != null ? Number(rec.uid) : null;
    const names = itemNames || {};
    let itemName = '';
    if (itemId != null) itemName = names[itemId] || `Item #${itemId}`;
    return {
      itemId,
      uid,
      itemName,
      buyPrice: firstNum(data.final_price, data.cost, data.price),
    };
  }

  // Pure: the API log map → ScanHit[] of wins whose entry id is not yet seen.
  // Torn v1 user/log returns d.log as an OBJECT keyed by hash id — each entry
  // carries NO id field of its own; the id is the key. Tolerate a plain array
  // too (id from entry.id, else index) so callers can't break this.
  function toScanHits(log, seenKeys, itemNames) {
    const seen = new Set(seenKeys || []);
    const pairs = Array.isArray(log)
      ? log.map((e, i) => [e && e.id != null ? String(e.id) : String(i), e])
      : Object.entries(log || {});
    const out = [];
    for (const [key, entry] of pairs) {
      if (!entry) continue;
      if (seen.has(key)) continue;
      const p = parseAuctionWin(entry, itemNames);
      out.push({
        key,
        itemId: p.itemId,
        uid: p.uid,
        itemName: p.itemName,
        type: 'weapon',
        bonuses: [],
        quality: null,
        rarity: null,
        checked: true,
        buyPrice: p.buyPrice,
        buyTimestamp: (Number(entry.timestamp) || 0) * 1000,
      });
    }
    out.sort((a, b) => b.buyTimestamp - a.buyTimestamp);
    return out;
  }

  const STATUS_FILTERS = ['all', 'held', 'listed', 'sold'];

  function fmtMoney(n) {
    const v = Number(n || 0);
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
  }
  function fmtDate(ts) {
    if (!ts || !Number.isFinite(ts)) return '—';
    return new Date(ts).toISOString().slice(0, 10);
  }
  function fmtBonuses(item) {
    const b = (item && item.bonuses) || [];
    return b.map(x => (x.value != null ? `${x.name} ${x.value}%` : x.name)).join(', ');
  }

  function buildLedgerRow(item, expanded, ctx) {
    const bonus = fmtBonuses(item);
    let statusCell;
    if (item.status === 'sold') {
      const roi = ROI.compute(item);
      const cls = roi >= 0 ? 'rwth-roi-pos' : 'rwth-roi-neg';
      statusCell = `<span class="rwth-roi ${cls}">${roi >= 0 ? '+' : ''}${fmtMoney(roi)}</span>`;
    } else {
      statusCell = `<span class="rwth-status rwth-status-${item.status}">${item.status}</span>`;
    }
    const head = `<div class="rwth-row-head" data-row-toggle="${item.id}">
        <span class="rwth-row-name">${escapeAttr(item.itemName)}${
          bonus ? ` <span class="rwth-row-bonus">${escapeAttr(bonus)}</span>` : ''} ${
          rarityChip(item.rarity)}</span>
        <span class="rwth-row-price">${fmtMoney(item.buyPrice)}</span>
        ${statusCell}
      </div>`;
    if (!expanded) return `<div class="rwth-row">${head}</div>`;
    const c = ctx || {};
    const ledgerIntelOn = c.intelLedger !== false;
    const panelOpen = ledgerIntelOn && c.priceCheckId === item.id;
    const detail = `<div class="rwth-row-detail">
        <div class="rwth-row-meta">
          <span>Quality: ${item.quality != null ? item.quality + '%' : '—'}</span>
          <span>Bought: ${fmtDate(item.buyTimestamp)}</span>
          <span>Source: ${escapeAttr(item.buySource)}</span>
        </div>
        <div class="rwth-row-actions">
          ${item.status === 'held'
            ? `<button class="rwth-btn-sm" type="button" data-action="mark-listed" data-id="${item.id}">mark listed</button>`
            : ''}
          ${item.status === 'sold'
            ? `<button class="rwth-btn-sm" type="button" data-action="promote-tx" data-id="${item.id}">+ Recent Transactions</button>`
            : ''}
          ${ledgerIntelOn
            ? `<button class="rwth-btn-sm${panelOpen ? ' rwth-btn-on' : ''}" type="button" data-action="price-check" data-id="${item.id}">Price check</button>`
            : ''}
          <button class="rwth-btn-sm" type="button" data-action="edit-item" data-id="${item.id}">edit</button>
          <button class="rwth-btn-sm rwth-btn-danger" type="button" data-action="delete-item" data-id="${item.id}">delete</button>
        </div>
        ${panelOpen ? buildPriceCheckPanel(item, (c.priceCheckResults || {})[item.id]) : ''}
      </div>`;
    return `<div class="rwth-row rwth-row-expanded">${head}${detail}</div>`;
  }

  // Per-row Price-check panel — synchronous from MEM. The runPriceCheck flow
  // writes loading/error/ctx into MEM.ledger.priceCheckResults[id] and
  // triggers a render; loading/error states render as HTML here, while the
  // ready (`ctx`) state emits an empty anchor div that render() mounts the
  // shared BadgeRenderer v2 two-tier card into post-innerHTML.
  function buildPriceCheckPanel(item, state) {
    const s = state || {};
    if (s.loading) {
      return `<div class="rwth-price-panel rwth-tier-loading">⟳ checking prices…</div>`;
    }
    const askingLine = (s.askingCount && s.askingMedian != null)
      ? `<div class="rwth-price-math">${s.askingCount} for sale (typical ${fmtMoney(s.askingMedian)})</div>`
      : '';
    if (s.skipped === 'trash') {
      const which = s.bonusName ? ` (${escapeAttr(s.bonusName)})` : '';
      return `<div class="rwth-price-panel rwth-tier-none">skipped — low-value bonus${which}</div>`;
    }
    if (s.error) {
      return `<div class="rwth-price-panel rwth-tier-none">${escapeAttr(s.error)}${askingLine}</div>`;
    }
    if (!s.ctx) {
      return `<div class="rwth-price-panel rwth-tier-none">no comparable sales${askingLine}</div>`;
    }
    return `<div class="rwth-price-panel rwth-pc-anchor" data-pc-id="${escapeAttr(item.id)}"></div>`;
  }

  function buildLedgerForm(mem) {
    const L = mem.ledger;
    const editing = L.editingId && L.editingId !== 'new'
      ? L.items.find(i => i.id === L.editingId) : null;
    const v = editing || {};
    const bonuses = v.bonuses || [];
    const b1 = bonuses[0] || {}, b2 = bonuses[1] || {};
    const dateVal = v.buyTimestamp ? fmtDate(v.buyTimestamp) : '';
    return `<div class="rwth-form">
      <div class="rwth-form-title">${editing ? 'Edit item' : 'Add item'}</div>
      <label class="rwth-field">
        <span class="rwth-field-label">Item name</span>
        <input class="rwth-field-input" data-form="itemName" value="${escapeAttr(v.itemName)}"
               autocomplete="off" spellcheck="false">
      </label>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Category</span>
          <select class="rwth-field-input" data-form="category">
            ${categoryOptions(editing ? itemCategory(v) : 'Primary')}
          </select>
        </label>
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Rarity</span>
          <select class="rwth-field-input" data-form="rarity">${rarityOptions(v.rarity)}</select>
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Bonus 1</span>
          <input class="rwth-field-input" data-form="bonus1Name" value="${escapeAttr(b1.name)}"
                 placeholder="e.g. Fury" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">%</span>
          <input class="rwth-field-input" type="number" data-form="bonus1Value" value="${escapeAttr(b1.value)}">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Bonus 2</span>
          <input class="rwth-field-input" data-form="bonus2Name" value="${escapeAttr(b2.name)}"
                 placeholder="optional" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">%</span>
          <input class="rwth-field-input" type="number" data-form="bonus2Value" value="${escapeAttr(b2.value)}">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">Quality %</span>
          <input class="rwth-field-input" type="number" data-form="quality" value="${escapeAttr(v.quality)}">
        </label>
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Buy price</span>
          <input class="rwth-field-input" type="number" data-form="buyPrice" value="${escapeAttr(v.buyPrice)}">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Buy date</span>
          <input class="rwth-field-input" type="date" data-form="buyDate" value="${escapeAttr(dateVal)}">
        </label>
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Buy source</span>
          <select class="rwth-field-input" data-form="buySource">
            <option value="market"${v.buySource === 'bazaar' ? '' : ' selected'}>Market</option>
            <option value="bazaar"${v.buySource === 'bazaar' ? ' selected' : ''}>Bazaar</option>
          </select>
        </label>
      </div>
      <div class="rwth-form-error" id="rwth-form-error"></div>
      <div class="rwth-form-actions">
        <button class="rwth-btn" type="button" data-action="save-item">Save</button>
        <button class="rwth-btn rwth-btn-ghost" type="button" data-action="cancel-item">Cancel</button>
      </div>
    </div>`;
  }

  // Rarity is API-sourced, not user-typed — fixed option list for the forms.
  const RARITIES = ['', 'white', 'yellow', 'orange', 'red'];
  function rarityOptions(selected) {
    const sel = selected || '';
    return RARITIES.map(r =>
      `<option value="${r}"${r === sel ? ' selected' : ''}>${
        r ? r[0].toUpperCase() + r.slice(1) : '—'}</option>`).join('');
  }
  function rarityChip(rarity) {
    if (!rarity) return '';
    return `<span class="rwth-rarity rwth-rarity-${escapeAttr(rarity)}">${escapeAttr(rarity)}</span>`;
  }

  // One checklist entry for a detected auction win. Every field — name, type,
  // bonuses, quality — is pre-filled from the itemdetails API lookup; the user
  // only reviews. All edits are persisted into MEM.ledger.scanResults via the
  // delegated input listener, so a close/reopen or reload never loses them.
  function buildScanRow(hit) {
    const k = escapeAttr(hit.key);
    const bonuses = hit.bonuses || [];
    const b1 = bonuses[0] || {}, b2 = bonuses[1] || {};
    const checked = hit.checked === false ? '' : ' checked';
    return `<div class="rwth-scan-row" data-scan-row="${k}">
      <label class="rwth-scan-check">
        <input type="checkbox" data-scan-check${checked}>
        <span class="rwth-scan-title">${escapeAttr(hit.itemName) || 'Unknown item'}</span>
        ${rarityChip(hit.rarity)}
        <span class="rwth-scan-price">${fmtMoney(hit.buyPrice)}</span>
      </label>
      <div class="rwth-scan-meta">Won ${fmtDate(hit.buyTimestamp)}</div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Item name</span>
          <input class="rwth-field-input" data-scan-field="itemName"
                 value="${escapeAttr(hit.itemName)}" autocomplete="off" spellcheck="false">
        </label>
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">Category</span>
          <select class="rwth-field-input" data-scan-field="category">
            ${categoryOptions(itemCategory(hit))}
          </select>
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Bonus 1</span>
          <input class="rwth-field-input" data-scan-field="bonus1Name"
                 value="${escapeAttr(b1.name)}" placeholder="e.g. Fury" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">%</span>
          <input class="rwth-field-input" type="number" data-scan-field="bonus1Value"
                 value="${escapeAttr(b1.value)}">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Bonus 2</span>
          <input class="rwth-field-input" data-scan-field="bonus2Name"
                 value="${escapeAttr(b2.name)}" placeholder="optional" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">%</span>
          <input class="rwth-field-input" type="number" data-scan-field="bonus2Value"
                 value="${escapeAttr(b2.value)}">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-sm">
          <span class="rwth-field-label">Quality %</span>
          <input class="rwth-field-input" type="number" data-scan-field="quality"
                 value="${escapeAttr(hit.quality)}">
        </label>
      </div>
    </div>`;
  }

  function buildScanChecklist(mem) {
    const L = (mem && mem.ledger) || {};
    const results = L.scanResults || [];
    if (!results.length) return '';
    const n = results.length;
    return `<div class="rwth-scan">
      <div class="rwth-form-title">${n} auction win${n === 1 ? '' : 's'} detected</div>
      ${results.map(buildScanRow).join('')}
      <div class="rwth-scan-note">Checked wins are added as held items. Unchecked
        wins are dismissed and won't reappear — use <strong>+ add</strong> later if needed.</div>
      <div class="rwth-form-actions">
        <button class="rwth-btn" type="button" data-action="confirm-scan">Add to ledger</button>
        <button class="rwth-btn rwth-btn-ghost" type="button" data-action="cancel-scan">Cancel</button>
      </div>
    </div>`;
  }

  // The "Log a sale" box: a paste textarea, or — once Parse has run — a
  // confirmation summary listing every parsed sell and whether it matched an
  // open ledger row or is bound for Recent Transactions. Nothing commits until
  // the user confirms.
  function buildSellBox(mem) {
    const L = (mem && mem.ledger) || {};
    const preview = L.sellPreview;
    if (preview) {
      const rows = (preview.rows || []).map(r => {
        const s = r.sell || {};
        const bonus = s.bonusName ? ` <span class="rwth-row-bonus">${escapeAttr(s.bonusName)}</span>` : '';
        const dest = r.matchedId
          ? `<span class="rwth-sell-matched">matched</span>`
          : `<span class="rwth-sell-recent">→ Recent</span>`;
        return `<div class="rwth-sell-line">
          <span class="rwth-row-name">${escapeAttr(s.itemName) || 'Unparsed line'}${bonus}</span>
          <span class="rwth-row-price">${fmtMoney(s.saleNet)}</span>
          ${dest}
        </div>`;
      }).join('');
      return `<div class="rwth-sellbox">
        <div class="rwth-form-title">Confirm sales</div>
        <div class="rwth-sell-summary">${escapeAttr(preview.summaryText)}</div>
        ${rows}
        <div class="rwth-form-actions">
          <button class="rwth-btn" type="button" data-action="commit-sells">Commit</button>
          <button class="rwth-btn rwth-btn-ghost" type="button" data-action="cancel-sells">Cancel</button>
        </div>
      </div>`;
    }
    const fold = (mem && mem.ui && mem.ui.collapsed) || {};
    return `<div class="rwth-sellbox">
      ${collapseHead('Log a sale', 'saleLog', fold.saleLog)}
      ${fold.saleLog ? '' : `
      <textarea class="rwth-field-input rwth-sell-input" data-sell-input rows="4"
                placeholder="Paste one or more Torn sell-log lines…"
                autocomplete="off" spellcheck="false"></textarea>
      ${L.sellMessage ? `<div class="rwth-form-error">${escapeAttr(L.sellMessage)}</div>` : ''}
      <div class="rwth-form-actions">
        <button class="rwth-btn" type="button" data-action="parse-sells">Parse</button>
      </div>`}
    </div>`;
  }

  function buildLedgerTab(mem) {
    const L = (mem && mem.ledger) || { items: [], statusFilter: 'all' };
    const items = L.items || [];
    const filter = L.statusFilter || 'all';
    const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

    const filterBtns = STATUS_FILTERS.map(f =>
      `<button class="rwth-filter${f === filter ? ' rwth-filter-active' : ''}" type="button"
               data-filter="${f}">${f}</button>`).join('');

    const intel = (mem && mem.intel) || MEM.intel;
    const rowCtx = {
      intelLedger: !!(intel.enabled && intel.enabled.ledger),
      priceCheckId: L.priceCheckId,
      priceCheckResults: L.priceCheckResults || {},
    };
    const list = filtered.length
      ? filtered.map(i => buildLedgerRow(i, i.id === L.expandedId, rowCtx)).join('')
      : `<div class="rwth-placeholder">No ${filter === 'all' ? '' : filter + ' '}items yet.</div>`;

    const scanning = !!L.scanning;
    const err = mem && mem.fetchError;
    return `<div class="rwth-ledger">
      <div class="rwth-ledger-bar">
        <div class="rwth-filters">${filterBtns}</div>
        <div class="rwth-ledger-actions">
          <button class="rwth-btn rwth-btn-ghost" type="button" data-action="scan"${
            scanning ? ' disabled' : ''}>${scanning ? 'Scanning…' : 'Scan'}</button>
          <button class="rwth-btn rwth-btn-add" type="button" data-action="add-item">+ add</button>
        </div>
      </div>
      ${err ? `<div class="rwth-form-error rwth-banner">${escapeAttr(err)}</div>` : ''}
      ${L.scanMessage && !err ? `<div class="rwth-placeholder">${escapeAttr(L.scanMessage)}</div>` : ''}
      ${buildScanChecklist(mem)}
      ${L.editingId ? buildLedgerForm(mem) : ''}
      ${buildSellBox(mem)}
      <div class="rwth-rows">${list}</div>
    </div>`;
  }

  // ─── BonusTrashGuard (pure, ADR-0002) ───────────────────────────────────────
  // Curated trash-bonus exclusion list. `isExcluded` is consulted before any
  // Supabase/weav3r fetch so excluded items short-circuit with no API spend.
  // `excluded` may be an Array<string> or a Set<string>; names are matched
  // case-insensitively against the lower-cased bonus id.
  const BonusTrashGuard = {
    isExcluded(bonusName, excluded) {
      if (!bonusName || !excluded) return false;
      const key = String(bonusName).trim().toLowerCase();
      if (!key) return false;
      if (excluded instanceof Set) return excluded.has(key);
      if (Array.isArray(excluded)) {
        for (const e of excluded) {
          if (String(e || '').trim().toLowerCase() === key) return true;
        }
      }
      return false;
    },
  };

  // Settings fields — order is the on-screen order.
  const SETTINGS_FIELDS = [
    { key: 'playerId',            label: 'Player ID',            type: 'text', placeholder: 'e.g. 1234567' },
    { key: 'forumThreadUrl',      label: 'Forum thread URL',     type: 'url',  placeholder: 'https://www.torn.com/forums.php#/p=threads&f=...' },
    { key: 'weav3rPricelistUrl',  label: 'Weav3r pricelist URL', type: 'url',  placeholder: 'https://...' },
    { key: 'bannerImageUrl',      label: 'Bazaar banner image URL',  type: 'url', placeholder: 'https://...' },
    { key: 'forumHeaderImageUrl', label: 'Forum header image URL',   type: 'url', placeholder: 'https://...' },
    { key: 'viewCounterUrl',      label: 'View counter URL',     type: 'url',  placeholder: 'https://CODE.goatcounter.com/count' },
    { key: 'apiKey',              label: 'Torn API key',         type: 'password', placeholder: '###PDA-APIKEY###' },
  ];

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // Invisible view-counter pixel appended to advertise HTML. Each render of a
  // forum/bazaar/signature post requests this image, pinging the configured
  // hit-counter service (e.g. GoatCounter) so visits are tallied server-side.
  // `label` is the per-surface path tag so the dashboard can split them.
  // Returns '' when no counter URL is configured.
  function counterPixel(settings, label) {
    const base = ((settings || {}).viewCounterUrl || '').trim();
    if (!base) return '';
    const sep = base.includes('?') ? '&' : '?';
    const src = `${base}${sep}p=${encodeURIComponent('/' + label)}`;
    return `<img src="${escapeAttr(src)}" alt="" width="1" height="1" `
      + `style="width: 1px; height: 1px; border: 0; display: block;" `
      + `referrerpolicy="no-referrer">`;
  }

  // v0.3.0 slice 9 — Settings serializers for the seed-data editors.
  // Plain text shapes so users can paste forum-curated lists straight in;
  // no defaults are seeded in code (PRD #265).
  function fmtTrashList(arr) {
    return Array.isArray(arr) ? arr.join(', ') : '';
  }
  function parseTrashList(text) {
    return String(text || '')
      .split(/[\s,;\n]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
  }
  // v0.3.0 slice 19a (#285) — `bonus: YYYY-MM-DD` per line. User overrides
  // shown alongside the in-code seed so the user sees what's already active.
  function fmtBonusChangeDates(seed, overrides) {
    const merged = { ...seed, ...(overrides || {}) };
    return Object.keys(merged).sort()
      .map(k => `${k}: ${merged[k]}`).join('\n');
  }
  function parseBonusChangeDates(text, seed) {
    const out = {};
    String(text || '').split(/\n+/).forEach((line) => {
      const m = String(line).trim().match(/^([a-z][a-z0-9_\- ]*?)\s*[:=]\s*(\d{4}-\d{2}-\d{2})\s*$/i);
      if (!m) return;
      const key = m[1].trim().toLowerCase();
      const iso = m[2];
      // Only persist as an override when it differs from the seed — keeps
      // the stored override map small and faithful to user intent.
      if (!seed || seed[key] !== iso) out[key] = iso;
    });
    return out;
  }
  // v0.3.0 slice 19d (#288) — one cluster per line, comma-separated tokens.
  // Seed clusters are shown alongside user overrides so the user can see what
  // is already active. Saved overrides are clusters not already in the seed.
  function fmtSimilarBases(seed, overrides) {
    const lines = [];
    (seed || []).forEach(c => lines.push((c || []).join(', ')));
    (overrides || []).forEach(c => lines.push((c || []).join(', ')));
    return lines.join('\n');
  }
  function parseSimilarBases(text, seed) {
    const seedKeys = new Set((seed || []).map(c => (c || []).join(',')));
    const out = [];
    String(text || '').split(/\n+/).forEach((line) => {
      const tokens = String(line).split(/[,]+/)
        .map(t => t.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter(Boolean);
      if (tokens.length < 2) return;
      const key = tokens.join(',');
      if (seedKeys.has(key)) return;
      out.push(tokens);
    });
    return out;
  }
  // Resolve adjacency: find the first cluster (seed ∪ overrides) that contains
  // a token matching itemName, then return up to one neighbour on each side.
  // A token matches when its underscore-stripped form is a substring of the
  // lower-cased item name (e.g. 'metal_nunchakus' → 'metal nunchakus').
  function resolveAdjacentBases(itemName, intel) {
    const name = String(itemName || '').toLowerCase().trim();
    if (!name) return [];
    const userClusters = (intel && Array.isArray(intel.similarBases))
      ? intel.similarBases : [];
    const clusters = SIMILAR_BASES_SEED.concat(userClusters);
    const tokenToName = (tok) => String(tok || '').replace(/_/g, ' ');
    for (const cluster of clusters) {
      if (!Array.isArray(cluster) || cluster.length < 2) continue;
      const idx = cluster.findIndex(tok => name.includes(tokenToName(tok)));
      if (idx < 0) continue;
      const out = [];
      // One side then the other — order preserved per spec (stronger + weaker).
      if (idx > 0) out.push(cluster[idx - 1]);
      if (idx < cluster.length - 1) out.push(cluster[idx + 1]);
      return out.map(tok => ({ token: tok, label: tokenToName(tok) }));
    }
    return [];
  }
  // Resolve a similar-base token to a full Torn item name using the cached
  // items dict. Picks the shortest dict entry whose lowercased form contains
  // the token — e.g. 'samurai' → 'Samurai Sword', 'tavor' → 'Tavor'. Falls
  // back to a Title-cased token when the dict is unavailable so the Supabase
  // call can still attempt the lookup.
  function _resolveBaseItemName(label, dict) {
    const tok = String(label || '').toLowerCase().trim();
    if (!tok) return null;
    if (dict) {
      let best = null;
      for (const key of Object.keys(dict)) {
        if (String(key).toLowerCase().includes(tok)) {
          if (best == null || key.length < best.length) best = key;
        }
      }
      if (best) return best;
    }
    return tok.replace(/\b\w/g, ch => ch.toUpperCase());
  }
  function buildSettingsTab(mem) {
    const s = (mem && mem.settings) || {};
    const intel = (mem && mem.intel) || MEM.intel;
    const rows = SETTINGS_FIELDS.map(f => `
      <label class="rwth-field">
        <span class="rwth-field-label">${f.label}</span>
        <input class="rwth-field-input" type="${f.type}" data-setting="${f.key}"
               value="${escapeAttr(s[f.key])}" placeholder="${escapeAttr(f.placeholder)}"
               autocomplete="off" spellcheck="false">
      </label>`).join('');
    return `<div class="rwth-settings">
      ${rows}
      <hr class="rwth-settings-divider">
      <p class="rwth-form-title" style="margin:0 0 6px;">Intel</p>
      <div class="rwth-intel-row">
        <label class="rwth-intel-check">
          <input type="checkbox" data-intel="enabled.auction"
                 ${intel.enabled.auction ? 'checked' : ''}>
          Enable on Auction scanner
        </label>
        <label class="rwth-intel-check">
          <input type="checkbox" data-intel="enabled.ledger"
                 ${intel.enabled.ledger ? 'checked' : ''}>
          Enable on Ledger
        </label>
      </div>
      <div class="rwth-intel-grid">
        <label class="rwth-field">
          <span class="rwth-field-label">Mug buffer %</span>
          <input class="rwth-field-input" type="number" min="0" max="100" step="1"
                 data-intel="mugBuffer"
                 value="${escapeAttr(intel.mugBuffer)}">
        </label>
        <label class="rwth-field">
          <span class="rwth-field-label">Margin target %</span>
          <input class="rwth-field-input" type="number" min="0" max="200" step="1"
                 data-intel="marginTarget"
                 value="${escapeAttr(intel.marginTarget)}">
        </label>
        <label class="rwth-field">
          <span class="rwth-field-label">Markup ×</span>
          <input class="rwth-field-input" type="number" min="1" max="10" step="0.01"
                 data-intel="markup"
                 value="${escapeAttr(intel.markup)}">
        </label>
      </div>
      <label class="rwth-intel-check" style="margin-top:4px;">
        <input type="checkbox" data-intel="defaults.ignoreQuality"
               ${intel.defaults.ignoreQuality ? 'checked' : ''}>
        Any Quality (ignore quality for all items by default)
      </label>
      <label class="rwth-intel-check" style="margin-top:4px;">
        <input type="checkbox" data-intel="qualityClampDefault"
               ${intel.qualityClampDefault ? 'checked' : ''}>
        Quality clamp ON by default (seed new cards to exact-bucket filter)
      </label>

      <p class="rwth-form-title" style="margin:14px 0 4px;">Trash bonus list</p>
      <p class="rwth-intel-empty" style="margin:0 0 4px;">Bonuses to skip entirely — comma- or newline-separated. Items carrying any of these short-circuit before any comp fetch.</p>
      <textarea class="rwth-field-input" id="rwth-intel-trash" rows="2"
                style="width:100%;font-family:inherit;"
                placeholder="cupid, achilles, …">${escapeAttr(fmtTrashList(intel.excludedBonuses))}</textarea>

      <p class="rwth-form-title" style="margin:14px 0 4px;">Reference tables</p>
      <p class="rwth-intel-empty" style="margin:0 0 4px;">Bonus-mechanic change dates — one per line as <code>bonus: YYYY-MM-DD</code>. Cleared sales older than the date for that bonus are suppressed from the comp set (King example 4 — puncture nerf).</p>
      <textarea class="rwth-field-input" id="rwth-intel-bonus-change-dates" rows="3"
                style="width:100%;font-family:inherit;"
                placeholder="puncture: 2026-02-01">${escapeAttr(fmtBonusChangeDates(BONUS_CHANGE_DATES_SEED, intel.bonusChangeDates))}</textarea>

      <p class="rwth-intel-empty" style="margin:8px 0 4px;">Similar-base clusters — one cluster per line, comma-separated tokens (lower-case, underscores for spaces). When same-base comps are thin, the script pulls one stronger + one weaker neighbour from the cluster (King example 3 — yasukuni weaken cross-checked vs kodachi + samurai).</p>
      <textarea class="rwth-field-input" id="rwth-intel-similar-bases" rows="4"
                style="width:100%;font-family:inherit;"
                placeholder="macana, dbk, metal_nunchakus, kodachi, samurai, yasukuni, katana">${escapeAttr(fmtSimilarBases(SIMILAR_BASES_SEED, intel.similarBases))}</textarea>

      <div class="rwth-settings-actions">
        <button class="rwth-btn" type="button" data-action="save-settings">Save</button>
        <span id="rwth-settings-status" class="rwth-settings-status" role="status" aria-live="polite"></span>
      </div>
      <div class="rwth-settings-actions" style="margin-top:8px;opacity:0.6;">
        <button class="rwth-btn rwth-btn-ghost" type="button" data-action="smoke-weav3r"
                title="v0.2.0 plumbing smoke test — fires one GM_xmlhttpRequest to weav3r and logs the response to the console (ADR-0003).">
          Smoke: weav3r ping
        </button>
      </div>
    </div>`;
  }

  // v0.2.0 slice 1 — third-party-API plumbing smoke test (ADR-0003).
  // Fires one GM_xmlhttpRequest to weav3r and logs the response so we can
  // confirm the @grant/@connect switch actually permits the call before any
  // PricingEngine code is written. Result is console-only; no UI surface.
  function smokeWeav3r() {
    const url = 'https://weav3r.dev/ranked-weapons?tab=armor&armorSet=Riot';
    /* eslint-disable no-undef */
    if (typeof GM_xmlhttpRequest !== 'function') {
      console.error('[RWTH] smoke: GM_xmlhttpRequest unavailable — @grant not honoured');
      return;
    }
    console.log('[RWTH] smoke: GET', url);
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      onload: (res) => {
        const body = typeof res.responseText === 'string' ? res.responseText : '';
        console.log('[RWTH] smoke: response', {
          status: res.status,
          finalUrl: res.finalUrl,
          length: body.length,
          preview: body.slice(0, 400),
        });
      },
      onerror: (err) => console.error('[RWTH] smoke: error', err),
      ontimeout: () => console.error('[RWTH] smoke: timeout'),
    });
    /* eslint-enable no-undef */
  }

  // ─── Advertise — outputs + generators (pure) ─────────────────────────────────
  // Compact money for the chat blurb: $118m, $78.5m, $1.5b. Empty for non-positive.
  function fmtChatPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    const trim = (s) => s.replace(/\.?0+$/, '');
    if (v >= 1e9) return '$' + trim((v / 1e9).toFixed(2)) + 'b';
    if (v >= 1e6) return '$' + trim((v / 1e6).toFixed(1)) + 'm';
    if (v >= 1e3) return '$' + trim((v / 1e3).toFixed(1)) + 'k';
    return '$' + v;
  }

  // One chat-blurb item line. Name is abbreviated via ITEM_ABBREV; the parens
  // default to the primary bonus, falling back to quality % when there is none.
  // withPrice=false drops the price tail — used to claw back characters so an
  // extra listing can fit before any listing is dropped entirely.
  function chatItemLine(item, withPrice) {
    const name = ITEM_ABBREV[item.itemName] || item.itemName || '';
    const b = (item.bonuses || [])[0];
    let paren = '';
    if (b && b.name) paren = b.value != null ? `${b.name} ${b.value}%` : b.name;
    else if (item.quality != null) paren = `${item.quality}% q`;
    const price = withPrice === false ? '' : fmtChatPrice(item.listPrice);
    return `[S] <b>${name}</b>${paren ? ` (${paren})` : ''}`
         + `${price ? ` — <b>${price}</b>` : ''}`;
  }

  // ─── Item categorisation — Advertise dividers ────────────────────────────────
  // Items split into Primary/Secondary/Melee/Armor for the advertise outputs.
  // The split is driven by Torn's own item `type` field — cached by ItemDict
  // from /v2/torn/items — so every weapon Torn knows is mapped automatically.
  // Pre-dictionary first runs fall through to 'Other'.
  const CATEGORY_ORDER = ['Primary', 'Secondary', 'Melee', 'Armor', 'Other'];

  // Normalise a Torn item `type` to an advertise category. Weapon classes pass
  // through; "Defensive" (armour) collapses to "Armor"; anything else → null.
  function normCategory(type) {
    switch (String(type || '').toLowerCase()) {
      case 'primary':   return 'Primary';
      case 'secondary': return 'Secondary';
      case 'melee':     return 'Melee';
      case 'defensive': return 'Armor';
      default:          return null;
    }
  }

  // Resolve one item's advertise category. An explicit, user-set `item.category`
  // always wins; then the optional name→category index from ItemDict; then the
  // item's own weapon/armor type; then the offline fallback map; then "Other".
  function itemCategory(item, cats) {
    if (item && CATEGORY_ORDER.indexOf(item.category) !== -1
        && item.category !== 'Other') return item.category;
    const name = (item && item.itemName) || '';
    const fromDict = cats && cats[name.toLowerCase()];
    if (fromDict) return fromDict;
    if (item && item.type === 'armor') return 'Armor';
    return 'Other';
  }

  // The four user-pickable advertise categories (Other is resolved, not picked).
  const PICK_CATEGORIES = ['Primary', 'Secondary', 'Melee', 'Armor'];
  function categoryOptions(selected) {
    const sel = PICK_CATEGORIES.indexOf(selected) !== -1 ? selected : 'Primary';
    return PICK_CATEGORIES.map(c =>
      `<option value="${c}"${c === sel ? ' selected' : ''}>${c}</option>`).join('');
  }

  // Selected items → ordered category buckets, alphabetical within each. Empty
  // categories are dropped so dividers only appear where there is live stock.
  // A pre-stamped `item.category` (set by buildAdvertiseTab) is trusted as-is.
  function groupByCategory(items) {
    const buckets = {};
    for (const it of (items || [])) {
      const c = it.category || itemCategory(it);
      (buckets[c] || (buckets[c] = [])).push(it);
    }
    return CATEGORY_ORDER
      .filter(c => buckets[c])
      .map(c => ({
        category: c,
        items: buckets[c].slice().sort((a, b) =>
          String(a.itemName || '').localeCompare(String(b.itemName || ''))),
      }));
  }

  // ─── Forum HTML — section markup ─────────────────────────────────────────────
  // Each helper returns one <tr> (or a wrapper) of the forum post.
  //
  // Theme-proofing: Torn's forum/bazaar renderer paints its own cell borders
  // (white in dark mode) and forces a dark `color` onto bare <td> text in light
  // mode. So these builders: (1) carry NO visible CSS border — every line is a
  // background-filled element; (2) set `border:0` plus the border="0" /
  // cellspacing / cellpadding attributes on every table to suppress the
  // renderer's own chrome; (3) set `border:0` on every <img>; and (4) wrap
  // EVERY text run in a <span>/<div> with its own inline `color`.
  const TBL = 'border="0" cellspacing="0" cellpadding="0"';

  // A theme-proof hairline — a 1px background-filled <div>, never a CSS border.
  function forumRule() {
    return `<tr><td style="background: #080e18; padding: 0 22px; line-height: 0; border: 0;">`
      + `<div style="height: 1px; background: #15301f; font-size: 0; line-height: 0;">&nbsp;</div></td></tr>`;
  }

  // A theme-proof <img> — block display, no border the dark theme can light up.
  function forumImg(src) {
    return `<img border="0" src="${escapeAttr(src)}" alt="" width="100%" `
      + `style="display: block; height: auto; border: 0; outline: 0;"/>`;
  }

  // Brand header. The forum header image, when set, replaces the NC17 text
  // block entirely (user's slice-7 decision).
  function forumHeader(s) {
    const img = (s.forumHeaderImageUrl || '').trim();
    if (img) {
      return `<tr><td style="background: #080e18; padding: 0; line-height: 0; border: 0;">`
        + `<a href="${escapeAttr(img)}" target="_blank" rel="noopener" style="border: 0;">`
        + `${forumImg(img)}</a></td></tr>`;
    }
    return `<tr><td style="background: #080e18; padding: 22px 22px 18px; text-align: center; border: 0;">`
      + `<div style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.32em; text-transform: uppercase;">`
      + `${escapeAttr(BRAND.mark)}</div>`
      + `<div style="color: #8aa898; font-size: 11px; letter-spacing: 0.4em; text-transform: uppercase; padding-top: 6px;">`
      + `//&nbsp; Trading Post &nbsp;//</div></td></tr>`;
  }

  // Centered pill flanked by background-filled hairlines.
  function forumSectionHeader(label) {
    const hair = `<td style="width: 35%; vertical-align: middle; padding: 0; border: 0;">`
      + `<div style="height: 1px; background: #1d3a26; font-size: 0; line-height: 0;">&nbsp;</div></td>`;
    return `<tr><td style="background: #080e18; padding: 18px 22px 10px; border: 0;">`
      + `<table ${TBL} width="100%" style="border: 0; border-collapse: collapse;"><tbody><tr>${hair}`
      + `<td style="text-align: center; vertical-align: middle; padding: 0 14px; white-space: nowrap; border: 0;">`
      + `<span style="display: inline-block; background: #11251a; `
      + `color: #7ed098; font-size: 11px; font-weight: bold; letter-spacing: 0.28em; text-transform: uppercase; `
      + `padding: 6px 15px; border-radius: 2px;">&#9679; ${escapeAttr(label)}</span></td>`
      + `${hair}</tr></tbody></table></td></tr>`;
  }

  // Category divider — Primary/Secondary/Melee/Armor. Same pill-and-hairline
  // treatment as the section header but cyan, so it reads clearly as a divider
  // ranking just below the green section headers.
  function forumCategoryDivider(label) {
    const hair = `<td style="width: 30%; vertical-align: middle; padding: 0; border: 0;">`
      + `<div style="height: 1px; background: #1a3346; font-size: 0; line-height: 0;">&nbsp;</div></td>`;
    return `<tr><td style="background: #080e18; padding: 15px 22px 5px; border: 0;">`
      + `<table ${TBL} width="100%" style="border: 0; border-collapse: collapse;"><tbody><tr>${hair}`
      + `<td style="text-align: center; vertical-align: middle; padding: 0 12px; white-space: nowrap; border: 0;">`
      + `<span style="display: inline-block; background: #102232; `
      + `color: #5dc6f0; font-size: 10px; font-weight: bold; letter-spacing: 0.26em; text-transform: uppercase; `
      + `padding: 5px 14px; border-radius: 2px;">${escapeAttr(label)}</span></td>`
      + `${hair}</tr></tbody></table></td></tr>`;
  }

  // One bonus chip. Value-less bonuses show the name alone.
  function forumChip(b) {
    const txt = b.value != null ? `${escapeAttr(b.name)} &nbsp;${b.value}%` : escapeAttr(b.name);
    return `<span style="display: inline-block; background: #16301f; color: #7ed098; `
      + `font-size: 10px; font-weight: bold; letter-spacing: 0.16em; text-transform: uppercase; `
      + `padding: 4px 9px; border-radius: 2px;">${txt}</span>`;
  }

  // One "Currently Available" card: optional screenshot on top, a full-width
  // green accent bar, then the info row — name + chips left, price right. The
  // outer table is single-column so cell widths never get ambiguous.
  function forumItemCard(item) {
    const bonuses = (item.bonuses || []).filter(b => b && b.name);
    const chips = bonuses.map((b, i) =>
      `<div style="margin-top: ${i === 0 ? 7 : 4}px;">${forumChip(b)}</div>`).join('');
    const img = (item.gyazoUrl || '').trim();
    const imgRow = img
      ? `<tr><td style="background: #060a12; padding: 0; line-height: 0; border: 0;">`
        + `<a href="${escapeAttr(img)}" target="_blank" rel="noopener" style="border: 0;">`
        + `${forumImg(img)}</a></td></tr>`
      : '';
    return `<tr><td style="background: #080e18; padding: 8px 22px; border: 0;">`
      + `<table ${TBL} width="100%" style="background: #0c1422; border: 0; border-collapse: collapse;"><tbody>`
      + imgRow
      + `<tr><td style="background: #6dc488; height: 3px; line-height: 0; font-size: 0; padding: 0; border: 0;">&nbsp;</td></tr>`
      + `<tr><td style="background: #0c1422; padding: 15px 18px; border: 0;">`
      + `<table ${TBL} width="100%" style="border: 0; border-collapse: collapse;"><tbody><tr>`
      + `<td style="text-align: left; vertical-align: middle; border: 0;">`
      + `<div style="color: #5dc6f0; font-size: 17px; font-weight: bold; letter-spacing: 0.04em; line-height: 1.2;">`
      + `${escapeAttr(item.itemName)}</div>${chips}</td>`
      + `<td style="text-align: right; vertical-align: middle; white-space: nowrap; padding-left: 14px; border: 0;">`
      + `<span style="color: #7ed098; font-size: 22px; font-weight: bold; letter-spacing: 0.02em; `
      + `font-family: Consolas, 'Courier New', monospace;">${escapeAttr(fmtMoney(item.listPrice))}</span></td>`
      + `</tr></tbody></table></td></tr></tbody></table></td></tr>`;
  }

  // One Recent Transactions line. The tx record carries no buyer XID, so the
  // buyer renders as plain text rather than the template's profile link.
  function forumTxRow(tx) {
    const bonus = tx.bonusName ? ` (${escapeAttr(tx.bonusName)})` : '';
    const buyer = tx.buyer ? ` to&nbsp;${escapeAttr(tx.buyer)}` : '';
    const price = tx.price != null ? ` at ${escapeAttr(fmtMoney(tx.price))}` : '';
    return `<tr><td style="background: #0c1422; padding: 9px 14px; border: 0;">`
      + `<span style="color: #8aa898; font-size: 11px; font-style: italic; `
      + `font-family: Consolas, 'Courier New', monospace;">`
      + `You sold a&nbsp;${escapeAttr(tx.itemName)}${bonus}${buyer}${price}</span></td></tr>`;
  }

  // One pill-style link button for the bazaar output footer.
  function bazaarLink(href, label) {
    return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener" `
      + `style="display: inline-block; background: #11223a; color: #5dc6f0; font-size: 11px; `
      + `font-weight: bold; letter-spacing: 0.16em; text-transform: uppercase; text-decoration: none; `
      + `padding: 9px 17px; border-radius: 2px; margin: 4px 5px;">${escapeAttr(label)} &#8599;</a>`;
  }

  // ─── Signature HTML — section markup ─────────────────────────────────────────
  // The profile signature is a truncated, image-less catalogue, so each item
  // card carries a few stored metrics (rarity, bonuses, quality) as chips
  // instead of leaning on a screenshot the way the forum cards do.
  const CATEGORY_ACCENT = {
    Primary: '#6dc488', Secondary: '#5dc6f0', Melee: '#e0a85a',
    Armor: '#b48ce0', Other: '#8aa898',
  };
  const RARITY_COLOR = {
    white: '#d7dde2', yellow: '#e8d24a', orange: '#e8993a', red: '#e0524a',
  };

  // One signature chip — a small background-filled pill, theme-proof.
  function sigChip(txt, fg, bg) {
    return `<span style="display: inline-block; background: ${bg}; color: ${fg}; `
      + `font-size: 9px; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase; `
      + `padding: 3px 7px; border-radius: 2px; margin: 4px 4px 0 0;">${txt}</span>`;
  }

  // One signature item card — a category-coloured left accent rail, the name
  // with its rarity, a chip row of bonuses + quality, and the price anchored
  // to a constant-width right rail.
  function sigItemCard(item, accent) {
    const bonuses = (item.bonuses || []).filter(b => b && b.name);
    const rarity = String(item.rarity || '').toLowerCase();
    const chips = [];
    for (const b of bonuses) {
      const v = b.value != null ? ` ${b.value}%` : '';
      chips.push(sigChip(`${escapeAttr(b.name)}${v}`, '#7ed098', '#16301f'));
    }
    if (item.quality != null) {
      chips.push(sigChip(`${escapeAttr(item.quality)}% Quality`, '#9ab5a5', '#11251a'));
    }
    const chipRow = chips.length
      ? `<div style="margin-top: 3px;">${chips.join('')}</div>` : '';
    const rarityTag = (rarity && RARITY_COLOR[rarity])
      ? `<span style="display: inline-block; color: ${RARITY_COLOR[rarity]}; font-size: 9px; `
        + `font-weight: bold; letter-spacing: 0.14em; text-transform: uppercase; `
        + `padding-left: 8px; vertical-align: middle;">&#9670; ${escapeAttr(rarity)}</span>`
      : '';
    return `<tr><td colspan="2" style="background: #080e18; padding: 4px 12px; border: 0;">`
      + `<table ${TBL} width="100%" style="background: #0c1422; border: 0; border-collapse: collapse;">`
      + `<tbody><tr>`
      + `<td style="width: 3px; background: ${accent}; font-size: 0; line-height: 0; padding: 0; `
      + `border: 0;">&nbsp;</td>`
      + `<td style="padding: 9px 12px; vertical-align: middle; border: 0;">`
      + `<div><span style="color: #5dc6f0; font-size: 13px; font-weight: bold; `
      + `letter-spacing: 0.02em; vertical-align: middle; font-family: Verdana, Geneva, sans-serif;">`
      + `${escapeAttr(item.itemName)}</span>${rarityTag}</div>${chipRow}</td>`
      + `<td width="104" style="width: 104px; padding: 9px 12px; text-align: right; `
      + `vertical-align: middle; white-space: nowrap; border: 0;">`
      + `<span style="color: #7ed098; font-size: 15px; font-weight: bold; `
      + `font-family: Consolas, 'Courier New', monospace;">${escapeAttr(fmtChatPrice(item.listPrice))}</span>`
      + `</td></tr></tbody></table></td></tr>`;
  }

  const AdvertiseGenerator = {
    // Output 1 — forum thread title; static brand text.
    toForumTitle() { return BRAND.forumThreadTitle; },

    // Output — full forum post HTML. Item-driven from the selected `listed`
    // rows + Recent Transactions; cards grouped under category dividers.
    toForumHtml(items, transactions, settings) {
      const s = settings || {};
      const txs = transactions || [];
      const rows = [];
      rows.push(forumHeader(s));
      rows.push(forumRule());
      // Sub-banner.
      rows.push(`<tr><td style="background: #080e18; padding: 12px 22px 8px; text-align: center; border: 0;">`
        + `<span style="font-size: 13px; font-weight: bold; letter-spacing: 0.16em; color: #6dc488; text-transform: uppercase;">`
        + `Open shop &nbsp;//&nbsp; Competitively priced</span></td></tr>`);
      // Intro — every text run wrapped so the light-mode theme can't darken it.
      rows.push(`<tr><td style="background: #080e18; padding: 6px 22px 16px; text-align: center; line-height: 1.7; border: 0;">`
        + `<span style="color: #c5dccc; font-size: 13px;">`
        + `Rotating collection of RW weapons/gear and other useful items.</span><br/><br/>`
        + `<span style="color: #9ab5a5; font-size: 13px;">`
        + `If something below isn't currently listed, message me.</span></td></tr>`);
      rows.push(forumSectionHeader('Currently Available'));
      for (const group of groupByCategory(items)) {
        rows.push(forumCategoryDivider(group.category));
        for (const it of group.items) rows.push(forumItemCard(it));
      }
      // Rotating-note line.
      rows.push(`<tr><td style="background: #080e18; padding: 8px 22px 14px; border: 0;">`
        + `<span style="color: #8aa898; font-size: 12px; font-style: italic;">`
        + `Also rotating: drugs, plushies, flowers. Check bazaar for live stock.</span></td></tr>`);
      if (txs.length) {
        rows.push(forumSectionHeader('Recent Transactions'));
        rows.push(`<tr><td style="background: #080e18; padding: 6px 22px 16px; border: 0;">`
          + `<table ${TBL} width="100%" style="background: #0c1422; border: 0; border-collapse: collapse;">`
          + `<tbody>${txs.map(forumTxRow).join('')}</tbody></table></td></tr>`);
      }
      rows.push(forumRule());
      // Footer — tagline left, bazaar link right.
      const pid = (s.playerId || '').trim();
      const link = pid
        ? `<a style="color: #5dc6f0; font-size: 12px; font-weight: bold; letter-spacing: 0.14em; `
          + `text-transform: uppercase; text-decoration: none;" `
          + `href="/bazaar.php?userId=${escapeAttr(pid)}" target="_blank" rel="noopener">Visit Bazaar &#8599;</a>`
        : '';
      rows.push(`<tr><td style="background: #080e18; padding: 0; border: 0;">`
        + `<table ${TBL} width="100%" style="border: 0; border-collapse: collapse;"><tbody><tr>`
        + `<td style="background: #080e18; padding: 12px 22px 13px; text-align: left; vertical-align: middle; border: 0;">`
        + `<span style="font-size: 12px; letter-spacing: 0.12em; color: #7ed098; text-transform: uppercase; font-style: italic;">`
        + `${escapeAttr(BRAND.footerTagline)}</span></td>`
        + `<td style="background: #080e18; padding: 12px 22px 13px; text-align: right; vertical-align: middle; border: 0;">`
        + `${link}</td></tr></tbody></table></td></tr>`);
      return `<div><div class="table-wrap"><table ${TBL} width="100%" style="background: #080e18; border: 0; `
        + `border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;">`
        + `<tbody>${rows.join('')}</tbody></table></div>`
        + `${counterPixel(s, 'rwth-forum')}</div>`;
    },

    // Output — bazaar description HTML. The bazaar page lists stock natively, so
    // this is brand/about copy only. When a banner is set it carries the brand;
    // a redundant NC17 wordmark is deliberately omitted in that case.
    toBazaarHtml(settings) {
      const s = settings || {};
      const banner = (s.bannerImageUrl || '').trim();
      const rows = [];
      if (banner) {
        rows.push(`<tr><td style="background: #060a12; padding: 0; line-height: 0; border: 0;">`
          + `${forumImg(banner)}</td></tr>`);
      } else {
        // No banner — a compact wordmark stands in so the panel still has a crown.
        rows.push(`<tr><td style="background: #080e18; padding: 20px 24px 8px; text-align: center; border: 0;">`
          + `<span style="color: #7ed098; font-size: 20px; font-weight: bold; `
          + `letter-spacing: 0.3em; text-transform: uppercase;">${escapeAttr(BRAND.mark)}</span></td></tr>`);
      }
      rows.push(forumRule());
      // About panel — kicker + the single RW Gear pitch line.
      rows.push(`<tr><td style="background: #080e18; padding: 18px 24px 6px; text-align: center; border: 0;">`
        + `<span style="color: #5dc6f0; font-size: 10px; font-weight: bold; letter-spacing: 0.3em; `
        + `text-transform: uppercase;">//&nbsp; The Trading Post &nbsp;//</span></td></tr>`);
      rows.push(`<tr><td style="background: #080e18; padding: 4px 24px 16px; text-align: center; line-height: 1.7; border: 0;">`
        + `<span style="color: #c5dccc; font-size: 13px;">`
        + `RW Gear &mdash; top tier weapons/bonuses, priced fair and rotating constantly.</span></td></tr>`);
      rows.push(forumRule());
      rows.push(`<tr><td style="background: #080e18; padding: 13px 24px 12px; text-align: center; border: 0;">`
        + `<span style="color: #9ab5a5; font-size: 12px; font-style: italic;">`
        + `Check Display Case or send me a message if you don't see an advertised item`
        + `</span></td></tr>`);
      // Link buttons — forum thread and live pricelist, when configured.
      const links = [];
      const forumUrl = (s.forumThreadUrl || '').trim();
      const priceUrl = (s.weav3rPricelistUrl || '').trim();
      if (forumUrl) links.push(bazaarLink(forumUrl, 'Forum Thread'));
      if (priceUrl) links.push(bazaarLink(priceUrl, 'Live Pricelist'));
      if (links.length) {
        rows.push(`<tr><td style="background: #080e18; padding: 2px 20px 16px; text-align: center; border: 0;">`
          + `${links.join('')}</td></tr>`);
      }
      // Footer disclaimer on a slightly lifted fill so it reads as a strip.
      rows.push(`<tr><td style="background: #0b1320; padding: 11px 24px 12px; text-align: center; border: 0;">`
        + `<span style="font-size: 11px; letter-spacing: 0.08em; color: #8aa898; font-style: italic;">`
        + `**Contains explicit deals, weapons, and depictions of violence.</span></td></tr>`);
      return `<div><div class="table-wrap"><table ${TBL} width="100%" style="background: #080e18; border: 0; `
        + `border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;">`
        + `<tbody>${rows.join('')}</tbody></table></div>`
        + `${counterPixel(s, 'rwth-bazaar')}</div>`;
    },

    // Output — profile signature HTML. A compact, image-less catalogue: the
    // banner up top, slim category dividers, one metric-rich card per item
    // (accent rail + name/rarity + bonus/quality chips + price), and a link
    // strip along the foot.
    toSignatureHtml(items, settings) {
      const s = settings || {};
      const img = (s.forumHeaderImageUrl || s.bannerImageUrl || '').trim();
      // Header — the configured banner image; a wordmark bar only if none set.
      const headerRow = img
        ? `<tr><td colspan="2" style="background: #060a12; padding: 0; line-height: 0; border: 0;">`
          + `<a href="${escapeAttr(img)}" target="_blank" rel="noopener" style="border: 0;">`
          + `${forumImg(img)}</a></td></tr>`
        : `<tr><td colspan="2" style="background: #0b1320; padding: 11px 14px 9px; `
          + `text-align: center; border: 0;">`
          + `<span style="color: #7ed098; font-size: 14px; font-weight: bold; letter-spacing: 0.28em; `
          + `text-transform: uppercase;">${escapeAttr(BRAND.mark)}</span></td></tr>`;
      const bodyRows = [];
      for (const group of groupByCategory(items)) {
        const accent = CATEGORY_ACCENT[group.category] || CATEGORY_ACCENT.Other;
        // Category divider — accent-dotted label over a hairline.
        bodyRows.push(`<tr><td colspan="2" style="background: #080e18; padding: 11px 14px 4px; border: 0;">`
          + `<span style="color: ${accent}; font-size: 9px; font-weight: bold; letter-spacing: 0.24em; `
          + `text-transform: uppercase;">&#9679;&nbsp; ${escapeAttr(group.category)}</span>`
          + `<div style="height: 1px; background: #15301f; margin-top: 5px; font-size: 0; `
          + `line-height: 0;">&nbsp;</div></td></tr>`);
        for (const it of group.items) bodyRows.push(sigItemCard(it, accent));
      }
      // Foot — a link strip. Forum / Pricelist / Bazaar, dot-separated.
      const sigLink = (href, label) =>
        `<a href="${escapeAttr(href)}" target="_blank" rel="noopener" `
        + `style="color: #5dc6f0; font-size: 10px; font-weight: bold; letter-spacing: 0.1em; `
        + `text-transform: uppercase; text-decoration: none;">${escapeAttr(label)} &#8599;</a>`;
      const links = [];
      const forumUrl = (s.forumThreadUrl || '').trim();
      const priceUrl = (s.weav3rPricelistUrl || '').trim();
      const pid = (s.playerId || '').trim();
      if (forumUrl) links.push(sigLink(forumUrl, 'Forum'));
      if (priceUrl) links.push(sigLink(priceUrl, 'Pricelist'));
      if (pid) links.push(sigLink(`/bazaar.php?userId=${pid}`, 'Bazaar'));
      const sep = `<span style="color: #2a4738; font-size: 10px;">&nbsp;&nbsp;&bull;&nbsp;&nbsp;</span>`;
      const linkRow = links.length
        ? `<tr><td colspan="2" style="background: #0b1320; padding: 9px 14px; text-align: center; border: 0;">`
          + `${links.join(sep)}</td></tr>`
        : '';
      return `<div><div class="table-wrap"><table ${TBL} width="100%" `
        + `style="background: #080e18; border: 0; border-collapse: collapse;">`
        + `<tbody>${headerRow}${bodyRows.join('')}${linkRow}</tbody></table></div>`
        + `${counterPixel(s, 'rwth-sig')}</div>`;
    },
    // Output 3 — trade-chat blurb. Sorted by list price descending so the
    // highest-value items lead the blurb rather than alphabetised filler.
    toChat(items, settings) {
      const s = settings || {};
      const header = [
        `🔹🔷 <u>${BRAND.mark}</u> 🔷🔹`,
        `🟢 <u>Floor Prices</u> 🟢`,
      ];
      // Brackets sit OUTSIDE the anchor so they render as plain text, not as
      // part of the hotlink.
      const linkLines = [];
      const pid = (s.playerId || '').trim();
      if (pid) linkLines.push(`[<a href="https://www.torn.com/bazaar.php?userId=${pid}#/">Bazaar</a>]`);
      const forum = (s.forumThreadUrl || '').trim();
      if (forum) linkLines.push(`[<a href="${forum}">Forum</a>]`);
      // Chat is a teaser, not a catalogue — show at most the 3 priciest, then a
      // "+N more listed" line so the blurb stays short enough to actually post.
      const CHAT_LIMIT = 3;
      // Torn's chat input caps a post at 125 rendered characters (HTML markup
      // does not count). With 3 items + a "+N more" line the tail — the
      // Bazaar/Forum links — got truncated. To fit: first shed item prices
      // (from the cheapest listing up), and only drop a whole listing once
      // every price is already gone. Links are reserved budget, never dropped.
      const CHAR_LIMIT = 125;
      const sorted = (items || []).slice().sort((a, b) =>
        (Number(b.listPrice) || 0) - (Number(a.listPrice) || 0));
      const picks = sorted.slice(0, CHAT_LIMIT);
      const visibleLen = (arr) => arr.join('\n').replace(/<[^>]+>/g, '').length;
      // shown = listings kept; dropped = how many of them show without a price
      // (the trailing/cheapest ones).
      const assemble = (shown, dropped) => {
        const itemLines = picks.slice(0, shown)
          .map((it, i) => chatItemLine(it, i < shown - dropped));
        const remaining = sorted.length - shown;
        const moreLine = remaining > 0 ? [`<i>+${remaining} more listed</i>`] : [];
        return [...header, ...itemLines, ...moreLine, ...linkLines];
      };
      let chosen = assemble(0, 0);
      for (let shown = picks.length; shown >= 0; shown--) {
        let fit = null;
        for (let dropped = 0; dropped <= shown; dropped++) {
          if (visibleLen(assemble(shown, dropped)) <= CHAR_LIMIT) {
            fit = assemble(shown, dropped);
            break;
          }
        }
        if (fit) { chosen = fit; break; }
      }
      return chosen.join('\n');
    },
  };

  // One checkbox-selected ledger item on the Advertise tab. The list-price and
  // image-URL inputs persist straight onto the ledger row via syncAdvertiseEdit.
  function buildAdvItemRow(item, checked, imgOpen) {
    const bonus = fmtBonuses(item);
    const hasImg = !!(item.gyazoUrl && String(item.gyazoUrl).trim());
    const pop = imgOpen
      ? `<div class="rwth-img-pop">
          <span class="rwth-field-label">Screenshot URL</span>
          <input class="rwth-field-input" data-adv-field="gyazoUrl"
                 value="${escapeAttr(item.gyazoUrl)}" placeholder="https://i.gyazo.com/…"
                 autocomplete="off" spellcheck="false">
          <button class="rwth-btn-sm" type="button" data-action="close-img">Done</button>
        </div>`
      : '';
    return `<div class="rwth-adv-item" data-adv-item="${escapeAttr(item.id)}">
      <label class="rwth-adv-check">
        <input type="checkbox" data-adv-check${checked ? ' checked' : ''}>
        <span class="rwth-row-name">${escapeAttr(item.itemName)}${
          bonus ? ` <span class="rwth-row-bonus">${escapeAttr(bonus)}</span>` : ''}</span>
      </label>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">List price</span>
          <input class="rwth-field-input" type="number" data-adv-field="listPrice"
                 value="${escapeAttr(item.listPrice)}" placeholder="e.g. 118000000">
        </label>
        <div class="rwth-adv-img">
          <button class="rwth-btn-sm${hasImg ? ' rwth-btn-on' : ''}" type="button"
                  data-action="toggle-img" data-id="${escapeAttr(item.id)}">${
            hasImg ? 'IMG ●' : '+ IMG'}</button>
          ${pop}
        </div>
      </div>
    </div>`;
  }

  // One Recent Transactions entry — inline-editable; edits persist via
  // syncAdvertiseEdit. Buyer name is kept as verifiable social proof.
  function buildTxRow(tx) {
    const k = escapeAttr(tx.id);
    return `<div class="rwth-tx-row" data-tx-row="${k}">
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Item</span>
          <input class="rwth-field-input" data-tx-field="itemName"
                 value="${escapeAttr(tx.itemName)}" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Bonus</span>
          <input class="rwth-field-input" data-tx-field="bonusName"
                 value="${escapeAttr(tx.bonusName)}" placeholder="optional" autocomplete="off">
        </label>
      </div>
      <div class="rwth-form-row">
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Buyer</span>
          <input class="rwth-field-input" data-tx-field="buyer"
                 value="${escapeAttr(tx.buyer)}" autocomplete="off">
        </label>
        <label class="rwth-field rwth-field-grow">
          <span class="rwth-field-label">Price</span>
          <input class="rwth-field-input" type="number" data-tx-field="price"
                 value="${escapeAttr(tx.price)}">
        </label>
      </div>
      <div class="rwth-tx-actions">
        <button class="rwth-btn-sm rwth-btn-danger" type="button"
                data-action="remove-tx" data-id="${k}">remove</button>
      </div>
    </div>`;
  }

  // A windowed copy box. Editable boxes are a textarea (the chat blurb is tuned
  // in place before copy); static boxes are a div. Copy reads the live value.
  function buildOutputBox(label, id, value, editable, rows) {
    const body = editable
      ? `<textarea class="rwth-field-input rwth-output-box" id="${id}" rows="${rows || 8}"
                   spellcheck="false">${escapeAttr(value)}</textarea>`
      : `<div class="rwth-output-box" id="${id}">${escapeAttr(value)}</div>`;
    return `<div class="rwth-output">
      <div class="rwth-output-head">
        <span class="rwth-field-label">${label}</span>
        <button class="rwth-btn-sm" type="button" data-action="copy-output"
                data-copy-target="${id}">Copy</button>
      </div>
      ${body}
    </div>`;
  }

  function buildAdvertiseTab(mem) {
    const A = (mem && mem.advertise) || {};
    const L = (mem && mem.ledger) || {};
    const settings = (mem && mem.settings) || {};
    const items = L.items || [];
    const listed = items.filter(i => i.status === 'listed');
    const sel = A.selectedIds;
    const isChecked = (it) => (sel == null ? true : sel.includes(it.id));
    // Stamp each selected item with its resolved category so the output
    // generators can group without re-querying the item dictionary.
    const cats = ItemDict.categories();
    const selectedItems = listed.filter(isChecked)
      .map(it => ({ ...it, category: itemCategory(it, cats) }));
    const transactions = A.transactions || [];

    const fold = (mem && mem.ui && mem.ui.collapsed) || {};
    const itemRows = listed.length
      ? listed.map(i => buildAdvItemRow(i, isChecked(i), A.imgEditId === i.id)).join('')
      : `<div class="rwth-placeholder">No listed items yet.</div>`;
    const txRows = transactions.length
      ? transactions.map(buildTxRow).join('')
      : `<div class="rwth-placeholder">No recent transactions yet.</div>`;

    return `<div class="rwth-advertise">
      <div class="rwth-adv-section">
        ${collapseHead(`Advertised items${listed.length ? ` (${listed.length})` : ''}`,
                       'advItems', fold.advItems)}
        ${fold.advItems ? '' : itemRows}
      </div>
      <div class="rwth-adv-section">
        <div class="rwth-form-title">Recent Transactions</div>
        ${txRows}
        <div class="rwth-form-actions">
          <button class="rwth-btn rwth-btn-add" type="button" data-action="add-tx">+ add transaction</button>
        </div>
      </div>
      <div class="rwth-adv-section">
        ${collapseHead('Outputs', 'advOutputs', fold.advOutputs)}
        ${fold.advOutputs ? '' : `
        ${buildOutputBox('Forum title', 'rwth-out-title',
                         AdvertiseGenerator.toForumTitle(), false)}
        ${buildOutputBox('Trade-chat blurb', 'rwth-out-chat',
                         AdvertiseGenerator.toChat(selectedItems, settings), true)}
        ${buildOutputBox('Forum post HTML', 'rwth-out-forum',
                         AdvertiseGenerator.toForumHtml(selectedItems, transactions, settings), true, 12)}
        ${buildOutputBox('Bazaar description HTML', 'rwth-out-bazaar',
                         AdvertiseGenerator.toBazaarHtml(settings), true, 10)}
        ${buildOutputBox('Profile signature HTML', 'rwth-out-signature',
                         AdvertiseGenerator.toSignatureHtml(selectedItems, settings), true, 8)}`}
      </div>
    </div>`;
  }

  function buildContent(mem) {
    switch (mem.ui.activeTab) {
      case 'ledger':    return buildLedgerTab(mem);
      case 'advertise': return buildAdvertiseTab(mem);
      case 'settings':  return buildSettingsTab(mem);
      default:          return '';
    }
  }

  // ─── render — the only impure dispatcher ─────────────────────────────────────
  const TABS = [
    { id: 'ledger',    label: 'Ledger' },
    { id: 'advertise', label: 'Advertise' },
    { id: 'settings',  label: 'Settings' },
  ];

  function buildShell() {
    injectStyles();

    const root = document.createElement('div');
    root.id = 'rwth-root';
    root.innerHTML = `
      <div id="rwth-panel" role="dialog" aria-label="RW Trading Hub">
        <header id="rwth-header">
          <div id="rwth-brand">
            <span id="rwth-title">RW Trading Hub</span>
            <span id="rwth-version">v${SCRIPT_VERSION}</span>
          </div>
          <div id="rwth-header-actions">
            <button id="rwth-max" data-action="maximize" aria-label="Toggle full screen" title="Toggle full screen">⛶</button>
            <button id="rwth-close" data-action="close" aria-label="Close" title="Close">×</button>
          </div>
        </header>
        <nav id="rwth-tabs">
          ${TABS.map(t => `<button class="rwth-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
        </nav>
        <div id="rwth-content"></div>
      </div>`;
    document.body.appendChild(root);

    // Delegated listeners — wired once.
    root.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        setState({ ui: { ...MEM.ui, activeTab: tabBtn.dataset.tab } });
        return;
      }
      const rowToggle = e.target.closest('[data-row-toggle]');
      if (rowToggle) {
        const id = rowToggle.dataset.rowToggle;
        const nextExpanded = MEM.ledger.expandedId === id ? null : id;
        const nextPriceCheck = nextExpanded === MEM.ledger.priceCheckId
          ? MEM.ledger.priceCheckId : null;
        setState({ ledger: { ...MEM.ledger, expandedId: nextExpanded, priceCheckId: nextPriceCheck } });
        return;
      }
      const filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        setState({ ledger: { ...MEM.ledger, statusFilter: filterBtn.dataset.filter } });
        return;
      }
      const advCheck = e.target.matches && e.target.matches('[data-adv-check]')
        ? e.target : null;
      if (advCheck) {
        const row = advCheck.closest('[data-adv-item]');
        if (row) toggleAdvItem(row.dataset.advItem);
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const id = actionEl.dataset.id;
      switch (actionEl.dataset.action) {
        case 'close':         setState({ ui: { ...MEM.ui, open: false } }); break;
        case 'maximize':      setState({ ui: { ...MEM.ui, maximized: !MEM.ui.maximized } }); break;
        case 'save-settings': saveSettings(); break;
        case 'smoke-weav3r':  smokeWeav3r(); break;
        case 'add-item':      setState({ ledger: { ...MEM.ledger, editingId: 'new' } }); break;
        case 'edit-item':     setState({ ledger: { ...MEM.ledger, editingId: id, expandedId: id } }); break;
        case 'cancel-item':   setState({ ledger: { ...MEM.ledger, editingId: null } }); break;
        case 'save-item':     saveLedgerItem(); break;
        case 'scan':          LogScanner.scan(); break;
        case 'confirm-scan':  confirmScan(); break;
        case 'cancel-scan':   Store.set('rwth_scan', []);
                              setState({ ledger: { ...MEM.ledger, scanResults: [], scanMessage: '' } }); break;
        case 'parse-sells':   parseSells(); break;
        case 'commit-sells':  commitSells(); break;
        case 'cancel-sells':  setState({ ledger: { ...MEM.ledger, sellPreview: null, sellMessage: '' } }); break;
        case 'mark-listed':   Ledger.markListed(id); break;
        case 'price-check':   togglePriceCheck(id); break;
        case 'delete-item':   if (confirm('Delete this ledger item?')) Ledger.remove(id); break;
        case 'add-tx':        addTransaction(); break;
        case 'remove-tx':     removeTransaction(id); break;
        case 'promote-tx':    promoteTransaction(id); break;
        case 'copy-output':   copyOutput(actionEl.dataset.copyTarget); break;
        case 'toggle-img':    setState({ advertise: { ...MEM.advertise,
                                imgEditId: MEM.advertise.imgEditId === id ? null : id } }); break;
        case 'close-img':     setState({ advertise: { ...MEM.advertise, imgEditId: null } }); break;
        case 'toggle-collapse':     toggleCollapse(actionEl.dataset.collapse); break;
      }
    });

    // Scan-checklist edits → write straight back into MEM.ledger.scanResults and
    // persist. No render() call: the DOM already shows the value, and the hit is
    // now the source of truth, so a close/reopen or reload rebuilds it intact.
    root.addEventListener('input', (e) => { syncScanEdit(e); syncAdvertiseEdit(e); });
    root.addEventListener('change', (e) => { syncScanEdit(e); syncAdvertiseEdit(e); });
  }

  // Advertise-tab inline edits → write straight back into state and persist,
  // mirroring syncScanEdit. Recent Transactions write to rwth_transactions;
  // list-price / image-URL write onto the ledger row (rwth_ledger). A list-price
  // change re-renders on `change` so the chat blurb output picks up the new price.
  function syncAdvertiseEdit(e) {
    const txRow = e.target.closest && e.target.closest('[data-tx-row]');
    if (txRow) {
      const tx = (MEM.advertise.transactions || []).find(t => t.id === txRow.dataset.txRow);
      if (!tx) return;
      const val = (name) => {
        const el = txRow.querySelector(`[data-tx-field="${name}"]`);
        return el ? el.value.trim() : '';
      };
      tx.itemName = val('itemName');
      tx.bonusName = val('bonusName') || null;
      tx.buyer = val('buyer');
      tx.price = numOrNull(val('price'));
      Store.set('rwth_transactions', MEM.advertise.transactions);
      return;
    }
    const advRow = e.target.closest && e.target.closest('[data-adv-item]');
    if (advRow) {
      const item = (MEM.ledger.items || []).find(i => i.id === advRow.dataset.advItem);
      if (!item) return;
      const lp = advRow.querySelector('[data-adv-field="listPrice"]');
      const gz = advRow.querySelector('[data-adv-field="gyazoUrl"]');
      if (lp) item.listPrice = numOrNull(lp.value);
      if (gz) item.gyazoUrl = gz.value.trim() || null;
      Store.set('rwth_ledger', MEM.ledger.items);
      if (e.type === 'change') render();
    }
  }

  function syncScanEdit(e) {
    const row = e.target.closest('[data-scan-row]');
    if (!row) return;
    const hit = (MEM.ledger.scanResults || []).find(h => h.key === row.dataset.scanRow);
    if (!hit) return;
    const val = (name) => {
      const el = row.querySelector(`[data-scan-field="${name}"]`);
      return el ? el.value.trim() : '';
    };
    const bonuses = [];
    for (const n of ['1', '2']) {
      const name = val('bonus' + n + 'Name');
      if (name) bonuses.push({ name, value: numOrNull(val('bonus' + n + 'Value')) });
    }
    const check = row.querySelector('[data-scan-check]');
    hit.itemName = val('itemName');
    hit.category = val('category') || 'Primary';
    hit.type = hit.category === 'Armor' ? 'armor' : 'weapon';
    hit.bonuses = bonuses;
    hit.quality = numOrNull(val('quality'));
    if (check) hit.checked = check.checked;
    Store.set('rwth_scan', MEM.ledger.scanResults);
  }

  // Collect every settings input from the DOM, persist, re-render, then flash
  // a confirmation. Reading on click (not on each keystroke) means render()
  // never fires mid-typing.
  function saveSettings() {
    const next = { ...MEM.settings };
    document.querySelectorAll('#rwth-content [data-setting]').forEach((input) => {
      next[input.dataset.setting] = input.value;
    });
    Store.set('rwth_settings', next);

    // Collect intel settings.
    const nextIntel = {
      enabled:  { ...MEM.intel.enabled },
      defaults: { ...MEM.intel.defaults },
      mugBuffer:    MEM.intel.mugBuffer,
      marginTarget: MEM.intel.marginTarget,
      markup:       MEM.intel.markup,
      qualityClampDefault: MEM.intel.qualityClampDefault,
      excludedBonuses: (MEM.intel.excludedBonuses || []).slice(),
      bonusChangeDates: { ...(MEM.intel.bonusChangeDates || {}) },
      similarBases: (MEM.intel.similarBases || []).map(c => (c || []).slice()),
    };
    document.querySelectorAll('#rwth-content [data-intel]').forEach((el) => {
      const path = el.dataset.intel;
      const val  = el.type === 'checkbox' ? el.checked : el.value;
      if (path === 'enabled.auction')           nextIntel.enabled.auction  = Boolean(val);
      else if (path === 'enabled.ledger')       nextIntel.enabled.ledger   = Boolean(val);
      else if (path === 'defaults.ignoreQuality') nextIntel.defaults.ignoreQuality = Boolean(val);
      else if (path === 'qualityClampDefault') nextIntel.qualityClampDefault = Boolean(val);
      else if (path === 'mugBuffer')    nextIntel.mugBuffer    = Number(val) || 0;
      else if (path === 'marginTarget') nextIntel.marginTarget = Number(val) || 0;
      else if (path === 'markup')       nextIntel.markup       = Number(val) || 1;
    });

    // Trash list — hard "don't fetch" filter.
    const trashEl = document.getElementById('rwth-intel-trash');
    if (trashEl) nextIntel.excludedBonuses = parseTrashList(trashEl.value);

    // v0.3.0 slice 19a (#285) — bonus-mechanic change dates editor.
    const bcdEl = document.getElementById('rwth-intel-bonus-change-dates');
    if (bcdEl) nextIntel.bonusChangeDates = parseBonusChangeDates(bcdEl.value, BONUS_CHANGE_DATES_SEED);

    // v0.3.0 slice 19d (#288) — similar-base clusters editor.
    const sbEl = document.getElementById('rwth-intel-similar-bases');
    if (sbEl) nextIntel.similarBases = parseSimilarBases(sbEl.value, SIMILAR_BASES_SEED);

    Store.set('rwth_intel_settings', nextIntel);
    setState({ settings: next, intel: nextIntel });
    AuctionScanner.refresh();

    const status = document.getElementById('rwth-settings-status');
    if (!status) return;
    status.textContent = '✓ Saved';
    status.classList.add('rwth-saved-show');
    setTimeout(() => {
      const el = document.getElementById('rwth-settings-status');
      if (el) { el.textContent = ''; el.classList.remove('rwth-saved-show'); }
    }, 2200);
  }

  // Flip one section's fold state and persist it so it survives a reload.
  function toggleCollapse(key) {
    const cur = MEM.ui.collapsed || {};
    const collapsed = { ...cur, [key]: !cur[key] };
    Store.set('rwth_collapsed', collapsed);
    setState({ ui: { ...MEM.ui, collapsed } });
  }

  // ─── Ledger — item CRUD (impure; routed through setState) ────────────────────
  function makeId() {
    if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function numOrNull(s) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  const Ledger = {
    add(patch) {
      const item = {
        id: makeId(),
        itemId: null,
        itemName: patch.itemName,
        type: patch.type || 'weapon',
        category: patch.category || null,
        bonuses: patch.bonuses || [],
        quality: patch.quality != null ? patch.quality : null,
        rarity: patch.rarity || null,
        buyPrice: patch.buyPrice || 0,
        buyTimestamp: patch.buyTimestamp || Date.now(),
        buySource: patch.buySource || 'market',
        listPrice: null,
        gyazoUrl: null,
        status: 'held',
        saleGross: null, saleFees: null, saleNet: null,
        soldTimestamp: null, soldVenue: null, buyer: null,
      };
      const items = [item, ...MEM.ledger.items];
      Store.set('rwth_ledger', items);
      setState({ ledger: { ...MEM.ledger, items, editingId: null } });
    },
    update(id, patch) {
      const items = MEM.ledger.items.map(i => (i.id === id ? { ...i, ...patch } : i));
      Store.set('rwth_ledger', items);
      setState({ ledger: { ...MEM.ledger, items, editingId: null } });
    },
    remove(id) {
      const items = MEM.ledger.items.filter(i => i.id !== id);
      Store.set('rwth_ledger', items);
      const expandedId = MEM.ledger.expandedId === id ? null : MEM.ledger.expandedId;
      setState({ ledger: { ...MEM.ledger, items, expandedId } });
    },
    markListed(id) { Ledger.update(id, { status: 'listed' }); },
  };

  // ─── VelocityTracker — buy→sold days-to-clear log + per-class baseline ───────
  // v0.3.0 slice 10a (#275). One append-only entry per closed ledger sale,
  // persisted to rwth_velocity_log. classBaseline() returns the median
  // days-to-clear for a class, null until VELOCITY_MIN_SAMPLES entries exist.
  // Reads are fail-safe — a missing or corrupt log degrades to "no baseline",
  // never throwing into render(). Anchor is buy→sold (not list→sold): the user
  // constantly lists/de-lists to protect funds, so a list timestamp would be
  // noise. Buckets coarsely by rarity × kind (e.g. 'yellow-weapon',
  // 'orange-armor') so the record side (a ledger row) and the lookup side (a
  // live card ctx) always land in the same bucket — coarser than the pricing
  // itemClass (no dune/riot split) on purpose, since velocity is a soft
  // heuristic, not a pricing input.
  const VELOCITY_MIN_SAMPLES = 3;
  const VELOCITY_KEY = 'rwth_velocity_log';

  // Pure: coarse velocity bucket from rarity + armour-ness, or null when rarity
  // is unknown (untracked). Identical inputs on the record and lookup sides.
  function velocityClass(rarity, isArmor) {
    const r = norm(rarity);
    if (!r) return null;
    return `${r}-${isArmor ? 'armor' : 'weapon'}`;
  }

  // Pure: median days-to-clear for one bucket from a raw log array, or null when
  // fewer than VELOCITY_MIN_SAMPLES matching entries exist.
  function velocityBaseline(log, cls) {
    if (!cls || !Array.isArray(log)) return null;
    const days = log
      .filter(e => e && e.cls === cls && Number.isFinite(e.days))
      .map(e => e.days);
    if (days.length < VELOCITY_MIN_SAMPLES) return null;
    return _median(days);
  }

  const VelocityTracker = {
    _read() {
      const log = Store.get(VELOCITY_KEY);
      return Array.isArray(log) ? log : [];
    },
    // Append one closed sale's buy→sold duration. No-op when the row lacks a
    // usable rarity or a positive duration (missing/!finite/negative stamps).
    recordSale(item, boughtAt, soldAt) {
      if (!item) return;
      const cls = velocityClass(
        item.rarity, isArmorType(item.type) || norm(item.category) === 'armor');
      if (!cls) return;
      const b = Number(boughtAt), s = Number(soldAt);
      if (!Number.isFinite(b) || !Number.isFinite(s)) return;
      const days = (s - b) / 86_400_000;
      if (!Number.isFinite(days) || days < 0) return;
      const log = this._read();
      log.push({ cls, days, soldAt: s });
      Store.set(VELOCITY_KEY, log);
    },
    // Median days-to-clear for a coarse class bucket, null until enough samples.
    classBaseline(cls) {
      return velocityBaseline(this._read(), cls);
    },
  };

  // Per-row Price-check toggle. Closes if already open; otherwise opens with a
  // loading panel and kicks off the async fetch. Composite {history, live} comp
  // result is cached via the shared rwth_cache_ store (key: pricecheck:<sig>)
  // so a second click within the 5-minute TTL never hits the network.
  function togglePriceCheck(id) {
    if (!MEM.intel.enabled.ledger) return;
    if (MEM.ledger.priceCheckId === id) {
      setState({ ledger: { ...MEM.ledger, priceCheckId: null } });
      return;
    }
    const item = (MEM.ledger.items || []).find(i => i.id === id);
    if (!item) return;
    const results = { ...(MEM.ledger.priceCheckResults || {}) };
    results[id] = { loading: true };
    setState({ ledger: { ...MEM.ledger, priceCheckId: id, priceCheckResults: results } });
    void runPriceCheck(item);
  }

  async function runPriceCheck(item) {
    const intel = MEM.intel;
    // v0.3.0 slice 9 — BonusTrashGuard short-circuit before any fetch.
    const trashHit = (item.bonuses || []).find(
      b => b && BonusTrashGuard.isExcluded(b.name, intel.excludedBonuses));
    if (trashHit) {
      writePriceCheckResult(item.id, { skipped: 'trash', bonusName: trashHit.name });
      return;
    }
    // v3: ctx-shape result (BadgeRenderer v2). Prefix bump so pre-v0.3.7
    // cached pricecheck:v2 entries (verdict/suggest) are ignored.
    const cacheKey = 'pricecheck:v4:' + JSON.stringify({
      n: item.itemName, b: item.bonuses, q: item.quality, c: itemCategory(item),
      e: intel.enabled.ledger,
    });
    let composite = Cache.get(cacheKey);
    if (!composite) {
      try {
        composite = await PricingEngine.fetchComps(item, intel);
        Cache.set(cacheKey, composite);
      } catch {
        writePriceCheckResult(item.id, { error: 'fetch failed' });
        return;
      }
    }
    // Action math uses cleared sales only — asking is shown as a spread line.
    const comps        = (composite.cleared || []).map(compShape).filter(Boolean);
    const askingRawL   = composite.asking || [];
    const askingShaped = askingRawL.map(compShape).filter(Boolean);
    const askingComps  = askingShaped.map((c, i) => {
      const raw = askingRawL[i] || {};
      return {
        ...c,
        listingId: raw.listingId != null ? raw.listingId : null,
        sellerId:  raw.sellerId  != null ? raw.sellerId  : null,
        source: raw.source || 'market',
      };
    });
    const askingMedian = _median(askingShaped.map(c => c.price));
    const askingCount  = askingShaped.length;
    if (!comps.length) {
      writePriceCheckResult(item.id, { error: 'no comp', askingMedian, askingCount });
      return;
    }

    // Resolve item class from the cached items dict; fall back to ledger-row
    // metadata when the dict has not been fetched yet so the panel stays
    // actionable (the auction surface has a v0.2.x legacy fallback — the
    // ledger v0.2.x panel is gone, so we always emit a two-tier ctx).
    const dict = ItemClassifier.getDict();
    const cls  = dict ? ItemClassifier.classify(item.itemName, dict) : null;
    // Ledger rows carry the user-set form value `item.type` ('armor' | 'weapon')
    // which is a UI taxonomy. The 'armor' UI value happens to coincide with
    // one of Torn's real armor-type values, so it passes through unchanged;
    // the 'weapon' UI value translates to 'primary' as an arbitrary stand-in
    // among the three weapon types (RW pricing keys off rarity, not subtype).
    const type = (cls && cls.type)
      || (item.type === 'armor' ? 'armor' : 'primary');
    const rarity = (cls && cls.rarity) || item.rarity || null;
    const classTag = cls
      ? formatClassTag({ ...cls, rarity })
      : formatClassTag({ type, rarity });

    const bbRate = MEM.bbRate && MEM.bbRate.rate;
    const bbClassKey = isArmorType(type) ? 'armor' : (cls && cls.weaponBase) || null;
    const bbFloor = bbClassKey && rarity && bbRate
      ? BBEngine.calculateFloor(bbClassKey, rarity, bbRate,
          { bonusCount: (item.bonuses || []).length })
      : null;

    let itemClassKey = resolveItemClass(cls);
    if (!itemClassKey) {
      itemClassKey = isArmorType(type) ? 'assaultArmor' : 'yellowWeapon';
    }

    // Anchor fallback stays market-only — bazaar is excluded from anchor math
    // (PRD #296), so a cheap bazaar piece must not pull the fallback floor down.
    const marketAsking = askingComps.filter(c => (c.source || 'market') === 'market');
    const marketCheapest = marketAsking.length
      ? Math.min(...marketAsking.map(c => c.price)) : null;
    // Bazaar floor is display-only (#300) — a cross-check beside the market
    // floor, never fed into the anchor/tiering math above.
    const bazaarAsking = askingComps.filter(c => c.source === 'bazaar');
    const bazaarCheapest = bazaarAsking.length
      ? Math.min(...bazaarAsking.map(c => c.price)) : null;
    const primaryBonus = (item.bonuses || [])[0] || null;
    const targetBonusValue = primaryBonus ? Number(primaryBonus.value) : null;

    writePriceCheckResult(item.id, {
      ctx: {
        itemClass: itemClassKey,
        rarity,
        classTag,
        bbFloor,
        currentBid: null,
        buyCost: item.buyPrice || 0,
        listingQuality: item.quality,
        primaryBonusName: primaryBonus ? primaryBonus.name : null,
        primaryBonusValue: Number.isFinite(targetBonusValue) ? targetBonusValue : null,
        strictTolerance: 0,
        comps,
        askingComps,
        marketCheapest,
        bazaarCheapest,
        askingMedian,
        askingCount,
        widenedBase: Array.isArray(composite.widenedBase) ? composite.widenedBase.slice() : [],
        margins: null,
      },
    });
  }

  function writePriceCheckResult(id, patch) {
    // Honour intel-disable / panel-closed races — never resurrect a closed panel.
    if (!MEM.intel.enabled.ledger) return;
    if (MEM.ledger.priceCheckId !== id) return;
    const results = { ...(MEM.ledger.priceCheckResults || {}), [id]: patch };
    setState({ ledger: { ...MEM.ledger, priceCheckResults: results } });
  }

  // Collect the add/edit form from the DOM on Save — reading on click (not per
  // keystroke) keeps render() from firing mid-typing.
  function saveLedgerItem() {
    const get = (name) => {
      const el = document.querySelector(`#rwth-content [data-form="${name}"]`);
      return el ? el.value.trim() : '';
    };
    const itemName = get('itemName');
    if (!itemName) {
      const err = document.getElementById('rwth-form-error');
      if (err) err.textContent = 'Item name is required.';
      return;
    }
    const bonuses = [];
    for (const n of ['1', '2']) {
      const name = get('bonus' + n + 'Name');
      if (name) bonuses.push({ name, value: numOrNull(get('bonus' + n + 'Value')) });
    }
    const dateStr = get('buyDate');
    const category = get('category') || 'Primary';
    const patch = {
      itemName,
      category,
      type: category === 'Armor' ? 'armor' : 'weapon',
      bonuses,
      quality: numOrNull(get('quality')),
      rarity: get('rarity') || null,
      buyPrice: numOrNull(get('buyPrice')) || 0,
      buyTimestamp: dateStr ? Date.parse(dateStr) : Date.now(),
      buySource: get('buySource') || 'market',
    };
    if (MEM.ledger.editingId === 'new') Ledger.add(patch);
    else Ledger.update(MEM.ledger.editingId, patch);
  }

  // ─── ItemDict — item id → name, fetched once and cached a week ───────────────
  // The auction-win log identifies items by numeric id only; this resolves the
  // names. A fetch failure is non-fatal — names just degrade to "Item #id".
  const ItemDict = {
    async ensure(key) {
      const WEEK = 7 * 24 * 3600 * 1000;
      const cached = Store.get('rwth_items');
      // `cats` must be present too — caches from before the category index was
      // added are treated as stale so the dictionary is re-fetched once.
      if (cached && cached.map && cached.cats && cached.ts
          && Date.now() - cached.ts < WEEK) {
        return cached.map;
      }
      const res = await fetch(`${API_BASE}/v2/torn/items?key=${encodeURIComponent(key)}`);
      const d = await res.json();
      if (d && d.error) throw new Error(`${d.error.error} (code ${d.error.code})`);
      const map = {};
      const cats = {};
      const record = (id, name, type) => {
        if (id == null || !name) return;
        map[id] = name;
        const c = normCategory(type);
        if (c) cats[String(name).toLowerCase()] = c;
      };
      const items = d && d.items;
      if (Array.isArray(items)) {
        for (const it of items) if (it) record(it.id, it.name, it.type);
      } else if (items && typeof items === 'object') {
        for (const id of Object.keys(items)) {
          const it = items[id];
          if (it) record(id, it.name, it.type);
        }
      }
      Store.set('rwth_items', { ts: Date.now(), map, cats });
      return map;
    },
    // Sync name→category index from the cached dictionary; {} until first scan.
    categories() {
      const c = Store.get('rwth_items');
      return (c && c.cats) || {};
    },
  };

  // ─── ItemClassifier — name → { rarity, category, armorSet, weaponBase, isTrash, isBBFloorEligible }
  // Pure `classify` reads a pre-fetched items dictionary (Torn `/v2/torn/items`),
  // mapped by item name. Impure `fetchItemsDict` fetches once per 24h to
  // `rwth_items_dict`. The classifier routes BB-floor eligibility for armor sets
  // (Riot/Dune) and curated trash weapons; everything else is informational.
  const ARMOR_SETS = ['Riot', 'Dune', 'Assault', 'Impregnable', 'EOD'];
  const ITEMS_DICT_TTL_MS = 24 * 60 * 60 * 1000;

  // Maps Torn's weapon_class / sub_type strings to the keys BBEngine.MULTIPLIERS uses.
  function normWeaponBase(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return null;
    if (s === 'pistol' || s === 'pistols') return 'pistol';
    if (s === 'sub-machine gun' || s === 'smg' || s === 'sub machine gun') return 'smg';
    if (s === 'shotgun' || s === 'shotguns') return 'shotgun';
    if (s === 'rifle' || s === 'rifles') return 'rifle';
    if (s === 'machine gun' || s === 'machine guns') return 'machine gun';
    if (s === 'heavy artillery' || s === 'heavy artillery weapon') return 'heavy artillery';
    if (s === 'clubbing' || s === 'club') return 'club';
    if (s === 'piercing') return 'piercing';
    if (s === 'slashing') return 'slashing';
    return s;
  }

  // Torn's `/v2/torn/items` `type` field. We mirror these verbatim — never
  // collapse into a synthetic umbrella like "weapon" or "armor". Torn has
  // returned both `'Armor'` and `'Defensive'` for body armor across endpoints
  // and revisions; we accept either and preserve whichever came back. The
  // three weapon types are routing-equivalent for our pricing surfaces
  // (RW pricing keys off rarity, not weapon type).
  const WEAPON_TYPES = ['primary', 'secondary', 'melee'];
  const ARMOR_TYPES  = ['armor', 'defensive'];
  function isWeaponType(type) { return WEAPON_TYPES.indexOf(type) !== -1; }
  function isArmorType(type)  { return ARMOR_TYPES.indexOf(type)  !== -1; }

  const ItemClassifier = {
    ARMOR_SETS,
    WEAPON_TYPES,
    ARMOR_TYPES,
    isWeaponType,
    isArmorType,
    classify(itemName, itemsDict, opts) {
      const name = String(itemName || '').trim();
      const dict = itemsDict || {};
      const meta = dict[name] || dict[name.toLowerCase()] || null;
      const rarity = meta && meta.rarity
        ? String(meta.rarity).toLowerCase() : null;
      const typeRaw = meta ? String(meta.type || '').toLowerCase() : '';
      const type = (isArmorType(typeRaw) || isWeaponType(typeRaw))
        ? typeRaw : null;

      let armorSet = null;
      if (isArmorType(type)) {
        for (const s of ARMOR_SETS) {
          if (name === s || name.startsWith(s + ' ')) { armorSet = s; break; }
        }
      }

      let weaponBase = null;
      if (isWeaponType(type)) {
        const raw = meta && (meta.weapon_class || meta.sub_type || meta.subType);
        weaponBase = normWeaponBase(raw);
      }

      const trashSet = opts && opts.trashSet;
      const isTrash = isWeaponType(type) && !!(trashSet && (
        (trashSet.has && trashSet.has(name)) ||
        (Array.isArray(trashSet) && trashSet.indexOf(name) !== -1)
      ));

      const isBBFloorEligible =
        (isArmorType(type) && (armorSet === 'Riot' || armorSet === 'Dune'))
        || isTrash;

      return { rarity, type, armorSet, weaponBase, isTrash, isBBFloorEligible };
    },
    // Sync read of the cached dict — null until fetchItemsDict has populated it.
    getDict() {
      const c = Store.get('rwth_items_dict');
      if (!c || !c.byName) return null;
      return c.byName;
    },
    async fetchItemsDict(opts) {
      const force = !!(opts && opts.force);
      const cached = Store.get('rwth_items_dict');
      if (!force && cached && cached.ts && cached.byName
          && Date.now() - cached.ts < ITEMS_DICT_TTL_MS) {
        return cached.byName;
      }
      const key = (MEM.settings && MEM.settings.apiKey || '').trim();
      if (!key || /^#+PDA-APIKEY#+$/.test(key)) return null;
      const res = await fetch(`${API_BASE}/v2/torn/items?key=${encodeURIComponent(key)}`);
      const d = await res.json();
      if (d && d.error) throw new Error(`${d.error.error} (code ${d.error.code})`);
      const byName = {};
      const record = (it) => {
        if (!it || !it.name) return;
        byName[it.name] = {
          id: it.id,
          name: it.name,
          type: it.type || null,
          sub_type: it.sub_type || null,
          weapon_class: it.weapon_class || null,
          rarity: it.rarity || null,
        };
      };
      const items = d && d.items;
      if (Array.isArray(items)) items.forEach(record);
      else if (items && typeof items === 'object') {
        for (const id of Object.keys(items)) record(items[id]);
      }
      Store.set('rwth_items_dict', { ts: Date.now(), byName });
      return byName;
    },
  };

  // resolveItemClass(cls) — collapse a classify() result into a PricingEngine
  // routing key. Returns null when the result isn't actionable (unknown rarity
  // or off-axis type). Trash overrides rarity since trashBB hard-floors.
  // Routes on Torn's real `type` field (defensive | primary | secondary | melee),
  // not a synthetic umbrella — see ItemClassifier comment above.
  function resolveItemClass(cls) {
    if (!cls) return null;
    if (cls.isTrash) return 'trashBB';
    if (isArmorType(cls.type)) {
      if (cls.armorSet === 'Riot' || cls.armorSet === 'Dune') return 'duneRiotArmor';
      if (cls.armorSet === 'Assault') return 'assaultArmor';
      if (cls.rarity === 'orange') return 'orangeArmor';
      if (cls.rarity === 'red')    return 'redArmor';
      if (cls.rarity === 'yellow') return 'assaultArmor';
      return null;
    }
    if (isWeaponType(cls.type)) {
      if (cls.rarity === 'yellow') return 'yellowWeapon';
      if (cls.rarity === 'orange') return 'orangeWeapon';
      if (cls.rarity === 'red')    return 'redWeapon';
      return null;
    }
    return null;
  }

  // Pretty short-form class tag for the inline badge: `[Riot · yellow]` for
  // recognised armor sets, `[Yellow weapon]` for plain weapons, `[trash · yellow]`
  // when the curated trash flag is set. Empty when nothing classifies.
  function formatClassTag(cls) {
    if (!cls) return '';
    const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
    if (isArmorType(cls.type)) {
      const parts = [cls.armorSet, cls.rarity].filter(Boolean);
      return parts.length ? `[${parts.join(' · ')}]` : '';
    }
    if (isWeaponType(cls.type)) {
      if (cls.isTrash) return `[trash${cls.rarity ? ' · ' + cls.rarity : ''}]`;
      return cls.rarity ? `[${cap(cls.rarity)} weapon]` : '[weapon]';
    }
    return '';
  }

  // ─── ItemDetails — uid → real stats/bonuses/rarity for one won item ──────────
  // The auction-win log carries the won item's unique id (data.item[0].uid).
  // /v2/torn/{uid}/itemdetails resolves that exact instance: quality, every
  // bonus, rarity. A failure is non-fatal — the checklist row stays editable.
  const ItemDetails = {
    async fetch(uid, key) {
      const res = await fetch(
        `${API_BASE}/v2/torn/${encodeURIComponent(uid)}/itemdetails?key=${encodeURIComponent(key)}`);
      const d = await res.json();
      if (d && d.error) throw new Error(`${d.error.error} (code ${d.error.code})`);
      return (d && d.itemdetails) || null;
    },
  };

  // Pure: fold an itemdetails payload onto a ScanHit. Torn bonus objects carry
  // `title`; the ledger stores `name`. Type comes back capitalised ("Weapon").
  function applyItemDetails(hit, details) {
    if (!details) return hit;
    const bonuses = Array.isArray(details.bonuses)
      ? details.bonuses.map(b => ({
          name: b && b.title != null ? String(b.title) : '',
          value: b && b.value != null ? Number(b.value) : null,
        })).filter(b => b.name)
      : hit.bonuses;
    const stats = details.stats || {};
    return {
      ...hit,
      itemName: details.name || hit.itemName,
      type: /armor/i.test(details.type || '') ? 'armor' : 'weapon',
      bonuses,
      quality: stats.quality != null ? Number(stats.quality) : hit.quality,
      rarity: details.rarity || hit.rarity,
    };
  }

  // ─── LogScanner — auction-win detection (manual trigger only) ────────────────
  // scan() queries the auction-win log category incrementally via rwth_log_cursor
  // and produces a ScanHit[] of wins not already in rwth_seen_wins. No poll, no
  // scan-on-open — the Ledger Scan button is the only caller.
  const LogScanner = {
    async scan() {
      if (MEM.ledger.scanning) return;
      const key = (MEM.settings.apiKey || '').trim();
      if (!key) {
        setState({ fetchError: 'Set your Torn API key in Settings before scanning.' });
        return;
      }
      setState({ fetchError: null, ledger: { ...MEM.ledger, scanning: true, scanMessage: '' } });

      const url = `${API_BASE}/v2/user/log?log=${LOG_TYPE_AUCTION_WIN}`
                + `&key=${encodeURIComponent(key)}`;

      let d;
      try {
        const res = await fetch(url);
        d = await res.json();
      } catch {
        setState({ fetchError: 'Network error while scanning the auction log.',
                   ledger: { ...MEM.ledger, scanning: false } });
        return;
      }
      if (d && d.error) {
        setState({ fetchError: `Torn API error: ${d.error.error} (code ${d.error.code}).`,
                   ledger: { ...MEM.ledger, scanning: false } });
        return;
      }

      // Resolve item names; a failure here only degrades names to "Item #id".
      let itemNames = {};
      try { itemNames = await ItemDict.ensure(key); } catch { /* non-fatal */ }

      const log = (d && d.log) || [];
      const seen = Store.get('rwth_seen_wins') || [];
      const hits = toScanHits(log, seen, itemNames);

      // Auto-fill each win from itemdetails (uid → real stats/bonuses/rarity).
      // A per-item failure just leaves that row's fields as the user can edit.
      const enriched = await Promise.all(hits.map(async (h) => {
        if (h.uid == null) return h;
        try { return applyItemDetails(h, await ItemDetails.fetch(h.uid, key)); }
        catch { return h; }
      }));

      Store.set('rwth_scan', enriched);
      setState({
        fetchError: null,
        ledger: {
          ...MEM.ledger, scanning: false, scanResults: enriched, lastScan: Date.now(),
          scanMessage: enriched.length ? '' : 'No new auction wins found.',
        },
      });
    },
  };

  // Commit the scan checklist: checked wins become held ledger rows; every shown
  // win (added or not) is written to rwth_seen_wins so it cannot reappear. Hits
  // are read straight from state — the input listener keeps them synced with the
  // DOM, so no live querying of the (about-to-be-torn-down) checklist is needed.
  function confirmScan() {
    const results = MEM.ledger.scanResults || [];
    if (!results.length) return;

    const newItems = [];
    for (const hit of results) {
      if (hit.checked === false) continue;
      newItems.push({
        id: makeId(),
        itemId: hit.itemId != null ? hit.itemId : null,
        itemName: hit.itemName || `Item #${hit.itemId}`,
        type: hit.type || 'weapon',
        category: hit.category || null,
        bonuses: (hit.bonuses || []).filter(b => b && b.name),
        quality: hit.quality != null ? hit.quality : null,
        rarity: hit.rarity || null,
        buyPrice: hit.buyPrice || 0,
        buyTimestamp: hit.buyTimestamp || Date.now(),
        buySource: 'auction',
        listPrice: null,
        gyazoUrl: null,
        status: 'held',
        saleGross: null, saleFees: null, saleNet: null,
        soldTimestamp: null, soldVenue: null, buyer: null,
      });
    }

    const items = [...newItems, ...MEM.ledger.items];
    Store.set('rwth_ledger', items);

    const seen = new Set(Store.get('rwth_seen_wins') || []);
    for (const hit of results) seen.add(hit.key);
    Store.set('rwth_seen_wins', [...seen]);
    Store.set('rwth_scan', []);

    setState({ ledger: { ...MEM.ledger, items, scanResults: [], scanMessage: '' } });
  }

  // Parse the Log-a-sale textarea, match each sell to an open ledger row, and
  // stage a confirmation preview. Reading on click (not per keystroke) keeps
  // render() from firing mid-typing. Nothing mutates the ledger here.
  function parseSells() {
    const ta = document.querySelector('#rwth-content [data-sell-input]');
    const text = ta ? ta.value : '';
    const sells = SellParser.parse(text);
    if (!sells.length) {
      setState({ ledger: { ...MEM.ledger, sellMessage: 'No sell lines found in the pasted text.' } });
      return;
    }
    const open = MEM.ledger.items.filter(i => i.status === 'held' || i.status === 'listed');
    const rows = sells.map((sell) => {
      const match = matchSell(sell, open);
      return { sell, matchedId: match ? match.id : null };
    });
    const s = summarizeSells(rows);
    const summaryText = `${s.parsed} sale${s.parsed === 1 ? '' : 's'} parsed, `
                      + `${s.matched} matched, ${s.recent} → Recent Transactions`;
    setState({ ledger: { ...MEM.ledger, sellPreview: { rows, summary: s, summaryText }, sellMessage: '' } });
  }

  // Commit the staged sells: matched sells close their ledger row to `sold`;
  // unmatched (historical) sells go straight into Recent Transactions and never
  // touch the ledger. One setState — the whole batch lands atomically.
  function commitSells() {
    const preview = MEM.ledger.sellPreview;
    if (!preview) return;
    let items = MEM.ledger.items;
    const newTx = [];
    for (const row of preview.rows) {
      const sell = row.sell;
      if (row.matchedId) {
        const soldAt = sell.timestamp || Date.now();
        // Slice 10a (#275) — log buy→sold days-to-clear before the row closes.
        const sold = items.find(i => i.id === row.matchedId);
        if (sold) VelocityTracker.recordSale(sold, sold.buyTimestamp, soldAt);
        items = items.map(i => (i.id === row.matchedId ? {
          ...i, status: 'sold',
          saleGross: sell.saleGross, saleFees: sell.saleFees, saleNet: sell.saleNet,
          soldTimestamp: soldAt,
          soldVenue: sell.venue, buyer: sell.buyer,
        } : i));
      } else {
        newTx.push({
          id: makeId(),
          itemName: sell.itemName,
          bonusName: sell.bonusName,
          buyer: sell.buyer,
          price: sell.saleNet,
          timestamp: sell.timestamp,
          origin: 'paste',
        });
      }
    }
    Store.set('rwth_ledger', items);
    const transactions = [...newTx, ...MEM.advertise.transactions];
    if (newTx.length) Store.set('rwth_transactions', transactions);
    setState({
      ledger: { ...MEM.ledger, items, sellPreview: null, sellMessage: '' },
      advertise: { ...MEM.advertise, transactions },
    });
  }

  // ─── Advertise — selection, transactions, copy (impure; via setState) ────────
  // Toggle one ledger item's checkbox selection. selectedIds starts null
  // ("default = all listed"); the first toggle materialises the current set.
  function toggleAdvItem(id) {
    const listedIds = MEM.ledger.items
      .filter(i => i.status === 'listed').map(i => i.id);
    const cur = MEM.advertise.selectedIds == null
      ? listedIds.slice() : MEM.advertise.selectedIds.slice();
    const idx = cur.indexOf(id);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(id);
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    setState({ advertise: { ...MEM.advertise, selectedIds: cur } });
  }

  function addTransaction() {
    const tx = {
      id: makeId(), itemName: '', bonusName: null, buyer: '',
      price: null, timestamp: null, origin: 'paste',
    };
    const transactions = [...MEM.advertise.transactions, tx];
    Store.set('rwth_transactions', transactions);
    setState({ advertise: { ...MEM.advertise, transactions } });
  }

  function removeTransaction(id) {
    const transactions = MEM.advertise.transactions.filter(t => t.id !== id);
    Store.set('rwth_transactions', transactions);
    setState({ advertise: { ...MEM.advertise, transactions } });
  }

  // One-click promote a sold ledger row into Recent Transactions; the buyer
  // name is carried over as verifiable proof.
  function promoteTransaction(id) {
    const item = MEM.ledger.items.find(i => i.id === id);
    if (!item) return;
    const tx = {
      id: makeId(),
      itemName: item.itemName,
      bonusName: (item.bonuses && item.bonuses[0] && item.bonuses[0].name) || null,
      buyer: item.buyer || '',
      price: item.saleNet,
      timestamp: item.soldTimestamp,
      origin: 'ledger',
    };
    const transactions = [tx, ...MEM.advertise.transactions];
    Store.set('rwth_transactions', transactions);
    setState({ advertise: { ...MEM.advertise, transactions } });
  }

  // Copy a windowed output box's live content to the clipboard, flashing the
  // button. Reads .value for the editable textarea, textContent for static divs.
  function copyOutput(id) {
    const el = id && document.getElementById(id);
    if (!el) return;
    const text = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
    const btn = document.querySelector(`[data-copy-target="${id}"]`);
    if (btn) {
      btn.textContent = '✓ Copied';
      setTimeout(() => {
        const b = document.querySelector(`[data-copy-target="${id}"]`);
        if (b) b.textContent = 'Copy';
      }, 1600);
    }
  }

  function render() {
    // Self-heal: rebuild the shell if Torn (or an SPA re-render) dropped it.
    if (!document.getElementById('rwth-root')) buildShell();

    // Never rewrite content while a form input inside the panel is focused.
    const focused = document.activeElement;
    if (focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)
        && document.getElementById('rwth-panel').contains(focused)) {
      return;
    }

    const panel = document.getElementById('rwth-panel');
    panel.classList.toggle('rwth-open', MEM.ui.open);
    panel.classList.toggle('rwth-max', MEM.ui.maximized);
    const launcher = document.getElementById('rwth-launcher');
    if (launcher) launcher.classList.toggle('rwth-launcher-open', MEM.ui.open);
    document.querySelectorAll('.rwth-tab').forEach(t => {
      t.classList.toggle('rwth-tab-active', t.dataset.tab === MEM.ui.activeTab);
    });
    document.getElementById('rwth-content').innerHTML = buildContent(MEM);
    mountLedgerPriceCheckCards();
  }

  // Ledger Price-check panels render an empty anchor (`.rwth-pc-anchor`) when
  // a two-tier ctx is ready; mount the shared BadgeRenderer v2 card into each
  // anchor after every render so the card survives unrelated setState calls.
  function mountLedgerPriceCheckCards() {
    const root = document.getElementById('rwth-content');
    if (!root) return;
    const anchors = root.querySelectorAll('.rwth-pc-anchor');
    if (!anchors.length) return;
    const results = (MEM.ledger && MEM.ledger.priceCheckResults) || {};
    anchors.forEach(anchor => {
      const id  = anchor.getAttribute('data-pc-id');
      const r   = results[id];
      const ctx = r && r.ctx;
      if (!ctx) return;
      InlineRenderer.renderTwoTierCard(anchor, ctx);
    });
  }

  // ─── Launcher ────────────────────────────────────────────────────────────────
  // Chat-header injection approach adapted from the Enhanced Chat Buttons script
  // (Callz [2188704] / Weav3r [1853324]): anchor to a known native chat-header
  // button and re-inject on every chat re-render — Torn rebuilds the chat DOM.
  const LAUNCHER_ANCHOR_SELECTORS = [
    '#people_panel_button',
    '#chatRoot [class*="chat-app-header"] button',
  ];

  function findLauncherAnchor() {
    for (const sel of LAUNCHER_ANCHOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function togglePanel() {
    setState({ ui: { ...MEM.ui, open: !MEM.ui.open } });
  }

  // Brand price-tag glyph; inherits the native icon's class so Torn sizes it.
  function makeLauncherIcon(anchor) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('xmlns', NS);
    svg.setAttribute('viewBox', '0 0 448 512');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    const refSvg = anchor && anchor.querySelector('svg');
    if (refSvg) svg.setAttribute('class', refSvg.getAttribute('class') || '');
    svg.innerHTML = `
      <defs>
        <linearGradient id="rwth-grad" x1="0.5" x2="0.5" y2="1">
          <stop offset="0" stop-color="#39ff14"/>
          <stop offset="1" stop-color="#00e5ff"/>
        </linearGradient>
        <linearGradient id="rwth-grad-flip" x1="0.5" x2="0.5" y2="1">
          <stop offset="0" stop-color="#00e5ff"/>
          <stop offset="1" stop-color="#39ff14"/>
        </linearGradient>
      </defs>
      <path d="M0 80L0 229.5c0 17 6.7 33.3 18.7 45.3l176 176c25 25 65.5 25 90.5 0L418.7 317.3c25-25 25-65.5 0-90.5l-176-176c-12-12-28.3-18.7-45.3-18.7L48 32C21.5 32 0 53.5 0 80zm112 32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/>`;
    return svg;
  }

  function makeLauncherButton() {
    const btn = document.createElement('button');
    btn.id = 'rwth-launcher';
    btn.type = 'button';
    btn.title = 'RW Trading Hub';
    btn.setAttribute('aria-label', 'Open RW Trading Hub');
    btn.classList.toggle('rwth-launcher-open', MEM.ui.open);
    btn.addEventListener('click', togglePanel);
    return btn;
  }

  // Insert the launcher next to a native chat-header button, cloning that
  // button's class so it renders as a native chat icon.
  function placeLauncherInChat() {
    if (document.getElementById('rwth-launcher')) return true;
    const anchor = findLauncherAnchor();
    if (!anchor) return false;
    const btn = makeLauncherButton();
    btn.className = anchor.className;
    btn.classList.add('rwth-launcher-chat');
    btn.appendChild(makeLauncherIcon(anchor));
    anchor.insertAdjacentElement('afterend', btn);
    return true;
  }

  function placeLauncherFixed() {
    if (document.getElementById('rwth-launcher')) return;
    const btn = makeLauncherButton();
    btn.classList.add('rwth-launcher-fixed');
    btn.textContent = BRAND.mark;
    document.body.appendChild(btn);
  }

  function startLauncher() {
    placeLauncherInChat();

    const chatRoot = document.querySelector('#chatRoot');
    if (chatRoot) {
      // Torn rebuilds the chat DOM on its own — re-inject whenever it does.
      new MutationObserver(() => placeLauncherInChat())
        .observe(chatRoot, { childList: true, subtree: true });
      // Anchor never appeared (Torn DOM change) — fall back to a corner button.
      setTimeout(() => {
        if (!document.getElementById('rwth-launcher')) placeLauncherFixed();
      }, 12000);
    } else {
      // No chat on this page/build (or PDA) — fixed bottom-right fallback.
      placeLauncherFixed();
    }
  }

  // ─── Styles ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('rwth-styles')) return;
    const style = document.createElement('style');
    style.id = 'rwth-styles';
    style.textContent = `
      #rwth-launcher.rwth-launcher-chat { cursor: pointer; }
      #rwth-launcher.rwth-launcher-chat svg { display: block; }
      #rwth-launcher.rwth-launcher-chat svg path { fill: url(#rwth-grad); }
      #rwth-launcher.rwth-launcher-chat:hover svg { filter: drop-shadow(0 0 3px #00e5ff); }
      #rwth-launcher.rwth-launcher-chat.rwth-launcher-open svg path { fill: url(#rwth-grad-flip); }
      #rwth-launcher.rwth-launcher-chat.rwth-launcher-open svg { filter: drop-shadow(0 0 3px #39ff14); }
      .rwth-launcher-fixed.rwth-launcher-open { color: #0a0a0a; background: #39ff14; }
      .rwth-launcher-fixed {
        position: fixed; bottom: 12px; right: 12px; z-index: 2147483646;
        font: 700 12px/1 Consolas, monospace; letter-spacing: 1px;
        color: #39ff14; background: #0a0a0a; border: 1px solid #00e5ff;
        border-radius: 6px; cursor: pointer; padding: 6px 9px;
      }
      .rwth-launcher-fixed:hover { box-shadow: 0 0 6px #00e5ff; }

      #rwth-panel {
        position: fixed;
        bottom: 56px;
        right: 12px;
        width: 360px;
        height: 480px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        background: #0a0a0a;
        color: #cfe;
        border: 1px solid #00e5ff;
        border-radius: 8px;
        font: 13px/1.4 Verdana, sans-serif;
        transform: scale(0);
        transform-origin: bottom right;
        opacity: 0;
        pointer-events: none;
        transition: transform .12s ease-out, opacity .12s ease-out;
      }
      #rwth-panel.rwth-open { transform: scale(1); opacity: 1; pointer-events: auto; }
      #rwth-panel.rwth-max {
        width: 100vw; height: 100vh;
        bottom: 0; right: 0;
        border-radius: 0;
      }

      #rwth-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 10px; border-bottom: 1px solid #00e5ff33;
      }
      #rwth-title { font: 700 13px Verdana, sans-serif; color: #39ff14; letter-spacing: .3px; }
      #rwth-version { font: 10px Consolas, monospace; color: #00e5ff; margin-left: 8px; }
      #rwth-header-actions { display: flex; align-items: center; gap: 6px; }
      #rwth-max, #rwth-close {
        background: none; border: none; color: #00e5ff;
        cursor: pointer; line-height: 1; padding: 0;
      }
      #rwth-close { font-size: 18px; }
      #rwth-max { font-size: 14px; }
      #rwth-max:hover, #rwth-close:hover { color: #39ff14; }

      #rwth-tabs { display: flex; border-bottom: 1px solid #00e5ff33; }
      .rwth-tab {
        flex: 1; padding: 7px 4px; cursor: pointer;
        background: none; border: none; border-bottom: 2px solid transparent;
        color: #8aa; font: 600 12px Verdana, sans-serif;
      }
      .rwth-tab-active { color: #39ff14; border-bottom-color: #39ff14; }

      #rwth-content { flex: 1; overflow-y: auto; padding: 12px; }
      .rwth-placeholder { color: #8aa; font-style: italic; }

      .rwth-settings { display: flex; flex-direction: column; gap: 12px; }
      .rwth-field { display: flex; flex-direction: column; gap: 4px; }
      .rwth-field-label {
        font: 600 11px Consolas, monospace; color: #00e5ff; letter-spacing: .3px;
      }
      .rwth-field-input {
        background: #111; color: #cfe; border: 1px solid #00e5ff44;
        border-radius: 4px; padding: 6px 8px;
        font: 12px Consolas, monospace; outline: none;
      }
      .rwth-field-input:focus { border-color: #39ff14; }
      .rwth-field-input::placeholder { color: #557; }

      .rwth-settings-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
      .rwth-btn {
        background: #39ff14; color: #0a0a0a; border: none; border-radius: 4px;
        padding: 7px 16px; cursor: pointer;
        font: 700 12px Verdana, sans-serif; letter-spacing: .3px;
      }
      .rwth-btn:hover { box-shadow: 0 0 6px #39ff14; }
      .rwth-settings-status {
        font: 700 11px Consolas, monospace; color: #39ff14;
        opacity: 0; transition: opacity .15s ease-out;
      }
      .rwth-settings-status.rwth-saved-show { opacity: 1; }
      .rwth-settings-divider { border: none; border-top: 1px solid #00e5ff22; margin: 8px 0; }
      .rwth-intel-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
      .rwth-intel-check { display: flex; align-items: center; gap: 6px; cursor: pointer;
        font: 12px Verdana, sans-serif; color: #cfe; }
      .rwth-intel-check input { accent-color: #39ff14; }
      .rwth-intel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
      .rwth-intel-empty { font: 11px Consolas, monospace; color: #8aa; margin: 4px 0; }
      .rwth-intel-bonus-row {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        border: 1px solid #00e5ff22; border-radius: 4px; padding: 6px 8px; margin-bottom: 4px;
      }
      .rwth-intel-bonus-name { font: 600 11px Consolas, monospace; color: #00e5ff; min-width: 80px; }
      .rwth-intel-bonus-field { display: flex; align-items: center; gap: 4px;
        font: 11px Verdana, sans-serif; color: #8aa; }
      .rwth-intel-bonus-field .rwth-field-input { width: 60px; }
      .rwth-intel-bonus-rm { padding: 2px 6px; font-size: 10px; }
      .rwth-intel-add-row {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;
      }
      .rwth-intel-add-row .rwth-field-input { width: auto; flex: 1; min-width: 120px; }
      #rwth-intel-add-tol { width: 70px; flex: none; }

      .rwth-ledger { display: flex; flex-direction: column; gap: 10px; }
      .rwth-ledger-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .rwth-ledger-actions { display: flex; align-items: center; gap: 6px; }
      .rwth-btn:disabled { opacity: .5; cursor: default; box-shadow: none; }
      .rwth-banner {
        border: 1px solid #ff5d5d66; border-radius: 4px;
        padding: 6px 8px; background: #ff5d5d11;
      }
      .rwth-scan {
        display: flex; flex-direction: column; gap: 10px;
        border: 1px solid #00e5ff33; border-radius: 6px; padding: 10px;
      }
      .rwth-scan-row {
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #00e5ff22; border-radius: 4px; padding: 8px;
      }
      .rwth-scan-check {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
      }
      .rwth-scan-check input { accent-color: #39ff14; }
      .rwth-scan-title { flex: 1; font: 600 12px Verdana, sans-serif; color: #cfe; }
      .rwth-scan-price { font: 600 11px Consolas, monospace; color: #cfe; }
      .rwth-scan-meta { font: 11px Consolas, monospace; color: #8aa; }
      .rwth-scan-note { font: 11px Consolas, monospace; color: #8aa; }
      .rwth-scan-note strong { color: #00e5ff; }
      .rwth-rarity {
        font: 700 9px Consolas, monospace; text-transform: uppercase;
        color: #0a0a0a; padding: 1px 5px; border-radius: 3px;
      }
      .rwth-rarity-white  { background: #d6d6d6; }
      .rwth-rarity-yellow { background: #ffd93b; }
      .rwth-rarity-orange { background: #ff9f1c; }
      .rwth-rarity-red    { background: #ff5d5d; }
      .rwth-filters { display: flex; gap: 4px; }
      .rwth-filter {
        background: none; border: 1px solid #00e5ff33; border-radius: 4px;
        color: #8aa; cursor: pointer; padding: 4px 8px;
        font: 600 10px Consolas, monospace; text-transform: uppercase; letter-spacing: .3px;
      }
      .rwth-filter:hover { color: #cfe; }
      .rwth-filter-active { color: #0a0a0a; background: #39ff14; border-color: #39ff14; }
      .rwth-btn-add { padding: 5px 12px; }

      .rwth-form {
        display: flex; flex-direction: column; gap: 10px;
        border: 1px solid #00e5ff33; border-radius: 6px; padding: 10px;
      }
      .rwth-form-title { font: 700 12px Verdana, sans-serif; color: #39ff14; }
      .rwth-collapse-head {
        display: flex; align-items: center; justify-content: space-between;
        width: 100%; background: none; border: 0; padding: 0; cursor: pointer;
        text-align: left;
      }
      .rwth-collapse-caret { font-size: 11px; color: #39ff14; line-height: 1; }
      .rwth-form-row { display: flex; gap: 8px; }
      .rwth-field-grow { flex: 1; }
      .rwth-field-sm { width: 76px; }
      .rwth-form-error { font: 600 11px Consolas, monospace; color: #ff5d5d; }
      .rwth-form-error:empty { display: none; }
      .rwth-form-actions { display: flex; gap: 8px; }
      .rwth-btn-ghost {
        background: none; color: #00e5ff; border: 1px solid #00e5ff44;
      }
      .rwth-btn-ghost:hover { box-shadow: none; color: #39ff14; border-color: #39ff14; }

      .rwth-rows { display: flex; flex-direction: column; gap: 4px; }
      .rwth-row { border: 1px solid #00e5ff22; border-radius: 4px; }
      .rwth-row-expanded { border-color: #00e5ff55; }
      .rwth-row-head {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
        padding: 7px 9px;
      }
      .rwth-row-head:hover { background: #00e5ff11; }
      .rwth-row-name { flex: 1; font: 600 12px Verdana, sans-serif; color: #cfe; }
      .rwth-row-bonus { font: 400 11px Consolas, monospace; color: #00e5ff; }
      .rwth-row-price { font: 600 11px Consolas, monospace; color: #cfe; }
      .rwth-status {
        font: 700 10px Consolas, monospace; text-transform: uppercase;
        padding: 2px 6px; border-radius: 3px;
      }
      .rwth-status-held   { color: #8aa; border: 1px solid #8aa66; }
      .rwth-status-listed { color: #00e5ff; border: 1px solid #00e5ff66; }
      .rwth-roi { font: 700 11px Consolas, monospace; }
      .rwth-roi-pos { color: #39ff14; }
      .rwth-roi-neg { color: #ff5d5d; }
      .rwth-row-detail {
        border-top: 1px solid #00e5ff22; padding: 8px 9px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .rwth-row-meta {
        display: flex; flex-wrap: wrap; gap: 4px 12px;
        font: 11px Consolas, monospace; color: #8aa;
      }
      .rwth-row-actions { display: flex; gap: 6px; }
      .rwth-btn-sm {
        background: none; border: 1px solid #00e5ff44; border-radius: 3px;
        color: #00e5ff; cursor: pointer; padding: 3px 8px;
        font: 600 10px Consolas, monospace;
      }
      .rwth-btn-sm:hover { color: #39ff14; border-color: #39ff14; }
      .rwth-btn-danger { color: #ff5d5d; border-color: #ff5d5d44; }
      .rwth-btn-danger:hover { color: #ff5d5d; border-color: #ff5d5d; }

      .rwth-sellbox {
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #00e5ff33; border-radius: 6px; padding: 10px;
      }
      .rwth-sell-input { resize: vertical; min-height: 60px; }
      .rwth-sell-summary { font: 600 11px Consolas, monospace; color: #00e5ff; }
      .rwth-sell-line {
        display: flex; align-items: center; gap: 8px;
        border: 1px solid #00e5ff22; border-radius: 4px; padding: 6px 8px;
      }
      .rwth-sell-matched { font: 700 10px Consolas, monospace; color: #39ff14; }
      .rwth-sell-recent  { font: 700 10px Consolas, monospace; color: #00e5ff; }

      .rwth-advertise { display: flex; flex-direction: column; gap: 14px; }
      .rwth-adv-section { display: flex; flex-direction: column; gap: 8px; }
      .rwth-adv-item {
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #00e5ff22; border-radius: 4px; padding: 8px;
      }
      .rwth-adv-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .rwth-adv-check input { accent-color: #39ff14; }
      .rwth-adv-img { position: relative; display: flex; align-items: flex-end; }
      .rwth-btn-on { color: #39ff14; border-color: #39ff14; }
      .rwth-img-pop {
        position: absolute; top: 100%; right: 0; z-index: 5; width: 230px;
        display: flex; flex-direction: column; gap: 6px; margin-top: 4px;
        background: #0c1422; border: 1px solid #00e5ff66; border-radius: 4px; padding: 8px;
        box-shadow: 0 4px 12px #000a;
      }
      .rwth-img-pop .rwth-btn-sm { align-self: flex-end; }
      .rwth-tx-row {
        display: flex; flex-direction: column; gap: 8px;
        border: 1px solid #00e5ff22; border-radius: 4px; padding: 8px;
      }
      .rwth-tx-actions { display: flex; justify-content: flex-end; }
      .rwth-output { display: flex; flex-direction: column; gap: 6px; }
      .rwth-output-head {
        display: flex; align-items: center; justify-content: space-between;
      }
      .rwth-output-box {
        background: #111; color: #cfe; border: 1px solid #00e5ff44;
        border-radius: 4px; padding: 8px;
        font: 12px Consolas, monospace; white-space: pre-wrap; word-break: break-word;
      }
      textarea.rwth-output-box { resize: vertical; outline: none; }
      textarea.rwth-output-box:focus { border-color: #39ff14; }

      @media (max-width: 480px) {
        #rwth-panel { width: calc(100vw - 24px); right: 12px; }
      }

      /* Inline auction verdict badge — background-filled so it reads on both
         Torn light and dark themes; tier colour drives bg + text + border. */
      .rwth-auction-badge {
        display: block; margin: 6px 0 0;
        padding: 6px 10px; border-radius: 4px;
        font: 600 11px Consolas, monospace; line-height: 1.4;
        background: #0a1420; color: #cfe;
        border: 1px solid #00e5ff44;
      }
      .rwth-tier-good    { background: #103a1d; color: #7ed098; border-color: #2c5e3b; }
      .rwth-tier-fair    { background: #102232; color: #5dc6f0; border-color: #2a4d70; }
      .rwth-tier-over    { background: #3a1414; color: #ff8a8a; border-color: #6e2a2a; }
      .rwth-tier-thin    { background: #2a2410; color: #e8c97e; border-color: #5a4a20; }
      .rwth-tier-none    { background: #1a1a1a; color: #8aa;    border-color: #444; }
      .rwth-tier-loading { background: #11251a; color: #8aa898; border-color: #2a4738;
                           font-style: italic; }

      /* v0.3.0 two-tier card — auction yellow-weapon path. Same anchor and
         base look as the v0.2.x verdict badge; adds a headline + ladder grid. */
      .rwth-card-headline {
        display: flex; flex-wrap: wrap; align-items: baseline;
        gap: 6px 12px; margin-bottom: 4px;
      }
      .rwth-card-buymax  { color: #7ed098; font-weight: 700; }
      .rwth-card-buymed  { color: #8aa; font-weight: 400; }
      .rwth-card-room    { color: #7ed098; }
      .rwth-card-over    { color: #ff8a8a; }
      .rwth-card-classtag { color: #5dc6f0; }
      .rwth-card-ladder {
        display: flex; flex-wrap: wrap; gap: 2px 10px;
        margin-top: 4px; padding-top: 4px;
        border-top: 1px dashed #00e5ff22;
        font-size: 10px;
      }
      .rwth-card-ladder b { color: #8aa; font-weight: 400; margin-right: 2px; }
      .rwth-card-bbfloor { color: #8aa; font-size: 10px; }
      .rwth-card-ref     { color: #8aa; font-size: 10px; }

      /* v0.3.0 slice 7 — drilldown panel */
      .rwth-card-drill-toggle {
        background: none; border: none; color: #5dc6f0;
        cursor: pointer; font: inherit; padding: 0; margin-left: auto;
      }
      .rwth-card-drill-toggle:hover { color: #8ad8f5; }
      .rwth-card-drill {
        margin-top: 6px; padding-top: 6px;
        border-top: 1px dashed #00e5ff44;
        font-size: 10px; color: #cfe;
      }
      .rwth-card-drill-knobs { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 6px; }
      .rwth-card-drill-knobs > div { display: flex; align-items: center; gap: 4px; }
      .rwth-card-drill-knobs label { color: #8aa; }
      .rwth-card-drill-knobs button {
        background: #0a1420; color: #cfe; border: 1px solid #00e5ff44;
        font: 10px Consolas, monospace; padding: 1px 6px; cursor: pointer;
        border-radius: 2px;
      }
      .rwth-card-drill-knobs button.active {
        background: #103a1d; color: #7ed098; border-color: #2c5e3b;
      }
      .rwth-card-drill-knobs button:disabled {
        opacity: 0.4; cursor: not-allowed;
      }
      .rwth-card-drill-math { color: #8aa; margin-bottom: 6px; white-space: pre-wrap; }
      .rwth-card-drill-table { width: 100%; border-collapse: collapse; font-size: 10px; }
      .rwth-card-drill-table th,
      .rwth-card-drill-table td { padding: 2px 6px; text-align: left; }
      .rwth-card-drill-table th { color: #8aa; font-weight: 400; border-bottom: 1px dashed #00e5ff44; }
      .rwth-card-drill-table tr.dim td { color: #667; }
      .rwth-card-drill-table tr.rwth-card-ladder-own td { color: #00e5ff; font-weight: 700; }
      .rwth-card-drill-empty { color: #8aa; font-style: italic; }

      /* #302 slice 1 — unified evidence ladder (SOLD + FOR-SALE in one table). */
      .rwth-card-ladder-unified { margin-top: 4px; min-width: 0; }
      .rwth-card-ladder-unified-table td.rwth-card-ladder-cell { white-space: nowrap; }
      .rwth-card-ladder-blank { color: #556; }
      .rwth-card-ladder-cheapest { color: #7ed098; }
      /* v0.3.0 slice 19c — widened-bonus rows (SOLD ladder only). */
      .rwth-card-ladder-table tr.rwth-card-ladder-widened td { font-style: italic; color: #aab; }
      .rwth-card-ladder-table tr.rwth-card-ladder-widened-mixed td { color: #cbb482; }
      /* v0.3.0 slice 19d — widened-base rows (SOLD ladder) + thin-ref label. */
      .rwth-card-ladder-table tr.rwth-card-ladder-widenedbase td { color: #d49ad4; font-style: italic; }
      .rwth-card-thin { color: #d49a78; font-style: italic; }
      /* #300 — bazaar/market floor cross-check + low-margin warning */
      .rwth-card-crosscheck { color: #9ab; }
      .rwth-card-lowmargin { color: #e0b04a; font-weight: 700; }

      /* v0.3.0 slice 20d — per-listing quality annotation on floor listings */
      .rwth-card-askfloor { margin-top: 4px; font-size: 10px; }
      .rwth-card-askfloor-row { color: #8aa; }
      .rwth-card-floor-beats { color: #ff8a8a; }
      .rwth-card-floor-below { color: #7ed098; }
      .rwth-card-askfloor-more { color: #667; font-style: italic; }

      /* v0.3.0 slice 10a — typical days-to-clear (VelocityTracker) */
      .rwth-card-velocity { color: #8ad0c0; }

      /* v0.3.0 slice 16 — per-cell drill-down inside the unified ladder. */
      .rwth-card-ladder-table td.rwth-card-ladder-clickable { cursor: pointer; }
      .rwth-card-ladder-table td.rwth-card-ladder-clickable:hover { background: #0d1f2a; }
      .rwth-card-ladder-table tr.rwth-card-ladder-row.expanded td { background: #0d1f2a; }
      .rwth-card-ladder-caret { color: #5dc6f0; display: inline-block; width: 9px; margin-right: 3px; }
      .rwth-card-ladder-detail td { padding: 0; background: #07111a; }
      .rwth-card-ladder-subtable {
        width: 100%; border-collapse: collapse; font-size: 10px;
        margin: 2px 0 4px 14px;
      }
      .rwth-card-ladder-subtable th { color: #667; font-weight: 400; padding: 1px 6px; text-align: left;
                                       border-bottom: 1px dotted #00e5ff22; }
      .rwth-card-ladder-subtable td { padding: 1px 6px; color: #cfe; }
      .rwth-card-ladder-subtable a { color: #5dc6f0; text-decoration: none; }
      .rwth-card-ladder-subtable a:hover { text-decoration: underline; }

      /* Ledger per-row Price-check panel. */
      .rwth-price-panel {
        margin-top: 4px; padding: 8px 10px;
        background: #0a1420; color: #cfe;
        border: 1px solid #00e5ff44; border-radius: 4px;
        font: 11px Consolas, monospace; line-height: 1.5;
      }
      .rwth-price-grid {
        display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px;
      }
      .rwth-price-grid > span:nth-child(odd) { color: #8aa; }
      .rwth-price-math { margin-top: 6px; color: #8aa; }
    `;
    document.head.appendChild(style);
  }

  // ─── similarity (pure) ───────────────────────────────────────────────────────
  // Mirrors Price Checker's calcRange exactly (ADR-0002 pure seam).
  const similarity = {
    /**
     * calcRange(value, tolerancePct) → { min, max }
     * tolerancePct === 0  → exact match (min === max === value)
     * otherwise           → floor(value*(1-t)) / ceil(value*(1+t))
     *                        where t = tolerancePct / 100
     */
    calcRange(value, tolerancePct) {
      if (tolerancePct === 0) return { min: value, max: value };
      const t = tolerancePct / 100;
      return {
        min: Math.floor(value * (1 - t)),
        max: Math.ceil(value  * (1 + t)),
      };
    },
  };

  // ─── Third-party search layer (ADR-0003) ─────────────────────────────────────
  // Impure: Supabase auction history + weav3r live market, with a 5-min LRU
  // cache around Supabase only (mirrors the Price Checker). Anon-key headers and
  // BONUS_DATA are copied verbatim from the Price Checker.
  const RWTH_API = {
    SUPABASE_URL: 'https://btrmmuuoofbonmuwrkzg.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cm1tdXVvb2Zib25tdXdya3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTEzMTgsImV4cCI6MjA4NDQyNzMxOH0.E-s0k46BORXLICAvxtEpqoM3Qmh4-TRLaJAwXO6wJTY',
    WEAV3R_API: 'https://weav3r.dev/api/ranked-weapons',
    CACHE_TTL: 5 * 60 * 1000,
    CACHE_MAX: 50,
    CACHE_EVICT: 10,
    CACHE_PREFIX: 'rwth_cache_',
  };

  // Bonus id ↔ name dictionary — verbatim from the Price Checker. Stable IDs
  // backed by the Supabase schema; Weav3r expects the title.
  const BONUS_DATA = [
    {id:50,title:"Achilles"},      {id:72,title:"Assassinate"},
    {id:52,title:"Backstab"},      {id:54,title:"Berserk"},
    {id:57,title:"Bleed"},         {id:33,title:"Blindfire"},
    {id:51,title:"Blindside"},     {id:85,title:"Bloodlust"},
    {id:67,title:"Comeback"},      {id:55,title:"Conserve"},
    {id:45,title:"Cripple"},       {id:49,title:"Crusher"},
    {id:47,title:"Cupid"},         {id:63,title:"Deadeye"},
    {id:62,title:"Deadly"},        {id:36,title:"Demoralize"},
    {id:86,title:"Disarm"},        {id:105,title:"Double Tap"},
    {id:74,title:"Double-edged"},  {id:87,title:"Empower"},
    {id:56,title:"Eviscerate"},    {id:75,title:"Execute"},
    {id:1,title:"Expose"},         {id:82,title:"Finale"},
    {id:79,title:"Focus"},         {id:38,title:"Freeze"},
    {id:80,title:"Frenzy"},        {id:64,title:"Fury"},
    {id:53,title:"Grace"},         {id:34,title:"Hazardous"},
    {id:83,title:"Home run"},      {id:115,title:"Immutable"},
    {id:26,title:"Impassable"},    {id:17,title:"Impenetrable"},
    {id:22,title:"Imperviable"},   {id:15,title:"Impregnable"},
    {id:92,title:"Insurmountable"},{id:91,title:"Invulnerable"},
    {id:102,title:"Irradiate"},    {id:121,title:"Irrepressible"},
    {id:112,title:"Kinetokinesis"},{id:89,title:"Lacerate"},
    {id:61,title:"Motivation"},    {id:59,title:"Paralyze"},
    {id:84,title:"Parry"},         {id:101,title:"Penetrate"},
    {id:21,title:"Plunder"},       {id:68,title:"Powerful"},
    {id:14,title:"Proficience"},   {id:66,title:"Puncture"},
    {id:88,title:"Quicken"},       {id:90,title:"Radiation Protection"},
    {id:65,title:"Rage"},          {id:41,title:"Revitalize"},
    {id:43,title:"Roshambo"},      {id:120,title:"Shock"},
    {id:44,title:"Slow"},          {id:104,title:"Smash"},
    {id:73,title:"Smurf"},         {id:71,title:"Specialist"},
    {id:35,title:"Spray"},         {id:37,title:"Storage"},
    {id:20,title:"Stricken"},      {id:58,title:"Stun"},
    {id:60,title:"Suppress"},      {id:78,title:"Sure Shot"},
    {id:48,title:"Throttle"},      {id:103,title:"Toxin"},
    {id:81,title:"Warlord"},       {id:46,title:"Weaken"},
    {id:76,title:"Wind-up"},       {id:42,title:"Wither"},
  ];
  const BONUS_NAME_TO_ID = (() => {
    const m = {};
    for (const b of BONUS_DATA) {
      const lo = b.title.toLowerCase();
      m[lo] = b.id;
      m[lo.replace(/[\s-]/g, '')] = b.id;
    }
    return m;
  })();

  // localStorage-backed LRU. One key per entry (`rwth_cache_<hash>`); eviction
  // drops the oldest CACHE_EVICT once CACHE_MAX is reached. Quota errors are
  // swallowed — caching is best-effort, never load-bearing.
  const Cache = {
    _keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(RWTH_API.CACHE_PREFIX) === 0) out.push(k);
        }
      } catch {}
      return out;
    },
    get(key) {
      const full = RWTH_API.CACHE_PREFIX + key;
      let entry = null;
      try { entry = JSON.parse(localStorage.getItem(full)); } catch {}
      if (entry && (Date.now() - entry.ts) < RWTH_API.CACHE_TTL) return entry.data;
      if (entry) { try { localStorage.removeItem(full); } catch {} }
      return null;
    },
    set(key, data) {
      const keys = this._keys();
      if (keys.length >= RWTH_API.CACHE_MAX) {
        const sorted = keys.map(k => {
          let ts = 0;
          try { ts = (JSON.parse(localStorage.getItem(k)) || {}).ts || 0; } catch {}
          return { k, ts };
        }).sort((a, b) => a.ts - b.ts);
        for (const e of sorted.slice(0, RWTH_API.CACHE_EVICT)) {
          try { localStorage.removeItem(e.k); } catch {}
        }
      }
      try {
        localStorage.setItem(RWTH_API.CACHE_PREFIX + key,
          JSON.stringify({ data, ts: Date.now() }));
      } catch {}
    },
    clear() {
      for (const k of this._keys()) {
        try { localStorage.removeItem(k); } catch {}
      }
    },
  };

  // GM_xmlhttpRequest → Promise. Rejects on non-2xx, parse errors, network
  // errors, and timeouts. The transport can be swapped via globalThis.__RWTH_GM
  // in the Node test shim (ADR-0002).
  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      const xhr = (typeof globalThis !== 'undefined' && globalThis.__RWTH_GM)
        || (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null);
      if (!xhr) { reject(new Error('GM_xmlhttpRequest unavailable')); return; }
      xhr({
        method: opts.method,
        url: opts.url,
        headers: opts.headers,
        data: opts.data,
        timeout: opts.timeout || 15000,
        onload: (res) => {
          try {
            const body = res && typeof res.responseText === 'string' ? res.responseText : '';
            const data = body ? JSON.parse(body) : null;
            if (res && res.status >= 200 && res.status < 300) resolve(data);
            else reject(new Error('HTTP ' + (res && res.status)));
          } catch { reject(new Error('Parse error')); }
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timeout')),
      });
    });
  }

  const SupabaseClient = {
    /** POST search-auctions. Returns { auctions, total }. Cached via Cache. */
    async search(query) {
      const cacheKey = JSON.stringify(query || {});
      const cached = Cache.get(cacheKey);
      if (cached) return cached;
      const data = await gmRequest({
        method: 'POST',
        url: `${RWTH_API.SUPABASE_URL}/functions/v1/search-auctions`,
        headers: {
          'Content-Type': 'application/json',
          'apikey': RWTH_API.SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + RWTH_API.SUPABASE_ANON_KEY,
        },
        data: JSON.stringify(query || {}),
      });
      const result = {
        auctions: (data && data.auctions) || [],
        total: (data && data.total) || 0,
      };
      Cache.set(cacheKey, result);
      return result;
    },
  };

  const Weav3rClient = {
    /** GET ranked-weapons. Returns { weapons, total_count }. Uncached
     *  (mirrors Price Checker — weav3r serves live market). */
    async search(query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query || {})) {
        if (v != null && v !== '') params.set(k, String(v));
      }
      const data = await gmRequest({
        method: 'GET',
        url: `${RWTH_API.WEAV3R_API}?${params.toString()}`,
      });
      return {
        weapons: (data && data.weapons) || [],
        total_count: (data && data.total_count) || 0,
      };
    },
  };

  // ─── ListingsFetcher (impure) ────────────────────────────────────────────────
  // Live item-market listings, kept *separate* from the auction-cleared comp
  // pool. Verdict math never touches these (PRD #265 Story 5/6; King: item
  // market typically 15–25% above sellable). Slice 14 (#280).
  //
  // Returns { market, bazaar } arrays of normalised listings:
  //   { price, bonusPct, qualityPct, sellerId, sellerName, listingId, source }
  //
  // Cache: in-memory Map, 5-min TTL keyed by item id + bonus/quality criteria.
  // Listings move fast, so the long-TTL `Cache` (sold-comp store) is wrong here.
  //
  // No new @connect hosts: a single weav3r ranked-weapons call returns both
  // venues interleaved (bazaar rows carry playerId/playerName), so we split on
  // source rather than fetching bazaar separately (#280).
  const LISTINGS_TTL_MS = 5 * 60 * 1000;
  const ListingsFetcher = {
    _cache: new Map(),
    _ttl: LISTINGS_TTL_MS,
    _shapeWeav3r(w) {
      if (!w || typeof w !== 'object') return null;
      const price = Number(w.price != null ? w.price : NaN);
      if (!Number.isFinite(price)) return null;
      // weav3r ranked-weapons returns the bonus under a `bonuses` map/array of
      // { bonus, value } entries — NOT a flat bonus1Value/bonusValue. Reading
      // the non-existent flat fields left every LISTED (asking) row at 0.00%
      // bonus while quality populated fine. Take the first entry as the primary
      // %, matching the Supabase cleared-comp convention (bonus_values[0]).
      let bonusPct = NaN;
      if (w.bonuses && typeof w.bonuses === 'object') {
        const first = Object.values(w.bonuses).find(b => b && b.value != null);
        if (first) bonusPct = Number(first.value);
      }
      if (!Number.isFinite(bonusPct)) {
        bonusPct = Number(w.bonus1Value != null ? w.bonus1Value
                   : w.bonusValue != null ? w.bonusValue : NaN);
      }
      const qualityPct = Number(w.quality != null ? w.quality : NaN);
      // weav3r interleaves item-market and bazaar listings in one response.
      // Bazaar rows carry the seller's playerId/playerName (the row links to
      // their bazaar.php); item-market rows don't. This tag is load-bearing:
      // downstream keeps bazaar OUT of the anchor/tiering math (PRD #296).
      const isBazaar = w.playerId != null || w.playerName != null;
      return {
        price,
        bonusPct: Number.isFinite(bonusPct) ? bonusPct : null,
        qualityPct: Number.isFinite(qualityPct) ? qualityPct : null,
        sellerId: w.playerId != null ? w.playerId
                : w.sellerId != null ? w.sellerId
                : w.seller != null ? w.seller : null,
        sellerName: w.playerName != null ? w.playerName : null,
        listingId: w.listingId != null ? w.listingId
                 : w.id != null ? w.id : null,
        source: isBazaar ? 'bazaar' : 'market',
      };
    },
    _buildQuery(item) {
      const bonuses  = ((item && item.bonuses) || []).filter(b => b && b.name);
      const itemName = (item && item.itemName) || '';
      const q = { sortField: 'price', sortDirection: 'asc' };
      const cat = itemCategory(item || {});
      if (cat === 'Armor') {
        q.tab = 'armor';
        if (itemName) q.armorPiece = itemName;
      } else {
        q.tab = 'weapons';
        if (itemName) q.weaponName = itemName;
      }
      // No bonus-value / quality range filters — widener + drilldown handle
      // narrowing on-card so the network layer returns a wide-enough comp set.
      bonuses.slice(0, 2).forEach((b, i) => {
        if (i === 0) q.bonus1 = b.name;
        else         q.bonus2 = b.name;
      });
      return q;
    },
    /**
     * fetch(item) → Promise<{ market, bazaar }>
     * Cached 5 min by item+criteria. Errors degrade to empty arrays.
     */
    async fetch(item) {
      const query = ListingsFetcher._buildQuery(item);
      const key   = JSON.stringify(query);
      const now   = Date.now();
      const hit   = ListingsFetcher._cache.get(key);
      if (hit && (now - hit.ts) < ListingsFetcher._ttl) return hit.data;
      // One weav3r call returns both venues interleaved; _shapeWeav3r tags each
      // row's source so we split them here. Bazaar stays a separate array so the
      // anchor/tiering math can exclude it (PRD #296) while the LISTED ladder +
      // #300 cross-check still see it.
      let market = [];
      let bazaar = [];
      try {
        const r = await Weav3rClient.search(query);
        const shaped = (r.weapons || []).map(ListingsFetcher._shapeWeav3r).filter(Boolean);
        market = shaped.filter(l => l.source === 'market');
        bazaar = shaped.filter(l => l.source === 'bazaar');
      } catch { market = []; bazaar = []; }
      const data = { market, bazaar };
      ListingsFetcher._cache.set(key, { ts: now, data });
      return data;
    },
    /** Test/utility — drop cached entries. */
    clear() { ListingsFetcher._cache.clear(); },
  };

  // ─── Bracket-tiering market anchor (pure, #298 / PRD #296) ───────────────────
  // The buy-max deduction is only as good as the price it anchors on. Item-
  // market listings cluster into price brackets by bonus %, and the step between
  // brackets is large and real (Enfield Deadeye 25–29% sits near the floor;
  // 30–35% lists ~30% higher). Anchoring on the *global* cheapest listing prices
  // a high-bonus target off a weaker, cheaper piece, so the buy max comes out
  // far too low on exactly the items that matter most.
  //
  // resolveMarketAnchor(listings, targetBonus, opts) → { anchor, tier, tiers }
  //   listings    – [{ price, bonusValue }]  (MARKET only — bazaar is excluded
  //                 from anchor math; it isn't inflated, so deducting off it
  //                 double-counts, and a cheap high-bonus bazaar piece would
  //                 falsely trip the tier guard — PRD #296)
  //   targetBonus – the candidate item's bonus %
  //   opts.jumpThreshold – fractional step that promotes a bracket to a new tier
  //                        (default BRACKET_JUMP_THRESHOLD)
  //
  // Algorithm (single pass over bonus brackets, ascending):
  //   1. Market floor = global cheapest listing, ignoring bonus/quality.
  //   2. Each distinct bonus %'s cheapest listing is its bracket floor.
  //   3. Promote a bracket to a new tier when BOTH: its floor is ≥ threshold
  //      above the *previous tier's* floor (so stacked steps each promote), AND
  //      no higher-bonus listing sits below it (outlier/undercut guard — a cheap
  //      strong piece cancels the jump so we match/undercut it instead of
  //      overpaying).
  //   4. Anchor = floor of the highest tier whose threshold bonus ≤ target;
  //      below the first jump (or no target) falls back to the global floor.
  // Pure: no DOM, no network, no globals.
  const BRACKET_JUMP_THRESHOLD = 0.10;

  // #300 — the bazaar floor is shown beside the market floor as a cross-check,
  // and a low-margin warning fires when they're "similar". The venue model
  // treats bazaar as ~5% under market normally (see sellLadder), so we warn
  // when the two floors sit within 10% of EACH OTHER (two-sided) — the normal
  // resale cushion has collapsed. A bazaar floor far above market is a wide
  // spread, not a thin one, and does NOT warn. Bazaar stays OUT of the
  // anchor/tiering math (PRD #296); this is display-only.
  const SIMILAR_FLOORS_BAND = 0.10;
  function resolveMarketAnchor(listings, targetBonus, opts) {
    const threshold = (opts && Number.isFinite(Number(opts.jumpThreshold)))
      ? Number(opts.jumpThreshold) : BRACKET_JUMP_THRESHOLD;
    const valid = (Array.isArray(listings) ? listings : [])
      .map(l => ({ price: Number(l && l.price), bonus: Number(l && l.bonusValue) }))
      .filter(l => Number.isFinite(l.price) && l.price > 0 && Number.isFinite(l.bonus));
    if (!valid.length) return { anchor: null, tier: null, tiers: [] };

    const globalFloor = Math.min(...valid.map(l => l.price));

    // Cheapest listing per distinct bonus %, ascending by bonus.
    const floorByBonus = new Map();
    for (const l of valid) {
      const cur = floorByBonus.get(l.bonus);
      if (cur == null || l.price < cur) floorByBonus.set(l.bonus, l.price);
    }
    const brackets = [...floorByBonus.entries()]
      .map(([bonus, floor]) => ({ bonus, floor }))
      .sort((a, b) => a.bonus - b.bonus);

    // Tier 0 is the base tier: its floor is the global cheapest (step 1), so a
    // cheap strong piece anywhere pulls the base anchor down to it.
    const tiers = [{ thresholdBonus: brackets[0].bonus, floor: globalFloor }];
    for (let i = 1; i < brackets.length; i++) {
      const b = brackets[i];
      const prev = tiers[tiers.length - 1];
      const jumped = b.floor >= prev.floor * (1 + threshold);
      // Undercut guard: a higher-bonus listing going cheaper than this bracket's
      // floor means the strong piece is the better buy — don't establish a tier
      // here (PRD #296 user story 6).
      const undercut = valid.some(l => l.bonus > b.bonus && l.price < b.floor);
      if (jumped && !undercut) {
        tiers.push({ thresholdBonus: b.bonus, floor: b.floor });
      }
    }

    // Anchor = highest tier whose threshold bonus ≤ target; below the first jump
    // (or no/NaN target) falls back to the base tier (global floor).
    const tb = Number(targetBonus);
    let tier = tiers[0];
    if (Number.isFinite(tb)) {
      for (const t of tiers) {
        if (t.thresholdBonus <= tb) tier = t;
      }
    }
    return { anchor: tier.floor, tier, tiers };
  }

  // ─── PricingEngine (pure) ─────────────────────────────────────────────────────
  // Verdict + ledger-suggest engine — pure functions, no GM calls, no DOM.
  // All impure callers (fetch/cache/render) live in later slices.

  // Default recency window (days) per item class for compReference (v0.3.0
  // slice 6): yellow 6mo, orange 18mo, red 3yr. Armor classes that route to
  // BB floor (Dune/Riot/trash) have no recency dependency.
  // v0.3.0 slice 19a (#285) — Seed table of bonus-mechanic change dates.
  // Sales with `timestamp < date` are dropped when the listing's primary
  // bonus matches a key here. Source: King's RW logic doc, example 4
  // (puncture nerf, Feb 2026). Users extend via Settings → Reference tables.
  const BONUS_CHANGE_DATES_SEED = {
    puncture: '2026-02-01',
  };

  // v0.3.0 slice 19d (#288) — weapon-base adjacency clusters. King's RW logic
  // doc step 3: when same-base comps are thin, pull adjacent tiers (one
  // stronger + one weaker). Each inner array is an ordered tier-cluster;
  // adjacency = neighbours in the array. Tokens are lower-case, underscores
  // for spaces; resolution matches the token (with underscores → spaces)
  // against the lower-cased item name. Users extend via Settings.
  const SIMILAR_BASES_SEED = [
    ['macana', 'dbk', 'metal_nunchakus', 'kodachi', 'samurai', 'yasukuni', 'katana'],
    ['armalite', 'enfield', 'sig552', 'tavor'],
    ['mp40', 'thompson'],
  ];

  /** ISO date → epoch ms, returns null on parse failure. */
  function _isoToEpoch(iso) {
    if (!iso) return null;
    const ms = Date.parse(String(iso).trim() + 'T00:00:00Z');
    return Number.isFinite(ms) ? ms : null;
  }

  /** Resolve the suppression threshold for `bonusName` from seed + user overrides. */
  function resolveBonusChangeEpoch(bonusName, intel) {
    if (!bonusName) return null;
    const key = String(bonusName).trim().toLowerCase();
    if (!key) return null;
    const overrides = (intel && intel.bonusChangeDates) || {};
    const iso = overrides[key] != null ? overrides[key] : BONUS_CHANGE_DATES_SEED[key];
    return _isoToEpoch(iso);
  }

  // v0.3.14 slice 19b (#286) — derived sensitivity thresholds. A slope is only
  // reported when the comp set is dense enough to read it: ≥5 comps spanning
  // ≥3 distinct bonus values. Below that we say so instead of inventing a number.
  const SENSITIVITY_MIN_COMPS = 5;
  const SENSITIVITY_MIN_DISTINCT = 3;
  // Slope is considered "meaningful" when |slope per 1%| exceeds this fraction
  // of the comp median — otherwise the base is flat and % barely moves price.
  const SENSITIVITY_FLAT_FRACTION = 0.01;

  const RECENCY_DEFAULTS = {
    yellowWeapon:  180,
    orangeWeapon:  548,
    redWeapon:    1095,
    assaultArmor:  180,
    orangeArmor:   548,
    redArmor:     1095,
    duneRiotArmor: null,
    trashBB:       null,
  };

  /** Internal: median of a numeric array. Returns null for empty input. */
  function _median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ─── mergeLadder (pure) — #302 slice 1 ───────────────────────────────────────
  // Class-tiered quality buckets (yellow default / orange / red), unchanged from
  // the former InlineRenderer._qualityBuckets.
  function _qualityBuckets(itemClass) {
    const s = String(itemClass || '').toLowerCase();
    if (s.includes('orange')) {
      return [
        { lo: 0,   hi: 150, label: '<150%' },
        { lo: 150, hi: 200, label: '150–199%' },
        { lo: 200, hi: 250, label: '200–249%' },
        { lo: 250, hi: Infinity, label: '250%+' },
      ];
    }
    if (s.includes('red')) {
      return [
        { lo: 0,   hi: 200, label: '<200%' },
        { lo: 200, hi: 300, label: '200–299%' },
        { lo: 300, hi: 400, label: '300–399%' },
        { lo: 400, hi: Infinity, label: '400%+' },
      ];
    }
    return [
      { lo: 0,   hi: 100, label: '<100%' },
      { lo: 100, hi: 130, label: '100–129%' },
      { lo: 130, hi: 150, label: '130–149%' },
      { lo: 150, hi: Infinity, label: '150%+' },
    ];
  }
  function _qualityBucketIndex(q, buckets) {
    const v = Number(q);
    if (!Number.isFinite(v)) return -1;
    for (let i = 0; i < buckets.length; i++) {
      if (v >= buckets[i].lo && v < buckets[i].hi) return i;
    }
    return -1;
  }

  /**
   * mergeLadder({ soldComps, listedComps, axis, ownKey, itemClass }) →
   *   sorted (desc by `sort`) array of buckets, each:
   *     { key, label, sort, isOwn,
   *       sold:   { median, min, max, count, rows } | null,
   *       listed: { cheapest, count, rows }         | null }
   *
   * Absorbs the per-comp bucketing that used to be split across
   * _buildBonusLadder / _qualityBuckets / _qualityBucketIndex. A bucket appears
   * if it has priced data on either side; the missing side is null. Bonus axis
   * groups by exact bonus %; quality axis groups into the class-tiered bands.
   * `ownKey` is the candidate's own axis value (bonus % or raw quality %) and is
   * resolved to the matching bucket to flag `isOwn`.
   */
  function mergeLadder({ soldComps, listedComps, axis, ownKey, itemClass } = {}) {
    const useQuality = axis === 'quality';
    const buckets = useQuality ? _qualityBuckets(itemClass) : null;
    const keyOf = (c) => {
      if (useQuality) {
        const idx = _qualityBucketIndex(c && c.quality, buckets);
        return idx < 0 ? null : idx;
      }
      if (!c || c.bonusValue == null) return null;
      const k = Number(c.bonusValue);
      return Number.isFinite(k) ? k : null;
    };
    const labelOf = (key) => (useQuality ? buckets[key].label : `${key}%`);
    const map = new Map(); // key → { key, label, sort, soldRows, listedRows }
    const add = (c, side) => {
      if (!c) return;
      const k = keyOf(c);
      if (k == null) return;
      if (!map.has(k)) map.set(k, { key: k, label: labelOf(k), sort: k, soldRows: [], listedRows: [] });
      map.get(k)[side].push(c);
    };
    for (const c of (Array.isArray(soldComps) ? soldComps : [])) add(c, 'soldRows');
    for (const c of (Array.isArray(listedComps) ? listedComps : [])) add(c, 'listedRows');

    let ownResolved = null;
    if (useQuality) {
      const oi = _qualityBucketIndex(ownKey, buckets);
      if (oi >= 0) ownResolved = oi;
    } else {
      const ob = Number(ownKey);
      if (Number.isFinite(ob)) ownResolved = ob;
    }

    const priced = (rows) => rows.filter(c => Number.isFinite(Number(c.price)) && Number(c.price) > 0);
    const out = [];
    for (const g of map.values()) {
      const soldRows = priced(g.soldRows);
      const listedRows = priced(g.listedRows);
      let sold = null;
      if (soldRows.length) {
        const prices = soldRows.map(c => Number(c.price));
        sold = {
          median: _median(prices),
          min: Math.min(...prices),
          max: Math.max(...prices),
          count: soldRows.length,
          rows: soldRows,
        };
      }
      let listed = null;
      if (listedRows.length) {
        const prices = listedRows.map(c => Number(c.price));
        listed = { cheapest: Math.min(...prices), count: listedRows.length, rows: listedRows };
      }
      if (!sold && !listed) continue;
      out.push({
        key: g.key,
        label: g.label,
        sort: g.sort,
        isOwn: ownResolved != null && g.key === ownResolved,
        sold,
        listed,
      });
    }
    out.sort((a, b) => b.sort - a.sort);
    return out;
  }

  // ─── CompWidener (pure) ─────────────────────────────────────────────────────
  // v0.3.15 slice 19c (#287). Picks the narrowest bonus-tolerance band that
  // yields ≥minStrict comps and tags each surviving comp with its provenance
  // so the card can show `5 strict + 3 widened bonus to ±2%` and the SOLD
  // ladder can mark widened-only rows distinctly. Replaces the silent widen
  // inside compReference.
  const CompWidener = {
    /**
     * tag(comps, { target, strictTol, widenTols, minStrict }) →
     *   { comps, strictCount, widenedBonusCount, widenedTolerance }
     *
     * `comps` are pre-filtered for everything else (recency, suppression).
     * Returns clones tagged with `provenance: 'strict' | 'widenedBonus'`.
     * When target/strictTol are missing, returns clones with no provenance
     * (no bonus filter to widen on).
     */
    tag(comps, opts) {
      const o = opts || {};
      const list = Array.isArray(comps) ? comps : [];
      const target    = Number(o.target);
      const strictTol = Number(o.strictTol);
      const minStrict = Number.isFinite(Number(o.minStrict)) ? Number(o.minStrict) : 3;
      const widenTols = Array.isArray(o.widenTols)
        ? o.widenTols.slice().sort((a, b) => a - b) : [];
      // v0.3.0 slice 19d (#288) — comps tagged `widenedBase` (from adjacent
      // tier-cluster fetches) are kept verbatim. Bonus widening is a same-base
      // operation; the base-widen population travels in parallel and gets
      // surfaced separately on the card + ladder.
      const baseWidened = list.filter(c => c && c.provenance === 'widenedBase')
        .map(c => Object.assign({}, c));
      const sameBase    = list.filter(c => !(c && c.provenance === 'widenedBase'));
      if (!Number.isFinite(target) || !Number.isFinite(strictTol)) {
        const all = sameBase.map(c => Object.assign({}, c));
        return {
          comps: all.concat(baseWidened),
          strictCount: all.length,
          widenedBonusCount: 0,
          widenedBaseCount: baseWidened.length,
          widenedTolerance: null,
        };
      }
      const inBand = (c, tol) => c && c.bonusValue != null
        && Number.isFinite(Number(c.bonusValue))
        && Math.abs(Number(c.bonusValue) - target) <= tol;
      const strict = sameBase.filter(c => inBand(c, strictTol));
      if (strict.length >= minStrict || !widenTols.length) {
        const tagged = strict.map(c => Object.assign({}, c, { provenance: 'strict' }));
        return {
          comps: tagged.concat(baseWidened),
          strictCount: strict.length,
          widenedBonusCount: 0,
          widenedBaseCount: baseWidened.length,
          widenedTolerance: strictTol,
        };
      }
      let chosen = strict;
      let chosenTol = strictTol;
      for (const tol of widenTols) {
        if (tol <= strictTol) continue;
        const w = sameBase.filter(c => inBand(c, tol));
        if (w.length > chosen.length) { chosen = w; chosenTol = tol; }
        if (chosen.length >= minStrict) break;
      }
      const strictSet = new Set(strict);
      const tagged = chosen.map(c => Object.assign({}, c, {
        provenance: strictSet.has(c) ? 'strict' : 'widenedBonus',
      }));
      const widenedBonusCount = tagged.length - strict.length;
      return {
        comps: tagged.concat(baseWidened),
        strictCount: strict.length,
        widenedBonusCount: Math.max(0, widenedBonusCount),
        widenedBaseCount: baseWidened.length,
        widenedTolerance: chosenTol,
      };
    },
  };

  const PricingEngine = {
    /**
     * verdict(listing, comps, opts) → { tier, reference, band, compsUsed, tolerance,
     *                                    slope?, slopeProjection?, thin? }
     *
     * listing  – { price: number, quality: number }
     * comps    – Array<{ price: number, quality: number }>
     *            pre-filtered for item + bonus-name match; quality window applied here.
     * opts     – { tolerance?: number, band?: number }
     *            tolerance default 10 (widens on thin); band default 7.
     *
     * Widen-on-thin: starts at ±10%, widens to ±20%, then ±30% if count < 3.
     * Flags thin:true when widened.  tier='thin' if still <3; tier='none' if 0 comps.
     *
     * Slope: computed only when listing.quality is outside [min,max] of comp qualities.
     * Never replaces median reference — surfaced as supplementary data.
     */
    verdict(listing, comps, opts = {}) {
      const band         = opts.band ?? 7;
      const startTol     = opts.tolerance ?? 10;
      const widths       = [startTol, 20, 30];

      let filtered   = [];
      let tolerance  = startTol;
      let thin       = false;

      for (const tol of widths) {
        const { min, max } = similarity.calcRange(listing.quality, tol);
        filtered  = comps.filter(c => c.quality >= min && c.quality <= max);
        tolerance = tol;
        if (filtered.length >= 3) break;
        if (tol !== startTol) thin = true;  // widened at least once
      }

      if (filtered.length === 0) {
        return { tier: 'none', reference: null, band, compsUsed: 0, tolerance };
      }

      if (filtered.length < 3) {
        thin = true;
        return { tier: 'thin', reference: null, band, compsUsed: filtered.length, tolerance, thin };
      }

      const reference = _median(filtered.map(c => c.price));
      const lo        = reference * (1 - band / 100);
      const hi        = reference * (1 + band / 100);

      let tier;
      if (listing.price < lo)      tier = 'good';
      else if (listing.price > hi) tier = 'over';
      else                          tier = 'fair';

      const result = { tier, reference, band, compsUsed: filtered.length, tolerance };
      if (thin) result.thin = true;

      // Slope branch — only when listing quality is outside the comp quality range.
      const qualities   = filtered.map(c => c.quality);
      const minQuality  = Math.min(...qualities);
      const maxQuality  = Math.max(...qualities);

      if (listing.quality < minQuality || listing.quality > maxQuality) {
        if (maxQuality !== minQuality) {
          // Use the comps at the quality extremes for a simple two-point slope.
          const atMin = filtered.filter(c => c.quality === minQuality);
          const atMax = filtered.filter(c => c.quality === maxQuality);
          const minPrice = _median(atMin.map(c => c.price));
          const maxPrice = _median(atMax.map(c => c.price));
          result.slope           = (maxPrice - minPrice) / (maxQuality - minQuality);
          result.slopeProjection = minPrice + (listing.quality - minQuality) * result.slope;
        }
      }

      return result;
    },

    /**
     * ledgerSuggest(listingComps, buyPrice, opts) →
     *   { expected, suggestedList, projectedNet, profit, roi }
     *
     * listingComps – Array<{ price: number }> — the comp set for this item.
     * buyPrice     – number — what you paid.
     * opts         – { markup?: number, mugBuffer?: number }
     *                markup     default 1.20  (target sell multiplier on cost)
     *                mugBuffer  default 10    (% above expected to buffer above market)
     *                market fee hard-coded 5%.
     *
     * suggestedList = max(buyPrice × markup, expected × (1 + mugBuffer%))
     * This ensures you always meet your markup target AND stay above the
     * mugBuffer threshold above market (neither alone is sufficient in all cases).
     */
    ledgerSuggest(listingComps, buyPrice, opts = {}) {
      const markup    = opts.markup    ?? 1.20;
      const mugBuffer = opts.mugBuffer ?? 10;
      const FEE       = 0.05;

      const prices   = listingComps.map(c => c.price).filter(p => typeof p === 'number' && p > 0);
      const expected = _median(prices) ?? 0;

      const suggestedList = Math.round(
        Math.max(buyPrice * markup, expected * (1 + mugBuffer / 100))
      );
      const projectedNet = Math.round(suggestedList * (1 - FEE));
      const profit       = projectedNet - buyPrice;
      const roi          = buyPrice > 0
        ? Math.round((profit / buyPrice) * 10000) / 100
        : 0;

      return { expected, suggestedList, projectedNet, profit, roi };
    },

    /**
     * buyTarget({ itemClass, comps, currentBid, settings, bbFloor }) →
     *   { max, floor, median?, medianTarget?, range?, tolerance?, currentBidDelta }
     *
     * v0.3.0 slice 13: yellowWeapon + assaultArmor anchor the headline buy
     * number on min(comps) (floor-anchored, worst-case) instead of median.
     * `medianTarget` carries the median-anchored figure for secondary display.
     */
    buyTarget(args) {
      const a = args || {};
      const s = a.settings || {};
      const cls = String(a.itemClass || 'yellowWeapon').trim();
      const bbFloorRaw = Number(a.bbFloor);
      const hasBBFloor = Number.isFinite(bbFloorRaw) && bbFloorRaw > 0;
      const bbFloor = hasBBFloor ? Math.round(bbFloorRaw) : null;
      const prices = ((a.comps) || [])
        .map(c => Number(c && c.price))
        .filter(p => Number.isFinite(p) && p > 0);
      const med = _median(prices);
      const mn  = prices.length ? Math.min(...prices) : null;
      const cb  = Number(a.currentBid);
      const deltaOf = (m) => (Number.isFinite(cb) && m != null) ? m - cb : null;
      const empty = { max: null, floor: null, currentBidDelta: null };

      if (cls === 'duneRiotArmor') {
        if (!hasBBFloor) return empty;
        const tolerance = s.duneRiotTolerance != null ? s.duneRiotTolerance : 25_000_000;
        const max = bbFloor + Math.round(tolerance);
        return { max, floor: bbFloor, tolerance: Math.round(tolerance), currentBidDelta: deltaOf(max) };
      }
      if (cls === 'trashBB') {
        if (!hasBBFloor) return empty;
        return { max: bbFloor, floor: bbFloor, currentBidDelta: deltaOf(bbFloor) };
      }
      if (cls === 'assaultArmor') {
        if (mn == null) return empty;
        const dMin = s.assaultDiscountMin != null ? s.assaultDiscountMin : 0.10;
        const dMax = s.assaultDiscountMax != null ? s.assaultDiscountMax : 0.20;
        const hi  = Math.round(mn * (1 - dMin));
        const lo  = Math.round(mn * (1 - dMax));
        const mid = Math.round((lo + hi) / 2);
        const medianTarget = med != null
          ? Math.round(med * (1 - (dMin + dMax) / 2)) : null;
        return { max: mid, floor: null, range: [lo, hi],
                 median: med, medianTarget, anchor: 'min',
                 currentBidDelta: deltaOf(mid) };
      }
      if (cls === 'orangeWeapon' || cls === 'redWeapon'
          || cls === 'orangeArmor'  || cls === 'redArmor') {
        if (!prices.length) return { max: null, floor: null, range: null, currentBidDelta: null };
        const lo = Math.round(Math.min(...prices));
        const hi = Math.round(Math.max(...prices));
        return { max: null, floor: null, range: [lo, hi], median: med, currentBidDelta: null };
      }
      // yellowWeapon (default) — bid math is MARKET-anchored.
      // The tax/mug/margin cut models resale friction off an *inflated item-
      // market listing*, not off auction-cleared prices. Anchoring it on the
      // auction comps (what pieces already clear for at auction) shaved 20% off
      // an already-realistic sale price → a nonsense "auction bid" below what
      // the thing actually sells for. Deduct off the cheapest live market
      // listing instead, and surface the auction-comp median separately as the
      // clearing reference the bid is judged against (no deduction — it is
      // already a sale price).
      const tax    = s.tax    != null ? s.tax    : 0.05;
      const mug    = s.mug    != null ? s.mug    : 0.10;
      const margin = s.margin != null ? s.margin : 0.05;
      const ded = 1 - tax - mug - margin;
      const marketAnchor = Number(a.marketAnchor);
      const hasMarket = Number.isFinite(marketAnchor) && marketAnchor > 0;
      const max = hasMarket ? Math.round(marketAnchor * ded) : null;
      return { max, floor: bbFloor, anchor: 'market',
               marketAnchor: hasMarket ? Math.round(marketAnchor) : null,
               auctionMedian: med != null ? Math.round(med) : null,
               currentBidDelta: deltaOf(max) };
    },

    /**
     * sellLadder({ itemClass, comps, marketAnchor, marketCheapest, buyCost }) →
     *   { auctionFloor, auctionClearing, bazaar, market, forum, floor }
     *
     * Venue model (corrected — real-world structure, not the old PRD spread):
     *   bazaar = forum  <  item market (~+5%)
     * Bazaar and forum/trade-chat are the same "smart buyer" front — they take
     * effort to reach, so they price the SAME and aggressively low. The item
     * market sits ~5% above them yet clears fastest (built into Torn, biggest
     * casual buyer pool, zero extra steps), so an attractive item-market price
     * is always being trawled.
     *
     * Anchor: `marketAnchor` (the bonus-bracket price the buy-max already uses,
     * #298) so the ladder and the headline tell ONE story. Falls back to the
     * cheapest live listing, then the comp median. Anchoring on the global
     * cheapest used to collide the bazaar rung with the buy-max → phantom
     * zero-margin cards.
     *
     * Auction relist range: floor = anchor − ~15% (move-it price, King's
     * list-target minus 10–20%); top = comp median (what comparable pieces
     * actually clear for at auction). Floor enforced ≥ buyCost so it never
     * proposes a loss.
     */
    sellLadder(args) {
      const a = args || {};
      const prices = ((a.comps) || [])
        .map(c => Number(c && c.price))
        .filter(p => Number.isFinite(p) && p > 0);
      const med = _median(prices);
      const anchorIn = Number(a.marketAnchor);
      const mc  = Number(a.marketCheapest);
      const anchor = Number.isFinite(anchorIn) && anchorIn > 0 ? anchorIn
        : (Number.isFinite(mc) && mc > 0 ? mc : med);
      if (anchor == null) {
        return { auctionFloor: null, auctionClearing: null,
                 bazaar: null, market: null, forum: null, floor: null };
      }
      const market = Math.round(anchor);
      const bazaar = Math.round(market / 1.05);
      const forum  = bazaar; // same aggressive front as bazaar (see model above)
      const auctionFloor    = Math.round(market * 0.85);
      const auctionClearing = med != null ? Math.round(med) : null;
      const buyCost = Number(a.buyCost);
      const floor = Math.max(bazaar, Number.isFinite(buyCost) ? Math.round(buyCost) : 0);
      return { auctionFloor, auctionClearing, bazaar, market, forum, floor };
    },

    /**
     * deductionChain({ anchor, settings }) →
     *   { anchor, tax, mug, margin, buyMax, resaleNet } | null
     *
     * King's order-of-ops step 4, single-cut model (#290/#291): from a
     * reference price — always an inflated item-market ask (the asking floor /
     * cheapest live listing) — deduct 5% market tax + 10% mug risk + 5–10%
     * profit margin to a max bid. The anchor is the market ask, NEVER an
     * auction-cleared price: cleared comps are already realistic sale prices,
     * so deducting resale friction off them double-counts. There is likewise NO
     * separate market-inflation multiplier — the single cut already accounts
     * for why you bid under asking (sellers pad asking for the same tax/mug
     * exposure, so stacking a second discount would double-count it).
     *
     * `buyMax`    – highest bid that still clears the margin after tax + mug.
     * `resaleNet` – what you net selling at the anchor after tax + mug only
     *               (no margin); the gap buyMax → resaleNet is the profit
     *               buffer the margin reserves.
     *
     * anchor   – reference price (> 0), else returns null.
     * settings – { tax, mug, margin } (defaults 0.05 / 0.10 / 0.05).
     */
    deductionChain(args) {
      const a = args || {};
      const s = a.settings || {};
      const anchor = Number(a.anchor);
      if (!Number.isFinite(anchor) || anchor <= 0) return null;
      const tax    = s.tax    != null ? s.tax    : 0.05;
      const mug    = s.mug    != null ? s.mug    : 0.10;
      const margin = s.margin != null ? s.margin : 0.05;
      const buyMax    = Math.round(anchor * (1 - tax - mug - margin));
      const resaleNet = Math.round(anchor * (1 - tax - mug));
      return { anchor: Math.round(anchor), tax, mug, margin, buyMax, resaleNet };
    },

    /**
     * compReference(comps, settings) →
     *   { median, count, comps, strictCount, widenedBonusCount,
     *     widenedTolerance, recencyDays, tolerance, suppressedByChange }
     *
     * Tiered recency window per item class (v0.3.0 slice 6): yellow 6mo,
     * orange 18mo, red 3yr. Default table below; override via
     * `settings.recencyByClass`.
     *
     * v0.3.15 slice 19c (#287): delegates the widen-on-thin band selection
     * to CompWidener.tag, which tags each surviving comp with
     * `provenance: 'strict' | 'widenedBonus'`. `strictCount` /
     * `widenedBonusCount` / `widenedTolerance` drive the ref line
     * "5 strict + 3 widened bonus to ±2%".
     *
     * Inputs:
     *   comps    – Array<{ price, timestamp?, bonusValue? }> (compShape output)
     *   settings – {
     *     itemClass?:        recency lookup key (default 'yellowWeapon')
     *     targetBonusValue?: bonus % we're scoring against; null skips bonus filter
     *     strictTolerance?:  ± window around targetBonusValue; null skips bonus filter
     *     widenTolerances?:  ordered list of wider ±% bands to try
     *     recencyByClass?:   override the default class→days map
     *     now?:              epoch ms (for tests)
     *   }
     */
    compReference(comps, settings) {
      const s = settings || {};
      const cls = String(s.itemClass || 'yellowWeapon');
      const recencyMap = s.recencyByClass || RECENCY_DEFAULTS;
      const recencyDays = recencyMap[cls] != null ? recencyMap[cls] : null;
      const now = Number.isFinite(Number(s.now)) ? Number(s.now) : Date.now();

      const list = (comps || []).filter(c => c && Number.isFinite(Number(c.price)) && Number(c.price) > 0);

      // v0.3.0 slice 19a (#285) — suppress sales from before a known bonus-
      // mechanic change for the listing's primary bonus. King's example 4
      // (puncture nerf): old logs are stale and would drag the median up.
      // Undated comps pass through (we can't know which side of the date).
      const intelForSuppress = s.intel || (typeof MEM !== 'undefined' ? MEM.intel : null);
      const suppressEpoch = resolveBonusChangeEpoch(s.bonusName, intelForSuppress);
      const preSuppressCount = list.length;
      const afterSuppress = suppressEpoch == null
        ? list
        : list.filter(c => !Number.isFinite(Number(c.timestamp))
                            || Number(c.timestamp) >= suppressEpoch);
      const suppressedByChange = preSuppressCount - afterSuppress.length;

      // Recency filter: only applied when we have both a window and a timestamp;
      // undated comps fall through so legacy/asking rows aren't silently dropped.
      const recencyMs = recencyDays != null ? recencyDays * 86400000 : null;
      const inRecency = recencyMs == null
        ? afterSuppress
        : afterSuppress.filter(c => !Number.isFinite(Number(c.timestamp))
                            || (now - Number(c.timestamp)) <= recencyMs);

      const strictTol = Number.isFinite(Number(s.strictTolerance)) ? Number(s.strictTolerance) : null;
      const target    = Number.isFinite(Number(s.targetBonusValue)) ? Number(s.targetBonusValue) : null;
      // Default widening ladder when callers pass strictTolerance:0 (exact
      // match) — slice 19e (#289). Widener steps outward in 1%, 3%, 5%, 10%
      // bands until ≥minStrict comps are collected.
      const widenTols = Array.isArray(s.widenTolerances) && s.widenTolerances.length
        ? s.widenTolerances
        : (strictTol != null ? [1, 3, 5, 10] : []);

      // v0.3.15 slice 19c (#287) — delegate band-selection + tagging to
      // CompWidener. Each surviving comp carries `provenance` so callers
      // (ref line + SOLD ladder) can distinguish strict from widened.
      const tagged = CompWidener.tag(inRecency, {
        target, strictTol, widenTols, minStrict: 3,
      });

      const tolOut = (target != null && strictTol != null)
        ? tagged.widenedTolerance
        : strictTol;
      return {
        median: _median(tagged.comps.map(c => Number(c.price))),
        count: tagged.comps.length,
        comps: tagged.comps,
        strictCount: tagged.strictCount,
        widenedBonusCount: tagged.widenedBonusCount,
        widenedBaseCount: tagged.widenedBaseCount || 0,
        widenedTolerance: tagged.widenedTolerance,
        recencyDays,
        tolerance: tolOut,
        suppressedByChange,
      };
    },

    /**
     * deriveSensitivity(comps) →
     *   { label: 'thin'|'flat'|'sloped', slope?, perPct?, comps, distinctBonus }
     *
     * v0.3.14 slice 19b (#286). Reads the bonus-%/price slope from the comp
     * set instead of guessing. With ≥SENSITIVITY_MIN_COMPS comps spanning
     * ≥SENSITIVITY_MIN_DISTINCT distinct bonus values, fits a least-squares
     * slope through (bonusValue, median-price-at-that-bonus) and labels the
     * base 'sloped' when |slope| exceeds SENSITIVITY_FLAT_FRACTION of the
     * comp median, else 'flat'. Otherwise 'thin' (no slope number).
     *
     * comps – Array<{ price, bonusValue }>. Caller passes the already-filtered
     *         comp set used elsewhere on the card.
     */
    deriveSensitivity(comps) {
      const list = (comps || []).filter(c => c
        && Number.isFinite(Number(c.price)) && Number(c.price) > 0
        && Number.isFinite(Number(c.bonusValue)));
      const distinctBonus = new Set(list.map(c => Number(c.bonusValue))).size;
      if (list.length < SENSITIVITY_MIN_COMPS || distinctBonus < SENSITIVITY_MIN_DISTINCT) {
        return { label: 'thin', comps: list.length, distinctBonus };
      }
      const byBonus = new Map();
      for (const c of list) {
        const k = Number(c.bonusValue);
        if (!byBonus.has(k)) byBonus.set(k, []);
        byBonus.get(k).push(Number(c.price));
      }
      const points = [...byBonus.entries()]
        .map(([b, prices]) => ({ b, p: _median(prices) }))
        .sort((a, b) => a.b - b.b);
      const n = points.length;
      const meanX = points.reduce((s, pt) => s + pt.b, 0) / n;
      const meanY = points.reduce((s, pt) => s + pt.p, 0) / n;
      let num = 0, den = 0;
      for (const pt of points) {
        num += (pt.b - meanX) * (pt.p - meanY);
        den += (pt.b - meanX) * (pt.b - meanX);
      }
      const slope = den > 0 ? num / den : 0;
      const median = _median(list.map(c => Number(c.price))) || 0;
      const threshold = Math.abs(median) * SENSITIVITY_FLAT_FRACTION;
      if (Math.abs(slope) <= threshold) {
        return { label: 'flat', slope, perPct: slope, comps: list.length, distinctBonus };
      }
      return { label: 'sloped', slope, perPct: slope, comps: list.length, distinctBonus };
    },

    /**
     * fetchComps(item, intelSettings) → Promise<{ cleared, asking }>
     *
     * Orchestrates Supabase (auction-cleared sales) and weav3r (live item-market
     * listings) in parallel and returns them as two distinct arrays — never
     * blended (PRD Story 5/6, issue #267). `cleared` drives action math;
     * `asking` is shown as an informational spread line.
     * Network errors degrade to empty arrays — never throws (PRD Story 10).
     *
     * item            – { itemName, bonuses: [{name,value},...], quality, category? }
     * intelSettings   – defaults to MEM.intel
     */
    async fetchComps(item, intelSettings) {
      const intel    = intelSettings || MEM.intel;
      const bonuses  = ((item && item.bonuses) || []).filter(b => b && b.name);
      const itemName = (item && item.itemName) || '';

      const supabaseQuery = {
        limit: 20, offset: 0,
        sort_by: 'timestamp', sort_order: 'desc',
      };
      if (itemName) supabaseQuery.item_name = itemName;

      // Bonus id only (no value range): the widener + drilldown narrow on-card.
      // Without a resolved id the value filter would collapse the comp set —
      // mirrors Price Checker behaviour.
      bonuses.slice(0, 2).forEach((b, i) => {
        const lo  = String(b.name).toLowerCase();
        const id  = BONUS_NAME_TO_ID[lo] != null
          ? BONUS_NAME_TO_ID[lo]
          : BONUS_NAME_TO_ID[lo.replace(/[\s-]/g, '')];
        if (id == null) return;
        if (i === 0) supabaseQuery.bonus1_id = id;
        else         supabaseQuery.bonus2_id = id;
      });

      const [clearedRaw, listings] = await Promise.all([
        SupabaseClient.search(supabaseQuery).then(r => r.auctions || []).catch(() => []),
        ListingsFetcher.fetch(item).catch(() => ({ market: [], bazaar: [] })),
      ]);

      // Stamp every same-base comp with its source baseName so downstream
      // can distinguish strict from widened-base rows after we merge.
      const cleared = clearedRaw.map(c => Object.assign({}, c, {
        baseName: c.item_name || itemName,
      }));

      // v0.3.0 slice 19d (#288) — King's order-of-ops step 3: when same-base
      // cleared comps stay <5, widen to adjacent tiers (one stronger + one
      // weaker). Capped at 2 extra Supabase calls. Each base-widen comp is
      // tagged `provenance: 'widenedBase'` so the card + SOLD ladder can
      // surface it distinctly. `widenedBase` returns the resolved labels for
      // the ref-line "widened base to {…}" surface.
      const widenedBase = [];
      const baseExtras  = [];
      if (cleared.length < 5) {
        const dict = ItemClassifier.getDict();
        const neighbours = resolveAdjacentBases(itemName, intel);
        for (const n of neighbours) {
          const resolved = _resolveBaseItemName(n.label, dict);
          if (!resolved) continue;
          const q = Object.assign({}, supabaseQuery, { item_name: resolved });
          try {
            const r = await SupabaseClient.search(q);
            const extras = (r.auctions || []).map(c => Object.assign({}, c, {
              baseName: resolved,
              provenance: 'widenedBase',
            }));
            if (extras.length) {
              baseExtras.push(...extras);
              widenedBase.push(resolved);
            }
          } catch (_) { /* network failure → just skip this neighbour */ }
        }
      }

      // `asking` keeps its legacy combined shape for callers that haven't moved
      // to the listings object yet. Listings stay split for the LISTED ladder.
      const asking = (listings.market || []).concat(listings.bazaar || []);
      return {
        cleared: cleared.concat(baseExtras),
        asking,
        listings,
        widenedBase,
      };
    },
  };

  // ─── BBEngine — Bunker Bucks floor pricing ──────────────────────────────────
  // Pure `calculateFloor` + table; impure `fetchBBRate` ports the harmonic-mean
  // 5-cache rate from torn-rw-auction-advisor-v1.user.js. Floor is informational
  // in v0.3.0 slice 1 — verdict math is untouched.
  //
  // BB_MULTIPLIERS: rows = item class, cols = rarity. Orange/red weapons take a
  // 1.5× multiplier when the piece carries 2 bonuses (`orange2` / `red2`). The
  // weapon-tier table is sourced from the Big Al's Bunker wiki; armor is
  // rarity-only per the Step 2 pricing doc.
  const BB_MULTIPLIERS = {
    armor:             { yellow: 12, orange: 26, red: 108 },
    pistol:            { yellow: 4,  orange: 12, orange2: 18, red: 36,  red2: 54  },
    smg:               { yellow: 4,  orange: 12, orange2: 18, red: 36,  red2: 54  },
    club:              { yellow: 6,  orange: 18, orange2: 27, red: 54,  red2: 81  },
    piercing:          { yellow: 6,  orange: 18, orange2: 27, red: 54,  red2: 81  },
    slashing:          { yellow: 6,  orange: 18, orange2: 27, red: 54,  red2: 81  },
    shotgun:           { yellow: 10, orange: 30, orange2: 45, red: 90,  red2: 135 },
    rifle:             { yellow: 10, orange: 30, orange2: 45, red: 90,  red2: 135 },
    'machine gun':     { yellow: 14, orange: 42, orange2: 63, red: 126, red2: 189 },
    'heavy artillery': { yellow: 14, orange: 42, orange2: 63, red: 126, red2: 189 },
  };

  // All 5 combat caches with their BB yields. Per-cache $/BB = price / bb;
  // medium/heavy caches typically beat Small Arms on $/BB and pull the
  // harmonic-mean rate below the small-arms-only number.
  const COMBAT_CACHES = [
    { name: 'Small Arms Cache',  bb: 20 },
    { name: 'Melee Cache',       bb: 30 },
    { name: 'Medium Arms Cache', bb: 50 },
    { name: 'Armor Cache',       bb: 60 },
    { name: 'Heavy Arms Cache',  bb: 70 },
  ];

  const BB_RATE_TTL_MS = 60 * 60 * 1000; // 1h

  const BBEngine = {
    MULTIPLIERS: BB_MULTIPLIERS,
    COMBAT_CACHES,
    /**
     * calculateFloor(itemClass, rarity, bbRate, opts?) → number|null
     * itemClass — 'armor' | 'pistol' | 'smg' | 'club' | 'piercing' | 'slashing'
     *             | 'shotgun' | 'rifle' | 'machine gun' | 'heavy artillery'
     * rarity    — 'yellow' | 'orange' | 'red'
     * bbRate    — $/BB (cache price ÷ bb count)
     * opts.bonusCount — 1 (default) | 2 (orange/red weapons only)
     * Returns null on missing/invalid rate, unknown class, or unknown rarity.
     */
    calculateFloor(itemClass, rarity, bbRate, opts) {
      if (!bbRate || bbRate <= 0) return null;
      const cls = String(itemClass == null ? '' : itemClass).toLowerCase().trim();
      const r   = String(rarity == null ? '' : rarity).toLowerCase().trim();
      const table = BB_MULTIPLIERS[cls];
      if (!table) return null;
      const twoBonus = opts && opts.bonusCount === 2 && (r === 'orange' || r === 'red');
      const key = twoBonus ? r + '2' : r;
      const mult = table[key];
      if (!mult) return null;
      return mult * bbRate;
    },
    /**
     * fetchBBRate({ force }?) → Promise<{ rate, cachePrices, fetchedAt } | null>
     * Harmonic-mean weighted across all 5 combat caches. Result persisted to
     * `rwth_bb_rate` with 1h TTL. Returns cached value when fresh unless
     * force=true. Failures return null and set MEM.fetchError.
     */
    async fetchBBRate(opts) {
      const force = !!(opts && opts.force);
      const cached = Store.get('rwth_bb_rate');
      if (!force && cached && cached.fetchedAt
          && Date.now() - cached.fetchedAt < BB_RATE_TTL_MS) {
        MEM.bbRate = cached;
        return cached;
      }
      const key = (MEM.settings && MEM.settings.apiKey) || '';
      if (!key || /^#+PDA-APIKEY#+$/.test(key)) {
        MEM.fetchError = 'No API key — enter one in Settings';
        return null;
      }
      try {
        // Resolve cache item IDs once via the Torn items dictionary.
        const cacheNames = COMBAT_CACHES.map(c => c.name);
        let cacheIds = Store.get('rwth_cache_item_ids') || {};
        const missing = cacheNames.filter(n => !cacheIds[n]);
        if (missing.length) {
          const r = await fetch(`${API_BASE}/torn/?selections=items&key=${encodeURIComponent(key)}&comment=rwth-bb`);
          const d = await r.json();
          if (d && d.error) { MEM.fetchError = `BB items: ${d.error.error}`; return null; }
          const items = (d && d.items) || {};
          for (const id of Object.keys(items)) {
            const it = items[id];
            if (it && cacheNames.includes(it.name)) cacheIds[it.name] = parseInt(id, 10);
          }
          const stillMissing = cacheNames.filter(n => !cacheIds[n]);
          if (stillMissing.length) {
            MEM.fetchError = `Cache IDs not found: ${stillMissing.join(', ')}`;
            return null;
          }
          Store.set('rwth_cache_item_ids', cacheIds);
        }
        const results = await Promise.all(COMBAT_CACHES.map(async ({ name, bb }) => {
          const id = cacheIds[name];
          const r = await fetch(`${API_BASE}/v2/market/${id}/itemmarket?limit=1&key=${encodeURIComponent(key)}&comment=rwth-bb`);
          const d = await r.json();
          if (d && d.error) return null;
          const price = d && d.itemmarket && d.itemmarket.listings && d.itemmarket.listings[0]
            ? d.itemmarket.listings[0].price : null;
          return price != null && price > 0 ? { name, price, bb, rate: price / bb } : null;
        }));
        const valid = results.filter(Boolean);
        if (!valid.length) { MEM.fetchError = 'No cache listings for BB rate'; return null; }
        // Harmonic mean — cheapest $/BB cache pulls the rate down.
        const invSum = valid.reduce((s, x) => s + 1 / x.rate, 0);
        const rate   = valid.length / invSum;
        const cachePrices = Object.fromEntries(valid.map(x => [x.name, x.price]));
        const out = { rate, cachePrices, fetchedAt: Date.now() };
        MEM.bbRate = out;
        Store.set('rwth_bb_rate', out);
        return out;
      } catch (err) {
        MEM.fetchError = `fetchBBRate error: ${err && err.message}`;
        return null;
      }
    },
  };

  // ─── DomScanner — pure parse of an expanded item-info block ────────────────
  // Mirrors the Price Checker's parseAuctionRow + parseItemMarketRow, but
  // normalises bonuses to { name, value } so PricingEngine.fetchComps can
  // resolve the id via BONUS_NAME_TO_ID. Pure: the impure caller hands in DOM
  // nodes; exposed via __RwthPure for fixture testing.
  const DomScanner = {
    parseItemMarketRow(container) {
      const out = { itemName: '', parsedBonuses: [], quality: null, itemType: 'weapon' };
      if (!container || !container.querySelector) return out;
      const nameEl = container.querySelector('.description___xJ1N5 .bold')
        || container.querySelector('[class*="description___"] .bold');
      if (nameEl) out.itemName = nameEl.textContent.trim().replace(/^The\s+/i, '');

      const properties = container.querySelectorAll(
        'li.propertyWrapper___xSOH1, li[class*="propertyWrapper___"]');
      for (const prop of properties) {
        const titleEl = prop.querySelector('[class*="title___"]');
        if (!titleEl) continue;
        const title = titleEl.textContent.trim();
        if (title === 'Damage:') out.itemType = 'weapon';
        else if (title === 'Armor:') out.itemType = 'armor';
        if (title === 'Quality:') {
          const v = prop.querySelector('[aria-label*="Quality"]');
          const m = v && (v.getAttribute('aria-label') || '').match(/([\d.]+)%?\s*Quality/i);
          if (m) out.quality = parseFloat(m[1]);
        }
        if (title === 'Bonus:') {
          const v = prop.querySelector('[aria-label*="Bonus"]');
          const aria = v ? (v.getAttribute('aria-label') || '') : '';
          const m1 = aria.match(/([\d.]+)\s*(?:%|T)?\s*(.+?)\s*Bonus/i);
          if (m1) out.parsedBonuses.push({ name: m1[2].trim(), value: parseFloat(m1[1]) });
          else {
            const m2 = aria.match(/^\s*(.+?)\s*Bonus/i);
            if (m2) out.parsedBonuses.push({ name: m2[1].trim(), value: null });
          }
        }
      }
      return out;
    },
    parseAuctionRow(li) {
      if (!li || !li.querySelector) return null;
      const titleEl = li.querySelector('.item-name');
      const titleName = titleEl ? titleEl.textContent.trim() : '';
      // Rarity from glow class on the li or any descendant; ports
      // torn-rw-auction-advisor-v1.user.js's RARITY_GLOWS detection.
      let rarity = null;
      try {
        const glowTarget = li.matches && li.matches('[class*="glow-"]')
          ? li : li.querySelector('[class*="glow-"]');
        if (glowTarget && glowTarget.classList) {
          for (const r of ['red', 'orange', 'yellow']) {
            if (glowTarget.classList.contains('glow-' + r)) { rarity = r; break; }
          }
        }
      } catch {}
      const currentBid = readAuctionListingPrice(li);
      const info = li.querySelector('.show-item-info');
      if (!info) {
        return { itemName: titleName, parsedBonuses: [], quality: null, itemType: 'weapon', rarity, currentBid };
      }
      const inner = DomScanner.parseItemMarketRow(info);
      return {
        itemName: titleName || inner.itemName,
        parsedBonuses: inner.parsedBonuses,
        quality: inner.quality,
        itemType: inner.itemType,
        rarity,
        currentBid,
      };
    },
  };

  // Best-effort current price for an auction li. Scans likely price-bearing
  // nodes inside the row and returns the largest dollar value found (current
  // bid / buyout). Null when nothing parseable is on the row.
  function readAuctionListingPrice(li) {
    if (!li || !li.querySelectorAll) return null;
    const nodes = li.querySelectorAll(
      '[class*="price"], [class*="Price"], [class*="cost"], [class*="Cost"], '
      + '[class*="bid"], [class*="Bid"], [class*="buyout"], [class*="Buyout"]');
    let best = null;
    for (const el of nodes) {
      const txt = (el.textContent || '').replace(/[,\s]/g, '');
      const m = txt.match(/\$(\d+)/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && (best == null || n > best)) best = n;
      }
    }
    return best;
  }

  // Flatten a Supabase auction or weav3r weapon record to a verdict-ready
  // { price, quality } shape. Returns null if no usable price field.
  function compShape(c) {
    if (!c || typeof c !== 'object') return null;
    const p = Number(c.price != null ? c.price
              : c.final_price != null ? c.final_price
              : c.cost != null ? c.cost
              : c.buyout != null ? c.buyout : NaN);
    if (!Number.isFinite(p)) return null;
    const q = Number(c.quality != null ? c.quality
              : c.qualityPct != null ? c.qualityPct
              : c.stat_quality != null ? c.stat_quality : NaN);
    const tsRaw = c.timestamp != null ? c.timestamp
                : c.sold_at != null ? c.sold_at
                : c.created_at != null ? c.created_at : null;
    let timestamp = null;
    if (tsRaw != null) {
      const n = Number(tsRaw);
      if (Number.isFinite(n) && n > 0) timestamp = n < 1e12 ? n * 1000 : n;
      else { const d = Date.parse(tsRaw); if (Number.isFinite(d)) timestamp = d; }
    }
    // Supabase auction rows carry the primary bonus % in a
    // `bonus_values: [{bonus_id, bonus_value}, …]` array (parallel to
    // `bonus_ids`), not a flat `bonus1_value`. Without this branch every
    // cleared comp shaped `bonusValue: null`, and the exact-bonus clamp in
    // CompWidener.inBand silently dropped the entire set → 0 cleared (#292).
    const bvFromArray = (Array.isArray(c.bonus_values) && c.bonus_values.length
                         && c.bonus_values[0] && c.bonus_values[0].bonus_value != null)
      ? c.bonus_values[0].bonus_value : null;
    const bvRaw = c.bonusValue != null ? c.bonusValue
                : c.bonus1_value != null ? c.bonus1_value
                : c.bonusPct != null ? c.bonusPct
                : bvFromArray != null ? bvFromArray : null;
    const bv = bvRaw != null ? Number(bvRaw) : NaN;
    const out = {
      price: p,
      quality: Number.isFinite(q) ? q : 0,
      timestamp,
      bonusValue: Number.isFinite(bv) ? bv : null,
    };
    // v0.3.0 slice 19d (#288) — carry base-widen provenance + the source
    // item name so the SOLD ladder + ref line can mark widened-base rows.
    if (c.provenance != null) out.provenance = c.provenance;
    if (c.baseName != null)   out.baseName   = String(c.baseName);
    return out;
  }

  // ─── InlineRenderer (impure) ────────────────────────────────────────────────
  // Idempotent badge slot inside an expanded item-info block. One badge per
  // row; subsequent renders overwrite the existing element.
  const InlineRenderer = {
    BADGE_CLASS: 'rwth-auction-badge',
    _slot(infoEl) {
      if (!infoEl) return null;
      const anchor = infoEl.querySelector('.descriptionWrapper___Lh0y0') || infoEl;
      let badge = anchor.querySelector(':scope > .' + InlineRenderer.BADGE_CLASS);
      if (!badge) {
        badge = document.createElement('div');
        badge.className = InlineRenderer.BADGE_CLASS;
        if (!anchor.style.position) anchor.style.position = 'relative';
        anchor.appendChild(badge);
      }
      return badge;
    },
    renderAuctionBadge(infoEl, state) {
      const badge = InlineRenderer._slot(infoEl);
      if (!badge) return;
      const s = state || {};
      if (s.loading) {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-loading';
        badge.textContent = '⟳ checking…';
        return;
      }
      // v0.3.0 slice 9 — BonusTrashGuard short-circuit. No fetch happened;
      // the card just states the curated exclusion so the row is not silent.
      if (s.skipped === 'trash') {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-none';
        const which = s.bonusName ? ` (${s.bonusName})` : '';
        badge.textContent = `skipped — low-value bonus${which}`;
        return;
      }
      if (s.error) {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-none';
        const askPart = (s.askingCount && s.askingMedian != null)
          ? ` · ${s.askingCount} for sale (typical ${fmtChatPrice(s.askingMedian)})` : '';
        badge.textContent = s.error + askPart;
        return;
      }
      const v = s.verdict;
      if (!v || v.tier === 'none') {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-none';
        const askPart = (s.askingCount && s.askingMedian != null)
          ? ` · ${s.askingCount} for sale (typical ${fmtChatPrice(s.askingMedian)})` : '';
        badge.textContent = 'no comparable sales' + askPart;
        return;
      }
      const labels = { good: 'Good buy', fair: 'Fair', over: 'Overpriced', thin: 'Few sales' };
      const tierLabel = labels[v.tier] || v.tier;
      badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-' + v.tier;
      const parts = [];
      if (s.classTag) parts.push(s.classTag);
      parts.push(tierLabel);
      if (s.listingPrice != null && v.reference != null) {
        parts.push(`asking ${fmtChatPrice(s.listingPrice)} vs typical ${fmtChatPrice(v.reference)}`);
      } else if (v.reference != null) {
        parts.push(`typical ${fmtChatPrice(v.reference)}`);
      }
      parts.push(`(${v.compsUsed} similar sales · ±${v.tolerance}% bonus)`);
      if (v.slopeProjection != null && s.listingQuality != null) {
        parts.push(`projected ${fmtChatPrice(v.slopeProjection)} at ${s.listingQuality}% quality`);
      }
      if (s.bbFloor != null) {
        parts.push(`bazaar floor ${fmtChatPrice(s.bbFloor)}`);
      }
      if (s.askingCount && s.askingMedian != null) {
        parts.push(`${s.askingCount} for sale (typical ${fmtChatPrice(s.askingMedian)})`);
      }
      badge.textContent = parts.join(' · ');
    },
    /**
     * renderMarketFloorCard(infoEl, ctx) — no-cleared-comp fallback (#291).
     * When cleared comps are zero but asking listings exist, anchor a verdict
     * on the asking floor via PricingEngine.deductionChain (single-cut model)
     * instead of the dead-end `no comp` one-liner. Honest about provenance:
     * labels the estimate market-floor / exact-bonus / no-cleared-comp so the
     * user knows it is weaker than a cleared-comp card.
     *   ctx: { classTag, currentBid, marketFloor, askingCount, askingMedian,
     *          askingComps?, listingQuality? }
     */
    renderMarketFloorCard(infoEl, ctx) {
      const badge = InlineRenderer._slot(infoEl);
      if (!badge) return;
      const s = ctx || {};
      const chain = PricingEngine.deductionChain({ anchor: s.marketFloor });
      badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-fair';
      badge.textContent = '';
      const cb = Number(s.currentBid);

      // ── headline: class tag · buy max · room/over vs current bid ────────
      const head = document.createElement('div');
      head.className = 'rwth-card-headline';
      if (s.classTag) {
        const tag = document.createElement('span');
        tag.className = 'rwth-card-classtag';
        tag.textContent = s.classTag;
        head.appendChild(tag);
      }
      const buyEl = document.createElement('span');
      buyEl.className = 'rwth-card-buymax';
      buyEl.textContent = chain ? `Bid up to ${fmtChatPrice(chain.buyMax)}` : 'Bid up to —';
      head.appendChild(buyEl);
      if (chain && Number.isFinite(cb)) {
        const d = chain.buyMax - cb;
        const delta = document.createElement('span');
        if (d >= 0) { delta.className = 'rwth-card-room'; delta.textContent = `${fmtChatPrice(d)} under your max`; }
        else        { delta.className = 'rwth-card-over'; delta.textContent = `${fmtChatPrice(-d)} over your max`; }
        head.appendChild(delta);
      }
      badge.appendChild(head);

      // ── provenance note — weaker than a cleared-comp card ───────────────
      const note = document.createElement('div');
      note.className = 'rwth-card-ref rwth-card-thin';
      note.textContent = 'Rough estimate — no completed sales yet, matched to your exact bonus';
      badge.appendChild(note);

      if (chain) {
        // ── single-cut deduction chain ────────────────────────────────────
        const ded = document.createElement('div');
        ded.className = 'rwth-card-ref rwth-card-ded';
        ded.textContent =
          `Floor price ${fmtChatPrice(chain.anchor)} − ${Math.round(chain.tax * 100)}% tax`
          + ` − ${Math.round(chain.mug * 100)}% mug risk − ${Math.round(chain.margin * 100)}% your profit`
          + ` → bid up to ${fmtChatPrice(chain.buyMax)}`;
        badge.appendChild(ded);

        // ── explicit buy/pass verdict ─────────────────────────────────────
        const verd = document.createElement('div');
        verd.className = 'rwth-card-ref rwth-card-verdict';
        if (Number.isFinite(cb)) {
          verd.textContent = cb <= chain.buyMax
            ? `BUY — current bid ${fmtChatPrice(cb)} is within your max of ${fmtChatPrice(chain.buyMax)}`
            : `PASS — current bid ${fmtChatPrice(cb)} is over your max of ${fmtChatPrice(chain.buyMax)}`;
        } else {
          verd.textContent = `Bid up to ${fmtChatPrice(chain.buyMax)}`;
        }
        badge.appendChild(verd);
      }

      // ── bazaar/market floor cross-check + low-margin warning (#300) ────
      const crossEls = InlineRenderer._floorCrossCheckEls(s.marketFloor, s.bazaarCheapest);
      for (const el of crossEls) badge.appendChild(el);

      // ── asking floor listings with per-listing quality annotation (#294) ──
      const askFloor = document.createElement('div');
      askFloor.className = 'rwth-card-askfloor';
      const floorEls = InlineRenderer._floorListingEls(s.askingComps, s.listingQuality, 3);
      if (floorEls.length) {
        const hdr = document.createElement('div');
        hdr.className = 'rwth-card-ref';
        const parts = [];
        if (s.askingMedian != null) parts.push(`typical ${fmtChatPrice(s.askingMedian)}`);
        if (s.askingCount) parts.push(`${s.askingCount} for sale`);
        hdr.textContent = 'For sale now: ' + parts.join(' · ');
        askFloor.appendChild(hdr);
        for (const el of floorEls) askFloor.appendChild(el);
      } else {
        const parts = [];
        if (s.marketFloor != null)  parts.push(`cheapest ${fmtChatPrice(s.marketFloor)}`);
        if (s.askingMedian != null) parts.push(`typical ${fmtChatPrice(s.askingMedian)}`);
        if (s.askingCount)          parts.push(`${s.askingCount} for sale`);
        askFloor.className = 'rwth-card-ladder';
        askFloor.textContent = 'For sale now: ' + parts.join(' · ');
      }
      badge.appendChild(askFloor);
    },
    /**
     * renderTwoTierCard(infoEl, ctx) — v0.3.0 two-tier card.
     * ctx is the recompute context (PRD #265 user stories 21–23, issue #272):
     *   { itemClass, classTag, bbFloor, currentBid, listingQuality,
     *     primaryBonusName, primaryBonusValue, strictTolerance,
     *     comps, marketCheapest, askingMedian, askingCount, margins }
     * The card stores ctx on the badge so the drilldown knobs can recompute
     * `buy / ladder / reference` client-side with no refetch.
     */
    renderTwoTierCard(infoEl, ctx) {
      const badge = InlineRenderer._slot(infoEl);
      if (!badge) return;
      badge._rwthCtx = ctx || {};
      let drill = InlineRenderer._drillState.get(badge);
      if (!drill) {
        const initQ = MEM.intel.qualityClampDefault ? 'exact' : 'auto';
        drill = { bonus: 'auto', quality: initQ, expanded: false, axis: 'bonus' };
        InlineRenderer._drillState.set(badge, drill);
      }
      InlineRenderer._paintCard(badge, drill);
    },
    _drillState: new WeakMap(),
    // #300 — bazaar floor beside the market floor as a cross-check, plus a
    // low-margin warning when the two are "similar". Similar = the floors sit
    // within SIMILAR_FLOORS_BAND of EACH OTHER (two-sided): the normal resale
    // cushion (bazaar ~5% under market) has collapsed. A bazaar floor far
    // ABOVE market is a *wide* spread, not a thin one, so it must NOT warn —
    // the original one-sided test (bazaar ≥ 90% of market) mislabelled that.
    // Display-only: bazaar never touches the anchor/tiering math (#296).
    // When `opts.bracketed` the floors are already restricted to the
    // candidate's bonus tier (like-for-like), so the line says so; otherwise
    // they're the raw cheapest listings. Returns [] when there's no bazaar
    // floor to compare against.
    _floorCrossCheckEls(marketFloor, bazaarFloor, opts) {
      const m = Number(marketFloor);
      const b = Number(bazaarFloor);
      if (!(Number.isFinite(b) && b > 0)) return [];
      const lead = (opts && opts.bracketed) ? 'At your bonus level' : 'Cheapest now';
      const els = [];
      const line = document.createElement('div');
      line.className = 'rwth-card-ref rwth-card-crosscheck';
      if (Number.isFinite(m) && m > 0) {
        line.textContent = `${lead} — market ${fmtChatPrice(m)} · bazaar ${fmtChatPrice(b)}`;
      } else {
        line.textContent = `${lead} — bazaar ${fmtChatPrice(b)}`;
      }
      els.push(line);
      if (Number.isFinite(m) && m > 0 && Math.abs(b - m) <= m * SIMILAR_FLOORS_BAND) {
        const warn = document.createElement('div');
        warn.className = 'rwth-card-ref rwth-card-lowmargin';
        const diffPct = Math.round(Math.abs(b - m) / m * 100);
        warn.textContent = diffPct <= 0
          ? 'Thin flip margin — bazaar and market floors are level right now'
          : `Thin flip margin — bazaar and market floors are within ${diffPct}% of each other right now`;
        els.push(warn);
      }
      return els;
    },
    _floorListingEls(askingComps, listingQuality, maxShow) {
      const sorted = (askingComps || [])
        .filter(c => Number.isFinite(Number(c.price)))
        .sort((a, b) => Number(a.price) - Number(b.price));
      const show = sorted.slice(0, maxShow || 3);
      const rest = sorted.length - show.length;
      const lq = Number(listingQuality);
      const hasLq = Number.isFinite(lq) && lq > 0;
      const els = [];
      for (const c of show) {
        const div = document.createElement('div');
        div.className = 'rwth-card-askfloor-row';
        const cq = Number(c.quality);
        const hasQ = Number.isFinite(cq) && cq > 0;
        let text = fmtChatPrice(c.price);
        if (hasQ) {
          text += ` at ${cq}% quality`;
          if (hasLq) {
            if (cq > lq) {
              text += ' — better quality than yours';
              div.classList.add('rwth-card-floor-beats');
            } else if (cq < lq) {
              text += ' — worse quality than yours';
              div.classList.add('rwth-card-floor-below');
            } else {
              text += ' — same quality as yours';
            }
          }
        }
        div.textContent = text;
        els.push(div);
      }
      if (rest > 0) {
        const more = document.createElement('div');
        more.className = 'rwth-card-askfloor-more';
        more.textContent = `+${rest} more for sale`;
        els.push(more);
      }
      return els;
    },
    _applyDrillFilters(comps, drill, ctx) {
      let arr = (comps || []).slice();
      const bv = Number(ctx.primaryBonusValue);
      const hasBonus = Number.isFinite(bv);
      if (drill.bonus !== 'auto' && drill.bonus !== 'all' && hasBonus) {
        let tol = null;
        if (drill.bonus === 'strict') {
          tol = Number.isFinite(Number(ctx.strictTolerance)) ? Number(ctx.strictTolerance) : 0;
        } else if (drill.bonus === 'pm1') tol = 1;
        else if (drill.bonus === 'pm3') tol = 3;
        if (tol != null) {
          arr = arr.filter(c => c.bonusValue != null && Math.abs(Number(c.bonusValue) - bv) <= tol);
        }
      }
      const lq = Number(ctx.listingQuality);
      const hasQ = Number.isFinite(lq) && lq > 0;
      if (drill.quality !== 'auto' && drill.quality !== 'all' && hasQ) {
        if (drill.quality === 'exact') {
          const bucket = Math.floor(lq / 10) * 10;
          arr = arr.filter(c => c.quality != null && Math.floor(Number(c.quality) / 10) * 10 === bucket);
        } else if (drill.quality === 'pm10') {
          const w = lq * 0.10;
          arr = arr.filter(c => c.quality != null && Math.abs(Number(c.quality) - lq) <= w);
        } else if (drill.quality === 'pm25') {
          const w = lq * 0.25;
          arr = arr.filter(c => c.quality != null && Math.abs(Number(c.quality) - lq) <= w);
        }
      }
      return arr;
    },
    _paintCard(badge, drill) {
      const s = badge._rwthCtx || {};
      const rawComps = Array.isArray(s.comps) ? s.comps : [];
      const filtered = InlineRenderer._applyDrillFilters(rawComps, drill, s);
      const useAutoRef = drill.bonus === 'auto';

      // v0.3.29 (#298) — anchor the buy max + deduction on the bonus-% bracket
      // the candidate falls into, not the global cheapest listing. Market
      // listings only (bazaar excluded from anchor math — PRD #296). Falls back
      // to the global cheapest when the resolver can't tier (no listings / no
      // bonus data). Both the headline and the deduction line read `anchorPrice`
      // so they agree by construction.
      const marketListings = (Array.isArray(s.askingComps) ? s.askingComps : [])
        .filter(c => (c.source || 'market') === 'market')
        .map(c => ({ price: c.price, bonusValue: c.bonusValue }));
      const bracket = resolveMarketAnchor(marketListings, s.primaryBonusValue);
      const anchorPrice = (bracket && bracket.anchor != null)
        ? bracket.anchor : s.marketCheapest;

      // #300 follow-up — restrict the cross-check floors to the candidate's
      // bonus bracket so market and bazaar are compared like-for-like (not a
      // weak low-bonus market piece vs a strong high-bonus bazaar piece). The
      // market side reuses the bracket anchor already shown as "Item market";
      // the bazaar side is the cheapest bazaar listing whose bonus falls in the
      // SAME tier window. Bazaar still never feeds the anchor/tiering math
      // (#296) — this only filters which bazaar listing we display.
      let crossMarketFloor, crossBazaarFloor, crossBracketed;
      if (bracket && bracket.tier && Number.isFinite(Number(s.primaryBonusValue))) {
        const lo = bracket.tier.thresholdBonus;
        let hi = Infinity;
        for (const t of (bracket.tiers || [])) {
          if (t.thresholdBonus > lo && t.thresholdBonus < hi) hi = t.thresholdBonus;
        }
        const bazaarInBracket = (Array.isArray(s.askingComps) ? s.askingComps : [])
          .filter(c => c.source === 'bazaar')
          .map(c => ({ price: Number(c.price), bonus: Number(c.bonusValue) }))
          .filter(c => Number.isFinite(c.price) && c.price > 0
                       && Number.isFinite(c.bonus) && c.bonus >= lo && c.bonus < hi);
        crossMarketFloor = anchorPrice;
        crossBazaarFloor = bazaarInBracket.length
          ? Math.min(...bazaarInBracket.map(c => c.price)) : null;
        crossBracketed = true;
      } else {
        // No bracket / no bonus data → fall back to raw cheapest each side.
        crossMarketFloor = s.marketCheapest;
        crossBazaarFloor = s.bazaarCheapest;
        crossBracketed = false;
      }

      const buy = PricingEngine.buyTarget({
        itemClass: s.itemClass, comps: filtered,
        currentBid: s.currentBid, bbFloor: s.bbFloor,
        marketAnchor: anchorPrice,
      });
      // v0.3.0 slice 19d (#288) — thin-reference fallback. After base-widen,
      // <5 total comps means we cannot anchor a headline buy max — show the
      // range only and label the card "judgment call".
      const thinReference = filtered.length > 0 && filtered.length < 5;
      const ladder = PricingEngine.sellLadder({
        itemClass: s.itemClass, comps: filtered,
        marketAnchor: anchorPrice,
        marketCheapest: s.marketCheapest,
        buyCost: s.buyCost != null ? s.buyCost : (s.currentBid || 0),
      });
      const reference = PricingEngine.compReference(filtered, {
        itemClass: s.itemClass,
        targetBonusValue: useAutoRef ? s.primaryBonusValue : null,
        strictTolerance: useAutoRef ? s.strictTolerance : null,
        bonusName: s.primaryBonusName,
      });

      badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-good';
      badge.textContent = '';

      // ── headline ───────────────────────────────────────────────────────
      const head = document.createElement('div');
      head.className = 'rwth-card-headline';
      if (s.classTag) {
        const tag = document.createElement('span');
        tag.className = 'rwth-card-classtag';
        tag.textContent = s.classTag;
        head.appendChild(tag);
      }
      const buyEl = document.createElement('span');
      buyEl.className = 'rwth-card-buymax';
      if (s.itemClass === 'duneRiotArmor' && buy.floor != null) {
        const tol = buy.tolerance != null ? buy.tolerance : 0;
        buyEl.textContent = `Bazaar floor ${fmtChatPrice(buy.floor)} + ${fmtChatPrice(tol)} room`;
      } else if (thinReference && Array.isArray(buy.range)) {
        // Slice 19d: suppress headline anchor — range only when comps stay thin.
        buyEl.textContent = `Bid ${fmtChatPrice(buy.range[0])}–${fmtChatPrice(buy.range[1])}`;
      } else if (buy.max == null && Array.isArray(buy.range)) {
        buyEl.textContent = `Bid ${fmtChatPrice(buy.range[0])}–${fmtChatPrice(buy.range[1])}`;
      } else if (buy.max != null) {
        buyEl.textContent = `Bid up to ${fmtChatPrice(buy.max)}`;
        if (Array.isArray(buy.range)) {
          buyEl.textContent += ` (${fmtChatPrice(buy.range[0])}–${fmtChatPrice(buy.range[1])})`;
        }
      } else {
        buyEl.textContent = 'Bid up to —';
      }
      head.appendChild(buyEl);
      if (buy.medianTarget != null) {
        const medEl = document.createElement('span');
        medEl.className = 'rwth-card-buymed';
        medEl.textContent = `typical ${fmtChatPrice(buy.medianTarget)}`;
        head.appendChild(medEl);
      }
      // Auction-clearing reference (what it actually sells for at auction) —
      // shown raw, NOT deducted. The bid sits against this, not derived from it.
      if (buy.auctionMedian != null) {
        const amEl = document.createElement('span');
        amEl.className = 'rwth-card-buymed';
        amEl.textContent = `sells ~${fmtChatPrice(buy.auctionMedian)} at auction`;
        head.appendChild(amEl);
      }
      if (s.itemClass !== 'duneRiotArmor' && s.bbFloor != null && buy.max != null) {
        const fl = document.createElement('span');
        fl.className = 'rwth-card-bbfloor';
        fl.textContent = `bazaar floor ${fmtChatPrice(s.bbFloor)}`;
        head.appendChild(fl);
      }
      if (buy.currentBidDelta != null) {
        const d = buy.currentBidDelta;
        const delta = document.createElement('span');
        if (d >= 0) {
          delta.className = 'rwth-card-room';
          delta.textContent = `${fmtChatPrice(d)} under your max`;
        } else {
          delta.className = 'rwth-card-over';
          delta.textContent = `${fmtChatPrice(-d)} over your max`;
        }
        head.appendChild(delta);
      }
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'rwth-card-drill-toggle';
      toggleBtn.textContent = drill.expanded ? '▲ hide' : '▼ details';
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        drill.expanded = !drill.expanded;
        InlineRenderer._paintCard(badge, drill);
      });
      head.appendChild(toggleBtn);
      badge.appendChild(head);

      // ── reference summary ─────────────────────────────────────────────
      if (reference && (reference.count > 0 || reference.widenedBonusCount || reference.suppressedByChange)) {
        const refEl = document.createElement('div');
        refEl.className = 'rwth-card-ref';
        const parts = [];
        if (reference.widenedBonusCount > 0) {
          parts.push(`based on ${reference.strictCount} close + ${reference.widenedBonusCount} within ±${reference.widenedTolerance}% bonus of yours`);
        } else {
          const n = reference.count;
          let head2 = `based on ${n} similar sale${n === 1 ? '' : 's'}`;
          if (reference.tolerance != null) {
            head2 += reference.tolerance === 0
              ? ' (exact bonus match)'
              : ` (within ±${reference.tolerance}% bonus of yours)`;
          }
          parts.push(head2);
        }
        // v0.3.0 slice 19d (#288) — surface adjacent-base widening when it fired.
        const widenedBaseList = Array.isArray(s.widenedBase) ? s.widenedBase : [];
        if (widenedBaseList.length) {
          parts.push(`also using ${widenedBaseList.join(', ')}`);
        }
        if (reference.recencyDays != null) {
          parts.push(reference.recencyDays >= 365
            ? `~${Math.round(reference.recencyDays / 365)}yr old`
            : `~${Math.round(reference.recencyDays / 30)}mo old`);
        }
        if (reference.suppressedByChange > 0) {
          parts.push(`skipped ${reference.suppressedByChange} (bonus since nerfed)`);
        }
        if (drill.bonus !== 'auto' || drill.quality !== 'auto') parts.push('your filters applied');
        refEl.textContent = parts.join(' · ');
        badge.appendChild(refEl);
      }
      // v0.3.0 slice 19d (#288) — thin-reference label. Surfaces below the ref
      // line whenever the comp set stayed under 5 even after base-widening,
      // so the user knows the headline range is a judgment call, not a fit.
      if (thinReference) {
        const thinEl = document.createElement('div');
        thinEl.className = 'rwth-card-ref rwth-card-thin';
        thinEl.textContent = 'few comparable sales — treat this as a rough guess';
        badge.appendChild(thinEl);
      }

      // ── derived sensitivity (slice 19b) ───────────────────────────────
      const sens = PricingEngine.deriveSensitivity(filtered);
      const sensEl = document.createElement('div');
      sensEl.className = 'rwth-card-sensitivity';
      if (sens.label === 'sloped') {
        sensEl.textContent = `each 1% of bonus is worth about ${fmtChatPrice(Math.abs(sens.perPct))} on this weapon`;
      } else if (sens.label === 'flat') {
        sensEl.textContent = 'bonus % barely changes the price on this weapon';
      } else {
        sensEl.textContent = 'not enough sales to tell how much bonus is worth';
      }
      badge.appendChild(sensEl);

      // ── deduction chain + verdict (slice 20e, #295) ───────────────────
      // Anchor the tax/mug/margin cut on the bonus-bracket market listing (the
      // inflated resale ask for the candidate's tier — v0.3.29/#298), not the
      // auction-comp median: deducting resale friction off an auction-cleared
      // price double-counts (see buyTarget). Reads the same `anchorPrice` as the
      // headline buy max, so the two never disagree.
      const chainAnchor = Number(anchorPrice);
      const chain = (Number.isFinite(chainAnchor) && chainAnchor > 0)
        ? PricingEngine.deductionChain({ anchor: chainAnchor }) : null;
      if (chain) {
        const ded = document.createElement('div');
        ded.className = 'rwth-card-ref rwth-card-ded';
        ded.textContent =
          `Market price ${fmtChatPrice(chain.anchor)} − ${Math.round(chain.tax * 100)}% tax`
          + ` − ${Math.round(chain.mug * 100)}% mug risk − ${Math.round(chain.margin * 100)}% your profit`
          + ` → bid up to ${fmtChatPrice(chain.buyMax)}`;
        badge.appendChild(ded);

        const cb = Number(s.currentBid);
        if (Number.isFinite(cb) && cb > 0) {
          const verd = document.createElement('div');
          verd.className = 'rwth-card-ref rwth-card-verdict';
          verd.textContent = cb <= chain.buyMax
            ? `BUY — current bid ${fmtChatPrice(cb)} is within your max of ${fmtChatPrice(chain.buyMax)}`
            : `PASS — current bid ${fmtChatPrice(cb)} is over your max of ${fmtChatPrice(chain.buyMax)}`;
          badge.appendChild(verd);
        }
      }

      // ── bazaar/market floor cross-check + low-margin warning (#300) ────
      const crossEls = InlineRenderer._floorCrossCheckEls(
        crossMarketFloor, crossBazaarFloor, { bracketed: crossBracketed });
      for (const el of crossEls) badge.appendChild(el);

      // ── typical days-to-clear (slice 10a, #275) ───────────────────────
      // Hidden until the class has ≥3 logged buy→sold sales; never blocks render.
      const velCls = velocityClass(s.rarity, /Armor$/.test(String(s.itemClass || '')));
      const baselineDays = VelocityTracker.classBaseline(velCls);
      if (baselineDays != null) {
        const vel = document.createElement('div');
        vel.className = 'rwth-card-ref rwth-card-velocity';
        const d = Math.round(baselineDays * 10) / 10;
        vel.textContent = `usually sells in about ${d} days`;
        badge.appendChild(vel);
      }

      // ── ladder ────────────────────────────────────────────────────────
      // Corrected venue model (see sellLadder): bazaar = forum < item market.
      // Auction is a range — relist floor → typical clearing. All rungs anchor
      // on the same bracket price the buy-max uses, so the card tells one story.
      const ladderEl = document.createElement('div');
      ladderEl.className = 'rwth-card-ladder';
      const fmtLadderRange = (lo, hi) => {
        const a2 = (lo == null) ? null : Number(lo);
        const b2 = (hi == null) ? null : Number(hi);
        if (a2 == null && b2 == null) return null;
        if (a2 == null) return fmtChatPrice(b2);
        if (b2 == null) return fmtChatPrice(a2);
        const loV = Math.min(a2, b2), hiV = Math.max(a2, b2);
        return loV === hiV ? fmtChatPrice(loV) : `${fmtChatPrice(loV)}–${fmtChatPrice(hiV)}`;
      };
      const rungs = [
        ['Auction',        fmtLadderRange(ladder.auctionFloor, ladder.auctionClearing)],
        ['Bazaar / Forum', ladder.bazaar != null ? fmtChatPrice(ladder.bazaar) : null],
        ['Item market',    ladder.market != null ? fmtChatPrice(ladder.market) : null],
        ['Floor',          ladder.floor  != null ? fmtChatPrice(ladder.floor)  : null],
      ];
      for (const [label, text] of rungs) {
        if (text == null) continue;
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = label;
        span.appendChild(b);
        span.appendChild(document.createTextNode(text));
        ladderEl.appendChild(span);
      }
      if (s.askingCount && s.askingMedian != null) {
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = `For sale (${s.askingCount})`;
        span.appendChild(b);
        span.appendChild(document.createTextNode(fmtChatPrice(s.askingMedian)));
        ladderEl.appendChild(span);
      }
      badge.appendChild(ladderEl);

      // ── asking floor listings with per-listing quality annotation (#294) ──
      const floorEls = InlineRenderer._floorListingEls(s.askingComps, s.listingQuality, 3);
      if (floorEls.length) {
        const askFloor = document.createElement('div');
        askFloor.className = 'rwth-card-askfloor';
        for (const el of floorEls) askFloor.appendChild(el);
        badge.appendChild(askFloor);
      }

      // ── drilldown ─────────────────────────────────────────────────────
      if (drill.expanded) {
        badge.appendChild(InlineRenderer._buildDrilldown(badge, drill, s, filtered, buy, reference));
      }
    },
    _buildDrilldown(badge, drill, ctx, filtered, buy, reference) {
      const wrap = document.createElement('div');
      wrap.className = 'rwth-card-drill';

      // axis toggle (slice 18) — bonus % vs quality % grouping for both ladders.
      const axisRow = document.createElement('div');
      axisRow.className = 'rwth-card-drill-knobs';
      const axisGroup = document.createElement('div');
      const axisLbl = document.createElement('label');
      axisLbl.textContent = 'group';
      axisGroup.appendChild(axisLbl);
      const axisOpts = [['bonus', 'bonus %'], ['quality', 'quality %']];
      for (const [val, txt] of axisOpts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = txt;
        if ((drill.axis || 'bonus') === val) b.classList.add('active');
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          drill.axis = val;
          InlineRenderer._paintCard(badge, drill);
        });
        axisGroup.appendChild(b);
      }
      axisRow.appendChild(axisGroup);
      wrap.appendChild(axisRow);

      // knobs
      const knobs = document.createElement('div');
      knobs.className = 'rwth-card-drill-knobs';
      const hasBonus = Number.isFinite(Number(ctx.primaryBonusValue));
      const hasQ     = Number.isFinite(Number(ctx.listingQuality)) && Number(ctx.listingQuality) > 0;
      const bonusOpts = [
        ['auto',   'auto',     true],
        ['strict', 'exact',    hasBonus],
        ['pm1',    '±1%',      hasBonus],
        ['pm3',    '±3%',      hasBonus],
        ['all',    'all',      true],
      ];
      const qualOpts = [
        ['auto',  'auto',  true],
        ['exact', 'exact', hasQ],
        ['pm10',  '±10%',  hasQ],
        ['pm25',  '±25%',  hasQ],
        ['all',   'all',   true],
      ];
      const makeGroup = (key, label, opts) => {
        const g = document.createElement('div');
        const lbl = document.createElement('label');
        lbl.textContent = label;
        g.appendChild(lbl);
        for (const [val, txt, enabled] of opts) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = txt;
          if (drill[key] === val) b.classList.add('active');
          if (!enabled) b.disabled = true;
          else b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            drill[key] = val;
            InlineRenderer._paintCard(badge, drill);
          });
          g.appendChild(b);
        }
        return g;
      };
      knobs.appendChild(makeGroup('bonus',   'bonus',   bonusOpts));
      knobs.appendChild(makeGroup('quality', 'quality', qualOpts));
      wrap.appendChild(knobs);

      // deduction math
      const math = document.createElement('div');
      math.className = 'rwth-card-drill-math';
      math.textContent = InlineRenderer._deductionMath(ctx, buy, reference, filtered);
      wrap.appendChild(math);

      // Unified evidence ladder — one table keyed by bonus % (or quality bucket)
      // co-locating each level's SOLD summary and FOR-SALE summary (#302 slice 1,
      // PRD #301). Verdict math still uses SOLD only; the for-sale side informs
      // spread (later slice). King: item-market asks run 15–25% above sellable.
      const axis = drill.axis === 'quality' ? 'quality' : 'bonus';
      const askingArr = Array.isArray(ctx.askingComps) ? ctx.askingComps : [];
      const cheapest = askingArr.reduce((m, c) => {
        const p = Number(c && c.price);
        if (!Number.isFinite(p) || p <= 0) return m;
        return m == null || p < m ? p : m;
      }, null);
      // v0.3.15 slice 19c (#287) — when the ref line ran auto bonus filtering,
      // surface which ladder rows are strict-only vs widened. Predicate is
      // omitted (no marker) when the user manually overrode the bonus knob.
      const strictTolNum = Number(ctx && ctx.strictTolerance);
      const targetBonusNum = Number(ctx && ctx.primaryBonusValue);
      const soldIsStrict = (drill.bonus === 'auto'
                            && Number.isFinite(strictTolNum)
                            && Number.isFinite(targetBonusNum))
        ? (c) => c && c.bonusValue != null && Number.isFinite(Number(c.bonusValue))
                  && Math.abs(Number(c.bonusValue) - targetBonusNum) <= strictTolNum
        : null;
      const ownKey = axis === 'quality'
        ? Number(ctx && ctx.listingQuality)
        : Number(ctx && ctx.primaryBonusValue);
      const merged = mergeLadder({
        soldComps: filtered,
        listedComps: askingArr,
        axis,
        ownKey,
        itemClass: ctx && ctx.itemClass,
      });
      const emptyText = (filtered.length || askingArr.length)
        ? (axis === 'quality' ? 'no comps list a quality %' : 'no comps list a bonus %')
        : 'nothing matches your filters';
      wrap.appendChild(InlineRenderer._buildUnifiedLadder({
        buckets: merged,
        axis,
        cheapestPrice: cheapest,
        isStrict: soldIsStrict,
        emptyText,
      }));

      return wrap;
    },
    // One unified table from mergeLadder output. Each row co-locates the level's
    // SOLD summary (median · count) and FOR-SALE summary (cheapest · count); the
    // sold and for-sale cells are independent drill targets, each with its own
    // caret, sharing one-open-at-a-time behaviour across the whole table.
    _buildUnifiedLadder({ buckets, axis, cheapestPrice, isStrict, emptyText }) {
      const wrap = document.createElement('div');
      wrap.className = 'rwth-card-ladder-unified';
      const useQuality = axis === 'quality';

      if (!Array.isArray(buckets) || !buckets.length) {
        const empty = document.createElement('div');
        empty.className = 'rwth-card-drill-empty';
        empty.textContent = emptyText;
        wrap.appendChild(empty);
        return wrap;
      }

      const table = document.createElement('table');
      table.className = 'rwth-card-drill-table rwth-card-ladder-table rwth-card-ladder-unified-table';
      const thead = document.createElement('thead');
      const firstHead = useQuality ? 'quality' : 'bonus %';
      thead.innerHTML = `<tr><th>${firstHead}</th><th>sold (typ · n)</th><th>for sale (low · n)</th></tr>`;
      table.appendChild(thead);
      const tbody = document.createElement('tbody');

      // One detail open at a time across the table (ephemeral, popup-local).
      let openId = null, openDetail = null, openCaret = null, openRow = null;
      const closeOpen = () => {
        if (openDetail) openDetail.remove();
        if (openCaret) openCaret.textContent = '▸';
        if (openRow) openRow.classList.remove('expanded');
        openId = null; openDetail = null; openCaret = null; openRow = null;
      };
      const wireCell = (cell, caret, tr, side, rows, id) => {
        cell.classList.add('rwth-card-ladder-clickable');
        cell.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (openId === id) { closeOpen(); return; }
          closeOpen();
          const detail = InlineRenderer._buildLadderDetailRow(side, rows, 3);
          tr.classList.add('expanded');
          caret.textContent = '▾';
          tr.parentNode.insertBefore(detail, tr.nextSibling);
          openId = id; openDetail = detail; openCaret = caret; openRow = tr;
        });
      };

      for (const b of buckets) {
        const tr = document.createElement('tr');
        tr.classList.add('rwth-card-ladder-row');
        if (b.isOwn) tr.classList.add('rwth-card-ladder-own');

        // Provenance markers — derived from the SOLD rows only (the for-sale
        // side is never widened). Mirrors the former per-row logic (19c/19d).
        const sRows = b.sold ? b.sold.rows : [];
        let widenedSuffix = '';
        const baseWidenedRows = sRows.filter(c => c && c.provenance === 'widenedBase');
        if (sRows.length && baseWidenedRows.length === sRows.length) {
          tr.classList.add('rwth-card-ladder-widenedbase');
          const baseNames = Array.from(new Set(baseWidenedRows.map(c => c.baseName).filter(Boolean)));
          tr.title = baseNames.length ? `also using ${baseNames.join(', ')}` : 'other base weapons';
          widenedSuffix = baseNames.length ? ` (${baseNames.join(', ')})` : ' (other base)';
        } else if (typeof isStrict === 'function' && sRows.length) {
          const sameBaseRows = sRows.filter(c => !(c && c.provenance === 'widenedBase'));
          const strictRows = sameBaseRows.filter(isStrict).length;
          if (sameBaseRows.length && strictRows === 0) {
            tr.classList.add('rwth-card-ladder-widened');
            tr.title = 'wider bonus range than yours';
            widenedSuffix = ' (wider bonus)';
          } else if (strictRows < sameBaseRows.length) {
            tr.classList.add('rwth-card-ladder-widened-mixed');
            tr.title = `${strictRows} of ${sameBaseRows.length} close to your bonus`;
            widenedSuffix = ` (${strictRows}/${sameBaseRows.length} close)`;
          }
        }

        const labelCell = document.createElement('td');
        const tag = b.isOwn ? ' ← yours' : '';
        labelCell.textContent = `${b.label}${tag}${widenedSuffix}`;
        tr.appendChild(labelCell);

        // SOLD cell — drill target for past sales.
        const soldCell = document.createElement('td');
        soldCell.classList.add('rwth-card-ladder-cell');
        if (b.sold) {
          const caret = document.createElement('span');
          caret.className = 'rwth-card-ladder-caret';
          caret.textContent = '▸';
          soldCell.appendChild(caret);
          soldCell.appendChild(document.createTextNode(`${fmtChatPrice(b.sold.median)} · ${b.sold.count}`));
          wireCell(soldCell, caret, tr, 'sold', b.sold.rows, `${b.key}|sold`);
        } else {
          soldCell.classList.add('rwth-card-ladder-blank');
          soldCell.textContent = '—';
        }
        tr.appendChild(soldCell);

        // FOR-SALE cell — drill target for live listings.
        const listedCell = document.createElement('td');
        listedCell.classList.add('rwth-card-ladder-cell');
        if (b.listed) {
          const caret = document.createElement('span');
          caret.className = 'rwth-card-ladder-caret';
          caret.textContent = '▸';
          listedCell.appendChild(caret);
          const hasCheapest = cheapestPrice != null && b.listed.cheapest === cheapestPrice;
          listedCell.appendChild(document.createTextNode(
            `${fmtChatPrice(b.listed.cheapest)} · ${b.listed.count}${hasCheapest ? ' ← low' : ''}`));
          if (hasCheapest) listedCell.classList.add('rwth-card-ladder-cheapest');
          wireCell(listedCell, caret, tr, 'listed', b.listed.rows, `${b.key}|listed`);
        } else {
          listedCell.classList.add('rwth-card-ladder-blank');
          listedCell.textContent = '—';
        }
        tr.appendChild(listedCell);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    },
    _buildLadderDetailRow(kind, rows, colspan) {
      const tr = document.createElement('tr');
      tr.className = 'rwth-card-ladder-detail';
      const td = document.createElement('td');
      td.colSpan = colspan;
      const sub = document.createElement('table');
      sub.className = 'rwth-card-ladder-subtable';
      const thead = document.createElement('thead');
      const tbody = document.createElement('tbody');
      const sorted = rows.slice();
      const fmtPct = v => Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)}%` : '—';
      if (kind === 'listed') {
        sorted.sort((a, b) => Number(a.price) - Number(b.price));
        thead.innerHTML = '<tr><th>price</th><th>bonus%</th><th>quality%</th>'
                       + '<th>seller</th><th>listing</th><th>source</th><th></th></tr>';
        for (const r of sorted) {
          const row = document.createElement('tr');
          const mk = (txt) => { const x = document.createElement('td'); x.textContent = txt; return x; };
          row.appendChild(mk(fmtChatPrice(Number(r.price))));
          row.appendChild(mk(fmtPct(r.bonusValue)));
          row.appendChild(mk(fmtPct(r.quality)));
          row.appendChild(mk(r.sellerId != null ? String(r.sellerId) : '—'));
          row.appendChild(mk(r.listingId != null ? String(r.listingId) : '—'));
          row.appendChild(mk(r.source || 'market'));
          const linkCell = document.createElement('td');
          if (r.sellerId != null) {
            const a = document.createElement('a');
            a.href = `https://www.torn.com/profiles.php?XID=${encodeURIComponent(r.sellerId)}`;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'open';
            linkCell.appendChild(a);
          } else {
            linkCell.textContent = '—';
          }
          row.appendChild(linkCell);
          tbody.appendChild(row);
        }
      } else {
        sorted.sort((a, b) => {
          const ta = Number(a.timestamp) || 0;
          const tb = Number(b.timestamp) || 0;
          return tb - ta;
        });
        thead.innerHTML = '<tr><th>date</th><th>price</th><th>bonus%</th><th>quality%</th></tr>';
        for (const r of sorted) {
          const row = document.createElement('tr');
          const mk = (txt) => { const x = document.createElement('td'); x.textContent = txt; return x; };
          row.appendChild(mk(InlineRenderer._fmtDate(r.timestamp)));
          row.appendChild(mk(fmtChatPrice(Number(r.price))));
          row.appendChild(mk(fmtPct(r.bonusValue)));
          row.appendChild(mk(fmtPct(r.quality)));
          tbody.appendChild(row);
        }
      }
      sub.appendChild(thead);
      sub.appendChild(tbody);
      td.appendChild(sub);
      tr.appendChild(td);
      return tr;
    },
    _fmtDate(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return '—';
      const d = new Date(n);
      if (isNaN(d.getTime())) return '—';
      const mo = d.toLocaleString('en-US', { month: 'short' });
      return `${mo} ${d.getDate()} '${String(d.getFullYear()).slice(2)}`;
    },
    _deductionMath(ctx, buy, reference, filtered) {
      const cls = ctx.itemClass;
      const med = reference && reference.median != null
        ? reference.median
        : (function () {
            const ps = filtered.map(c => Number(c.price)).filter(p => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
            if (!ps.length) return null;
            const m = Math.floor(ps.length / 2);
            return ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
          })();
      if (cls === 'duneRiotArmor') {
        if (buy.floor == null) return 'Bazaar floor not loaded yet — add your API key and wait for prices.';
        const tol = buy.tolerance != null ? buy.tolerance : 0;
        return `Bazaar floor ${fmtChatPrice(buy.floor)} + ${fmtChatPrice(tol)} room → bid up to ${fmtChatPrice(buy.max)}`;
      }
      if (cls === 'trashBB') {
        if (buy.floor == null) return 'Bazaar floor not loaded yet.';
        return `Bazaar floor ${fmtChatPrice(buy.floor)} (firm) → bid up to ${fmtChatPrice(buy.max)}`;
      }
      const prices = (filtered || []).map(c => Number(c && c.price))
        .filter(p => Number.isFinite(p) && p > 0);
      const mn = prices.length ? Math.min(...prices) : null;
      if (cls === 'assaultArmor') {
        if (mn == null || !Array.isArray(buy.range)) return 'not enough sales to work out a range.';
        return `cheapest ${fmtChatPrice(mn)} − 10–20% → ${fmtChatPrice(buy.range[0])}–${fmtChatPrice(buy.range[1])} (middle ${fmtChatPrice(buy.max)}; typical ${fmtChatPrice(med)})`;
      }
      if (cls === 'orangeWeapon' || cls === 'redWeapon' || cls === 'orangeArmor' || cls === 'redArmor') {
        if (!Array.isArray(buy.range)) return 'not enough sales to work out a range.';
        return `similar sales run ${fmtChatPrice(buy.range[0])}–${fmtChatPrice(buy.range[1])} — too spread out for one buy price`;
      }
      // yellowWeapon (default) — floor-anchored on min.
      if (mn == null || buy.max == null) return 'not enough sales to work out a floor.';
      const m = ctx.margins || {};
      const tax    = m.tax    != null ? m.tax    : 0.05;
      const mug    = m.mug    != null ? m.mug    : 0.10;
      const margin = m.margin != null ? m.margin : 0.05;
      const pct = (x) => `${Math.round(x * 100)}%`;
      const medTail = med != null ? ` (typical ${fmtChatPrice(med)})` : '';
      return `cheapest ${fmtChatPrice(mn)} − ${pct(tax)} tax − ${pct(mug)} mug risk − ${pct(margin)} your profit → bid up to ${fmtChatPrice(buy.max)}${medTail}`;
    },
    removeAll() {
      if (typeof document === 'undefined') return;
      document.querySelectorAll('.' + InlineRenderer.BADGE_CLASS).forEach(b => b.remove());
    },
  };

  // ─── AuctionScanner (impure) ────────────────────────────────────────────────
  // amarket.php only. MutationObserver fires a debounced sweep that walks every
  // expanded auction row; idempotent via a WeakSet so re-expansion never
  // refetches or duplicates a badge. Detaches and clears badges when the intel
  // toggle is off or the user navigates off amarket.
  const AuctionScanner = {
    _observer: null,
    _processed: new WeakSet(),
    _scheduled: false,
    _onAmarket() {
      try { return /amarket\.php/i.test(location.pathname + location.search); }
      catch { return false; }
    },
    _scheduleSweep() {
      if (AuctionScanner._scheduled) return;
      AuctionScanner._scheduled = true;
      setTimeout(() => {
        AuctionScanner._scheduled = false;
        AuctionScanner._sweep();
      }, 80);
    },
    _isExpanded(info) {
      if (!info) return false;
      // Inline display:none rules it out.
      if (info.style && info.style.display === 'none') return false;
      // Torn toggles expansion via class/state, not always inline style — fall
      // back to "has actual property children visible".
      if (info.offsetParent === null && !(info.getClientRects && info.getClientRects().length))
        return false;
      const hasProps = info.querySelector(
        'li.propertyWrapper___xSOH1, li[class*="propertyWrapper___"]');
      return !!hasProps;
    },
    _sweep() {
      if (!MEM.intel.enabled.auction) return;
      if (!AuctionScanner._onAmarket()) return;
      const lis = document.querySelectorAll('li');
      for (const li of lis) {
        if (!li.querySelector || !li.querySelector('.item-cont-wrap')) continue;
        const info = li.querySelector('.show-item-info');
        if (!info) continue;
        if (!AuctionScanner._isExpanded(info)) continue;
        // Track by row li (stable) instead of info node (Torn may re-mount).
        if (AuctionScanner._processed.has(li)) continue;
        AuctionScanner._processed.add(li);
        AuctionScanner._handle(li, info);
      }
    },
    async _handle(li, info) {
      InlineRenderer.renderAuctionBadge(info, { loading: true });
      let parsed = null;
      try { parsed = DomScanner.parseAuctionRow(li); } catch (e) {
        console.warn('[rwth] parseAuctionRow threw', e);
      }
      console.debug('[rwth] auction parsed', parsed);
      if (!parsed || !parsed.itemName) {
        InlineRenderer.renderAuctionBadge(info, { error: "couldn't read the item" });
        return;
      }
      const listingPrice = parsed.currentBid != null
        ? parsed.currentBid : readAuctionListingPrice(li);
      const item = {
        itemName: parsed.itemName,
        bonuses: parsed.parsedBonuses,
        quality: parsed.quality,
        type: parsed.itemType,
      };
      // v0.3.0 slice 9 — BonusTrashGuard short-circuit before any fetch.
      const trashHit = (parsed.parsedBonuses || []).find(
        b => b && BonusTrashGuard.isExcluded(b.name, MEM.intel.excludedBonuses));
      if (trashHit) {
        InlineRenderer.renderAuctionBadge(info, {
          skipped: 'trash', bonusName: trashHit.name,
        });
        return;
      }
      let r;
      try {
        r = await PricingEngine.fetchComps(item);
      } catch (e) {
        console.warn('[rwth] fetchComps threw', e);
        InlineRenderer.renderAuctionBadge(info, { error: "couldn't load prices" });
        return;
      }
      const clearedRaw = r.cleared || [];
      const askingRaw  = r.asking  || [];
      console.debug('[rwth] auction comps raw',
        { cleared: clearedRaw.length, asking: askingRaw.length, sample: (clearedRaw[0] || askingRaw[0]) });
      // Action math uses cleared sales only — asking prices are surfaced
      // separately as a spread line (issue #267) plus a LISTED ladder (#280).
      const comps        = clearedRaw.map(compShape).filter(Boolean);
      const askingShaped = askingRaw.map(compShape).filter(Boolean);
      const askingComps  = askingShaped.map((c, i) => {
        const raw = askingRaw[i] || {};
        return {
          ...c,
          listingId: raw.listingId != null ? raw.listingId : null,
          sellerId:  raw.sellerId  != null ? raw.sellerId  : null,
          source: raw.source || 'market',
        };
      });
      const askingMedian = _median(askingShaped.map(c => c.price));
      const askingCount  = askingShaped.length;
      // Resolve item class from the cached items dict. Falls back to DOM-parsed
      // type/rarity when the dict has not been fetched yet.
      const dict = ItemClassifier.getDict();
      const cls = dict ? ItemClassifier.classify(parsed.itemName, dict) : null;
      // `parsed.itemType` is DOM-scraped from auction row stat labels
      // ('Damage:' vs 'Armor:') — our own UI taxonomy. The 'armor' UI value
      // happens to coincide with one of Torn's real armor-type values, so it
      // passes through unchanged; the 'weapon' UI value translates to
      // 'primary' as an arbitrary stand-in among the three weapon types
      // (RW pricing keys off rarity, not subtype).
      const type = (cls && cls.type)
        || (parsed.itemType === 'armor' ? 'armor' : 'primary');
      const rarity = (cls && cls.rarity) || parsed.rarity || null;
      const classTag = cls
        ? formatClassTag({ ...cls, rarity })
        : formatClassTag({ type, rarity });

      // BB floor — used as hard guard on Riot/Dune/trash and informational
      // elsewhere. `'armor'` here is BBEngine's internal multiplier key
      // (distinct from Torn's `armor`/`defensive` type labels); weapons key
      // on the resolved weaponBase (pistol/rifle/etc).
      const bbRate = MEM.bbRate && MEM.bbRate.rate;
      const bbClassKey = isArmorType(type) ? 'armor' : (cls && cls.weaponBase) || null;
      const bbFloor = bbClassKey && rarity && bbRate
        ? BBEngine.calculateFloor(bbClassKey, rarity, bbRate,
            { bonusCount: (parsed.parsedBonuses || []).length })
        : null;

      // Market floor / anchor fallback stays market-only — bazaar is excluded
      // from anchor math (PRD #296); a cheap bazaar piece must not pull it down.
      const marketAsking = askingComps.filter(c => (c.source || 'market') === 'market');
      const marketCheapest = marketAsking.length
        ? Math.min(...marketAsking.map(c => c.price)) : null;
      // Bazaar floor is display-only (#300) — a cross-check beside the market
      // floor, never fed into the anchor/tiering math.
      const bazaarAsking = askingComps.filter(c => c.source === 'bazaar');
      const bazaarCheapest = bazaarAsking.length
        ? Math.min(...bazaarAsking.map(c => c.price)) : null;

      // v0.3.0 slice 20a (#291) — no cleared comps. When asking listings still
      // exist, anchor a single-cut verdict on the asking floor instead of the
      // dead-end `no comp` one-liner. Only when BOTH cleared and asking are
      // empty do we keep the bare badge.
      if (!comps.length) {
        if (marketCheapest != null) {
          InlineRenderer.renderMarketFloorCard(info, {
            classTag, currentBid: listingPrice,
            marketFloor: marketCheapest, bazaarCheapest, askingMedian, askingCount,
            askingComps, listingQuality: parsed.quality,
          });
        } else {
          InlineRenderer.renderAuctionBadge(info, {
            error: 'no comparable sales', askingMedian, askingCount,
          });
        }
        return;
      }

      // Per-class routing (v0.3.0 slice 5). Mirror the ledger path's fallback
      // (see ~line 2030): when a row doesn't resolve to a rarity-based key it
      // still routes to the two-tier card — assaultArmor for armor, yellowWeapon
      // for weapons — instead of dropping to the stripped legacy badge. Standard
      // weapons (Enfield SA-80, Jackhammer, …) carry no rarity tier in
      // /v2/torn/items, so resolveItemClass returned null and every weapon
      // auction fell through to the one-line "no comp" badge while the SAME item
      // rendered the full card on the ledger. Armor routes off its set, not
      // rarity, which is why armors were unaffected (v0.3.30, #298 follow-up).
      let itemClassKey = resolveItemClass(cls);
      if (!itemClassKey) itemClassKey = isArmorType(type) ? 'assaultArmor' : 'yellowWeapon';
      const primaryBonus = (parsed.parsedBonuses || [])[0] || null;
      const targetBonusValue = primaryBonus ? Number(primaryBonus.value) : null;
      InlineRenderer.renderTwoTierCard(info, {
        itemClass: itemClassKey,
        rarity: cls && cls.rarity,
        classTag,
        bbFloor,
        currentBid: listingPrice,
        listingQuality: item.quality,
        primaryBonusName: primaryBonus ? primaryBonus.name : null,
        primaryBonusValue: Number.isFinite(targetBonusValue) ? targetBonusValue : null,
        strictTolerance: 0,
        comps,
        askingComps,
        marketCheapest,
        bazaarCheapest,
        askingMedian,
        askingCount,
        widenedBase: Array.isArray(r.widenedBase) ? r.widenedBase.slice() : [],
        margins: null,
      });
    },
    start() {
      if (!AuctionScanner._onAmarket()) return;
      if (AuctionScanner._observer) return;
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
      AuctionScanner._observer = new MutationObserver(() => AuctionScanner._scheduleSweep());
      AuctionScanner._observer.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['style', 'class'],
      });
      AuctionScanner._scheduleSweep();
    },
    stop() {
      if (AuctionScanner._observer) {
        AuctionScanner._observer.disconnect();
        AuctionScanner._observer = null;
      }
      AuctionScanner._processed = new WeakSet();
      InlineRenderer.removeAll();
    },
    refresh() {
      if (AuctionScanner._onAmarket() && MEM.intel.enabled.auction) AuctionScanner.start();
      else AuctionScanner.stop();
    },
  };

  // ─── Test seam (ADR-0002) ────────────────────────────────────────────────────
  // Pure functions exposed for the Node test runner. More are added in later slices.
  globalThis.__RwthPure = {
    buildLedgerTab,
    buildAdvertiseTab,
    buildSettingsTab,
    buildScanChecklist,
    buildSellBox,
    buildContent,
    ROI,
    parseAuctionWin,
    toScanHits,
    applyItemDetails,
    SellParser,
    matchSell,
    summarizeSells,
    AdvertiseGenerator,
    BonusTrashGuard,
    similarity,
    resolveMarketAnchor,
    BRACKET_JUMP_THRESHOLD,
    PricingEngine,
    CompWidener,
    BBEngine,
    ItemClassifier,
    formatClassTag,
    Cache,
    SupabaseClient,
    Weav3rClient,
    ListingsFetcher,
    BONUS_DATA,
    BONUS_NAME_TO_ID,
    DomScanner,
    compShape,
    BONUS_CHANGE_DATES_SEED,
    SIMILAR_BASES_SEED,
    resolveAdjacentBases,
    parseSimilarBases,
    fmtSimilarBases,
    SENSITIVITY_MIN_COMPS,
    SENSITIVITY_MIN_DISTINCT,
    SENSITIVITY_FLAT_FRACTION,
    resolveBonusChangeEpoch,
    parseBonusChangeDates,
    fmtBonusChangeDates,
    velocityClass,
    velocityBaseline,
    VELOCITY_MIN_SAMPLES,
    mergeLadder,
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  function bootstrap() {
    hydrate();
    render();          // builds the shell (hidden until MEM.ui.open)
    startLauncher();
    // Warm the BB rate in the background — 1h TTL means at most one fetch per
    // hour and the cached value drives the badge until then.
    BBEngine.fetchBBRate().catch(() => {});
    ItemClassifier.fetchItemsDict().catch(() => {});
    AuctionScanner.refresh();
    // SPA-aware: Torn navigates without full reload, so poll for href changes
    // and reconcile the scanner's attach state with the new URL.
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        AuctionScanner.refresh();
      }
    }, 800);
  }

  if (!TEST) {
    void SCRIPT_VERSION;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
  }
})();
