// ==UserScript==
// @name         Torn RW Trading Hub
// @namespace    estradarpm-rw-trading-hub
// @version      0.2.5
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

  const SCRIPT_VERSION = '0.2.5';

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
    // bonuses: { [bonusId]: { tolerance: number, ignoreQuality: bool } }
    // bonusId is the lower-cased bonus name used as a stable key (e.g. "blindfire").
    intel: {
      enabled: { auction: true, ledger: true },
      defaults: { bonusTolerance: 10, qualityTolerance: 10, ignoreQuality: false },
      bonuses: {},
      band: 7,
      mugBuffer: 10,
      marginTarget: 15,
      markup: 1.20,
    },
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

    const intel = Store.get('rwth_intel_settings');
    if (intel && typeof intel === 'object') {
      MEM.intel = {
        ...MEM.intel,
        ...intel,
        enabled:  { ...MEM.intel.enabled,  ...(intel.enabled  || {}) },
        defaults: { ...MEM.intel.defaults, ...(intel.defaults || {}) },
        bonuses:  { ...(intel.bonuses || {}) },
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
  // writes loading/result/error into MEM.ledger.priceCheckResults[id] and
  // triggers a render; this function reads the latest snapshot to draw.
  function buildPriceCheckPanel(item, state) {
    const s = state || {};
    if (s.loading) {
      return `<div class="rwth-price-panel rwth-tier-loading">⟳ checking comps…</div>`;
    }
    if (s.error) {
      return `<div class="rwth-price-panel rwth-tier-none">${escapeAttr(s.error)}</div>`;
    }
    if (!s.suggest) {
      return `<div class="rwth-price-panel rwth-tier-none">no comp</div>`;
    }
    const { expected, suggestedList, projectedNet, profit, roi } = s.suggest;
    const v = s.verdict || {};
    const profitCls = profit >= 0 ? 'rwth-roi-pos' : 'rwth-roi-neg';
    const mathParts = [];
    if (v.reference != null && v.compsUsed != null) {
      mathParts.push(`${v.compsUsed} comps · ±${v.tolerance}%`);
      if (v.slopeProjection != null && item.quality != null) {
        mathParts.push(`slope ${fmtChatPrice(v.slopeProjection)} at ${item.quality}% q`);
      }
    }
    const mathLine = mathParts.length
      ? `<div class="rwth-price-math">${mathParts.join(' · ')}</div>` : '';
    return `<div class="rwth-price-panel">
        <div class="rwth-price-grid">
          <span>Expected sale</span><span>${fmtMoney(expected)}</span>
          <span>Suggested list</span><span>${fmtMoney(suggestedList)}</span>
          <span>Projected net</span><span>${fmtMoney(projectedNet)}</span>
          <span>Profit</span><span class="${profitCls}">${profit >= 0 ? '+' : ''}${fmtMoney(profit)}</span>
          <span>ROI</span><span class="${profitCls}">${roi >= 0 ? '+' : ''}${roi}%</span>
        </div>
        ${mathLine}
      </div>`;
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

  // ─── IntelSettings pure helpers (ADR-0002) ──────────────────────────────────
  // Shape mirrors the Price Checker's settingsManager contract so future slices
  // can call a single function regardless of which surface is doing the pricing.
  //
  //   getEffectiveBonusTolerance(bonusId, intel)
  //     → per-bonus override tolerance if present, else intel.defaults.bonusTolerance
  //       (returns 0 when ignoreQuality is set for the bonus — tolerance is moot).
  //
  //   getEffectiveQualityTolerance(bonusId, intel)
  //     → 0 if the per-bonus or global ignoreQuality flag is set, else
  //       per-bonus override qualityTolerance if present, else
  //       intel.defaults.qualityTolerance
  //
  // `bonusId` is the lower-cased bonus name (stable dict key, e.g. "blindfire").
  const IntelSettings = {
    getEffectiveBonusTolerance(bonusId, intel) {
      const cfg = intel || MEM.intel;
      const key = (bonusId || '').toLowerCase();
      const override = cfg.bonuses && cfg.bonuses[key];
      if (override && override.ignoreQuality) return 0;
      if (override && override.tolerance != null) return override.tolerance;
      return cfg.defaults.bonusTolerance;
    },
    getEffectiveQualityTolerance(bonusId, intel) {
      const cfg = intel || MEM.intel;
      const key = (bonusId || '').toLowerCase();
      const override = cfg.bonuses && cfg.bonuses[key];
      if (cfg.defaults.ignoreQuality) return 0;
      if (override && override.ignoreQuality) return 0;
      if (override && override.tolerance != null) return override.tolerance;
      return cfg.defaults.qualityTolerance;
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

  function buildIntelBonusOverrides(bonuses) {
    const entries = Object.entries(bonuses || {});
    if (!entries.length) return '<p class="rwth-intel-empty">No per-bonus overrides yet.</p>';
    return entries.map(([id, ov]) => `
      <div class="rwth-intel-bonus-row" data-intel-bonus-id="${escapeAttr(id)}">
        <span class="rwth-intel-bonus-name">${escapeAttr(id)}</span>
        <label class="rwth-intel-bonus-field">
          <span>Tol %</span>
          <input class="rwth-field-input rwth-intel-bonus-tol" type="number" min="0" max="100" step="1"
                 data-intel-bonus-tol="${escapeAttr(id)}"
                 value="${escapeAttr(ov.tolerance != null ? ov.tolerance : '')}">
        </label>
        <label class="rwth-intel-bonus-check">
          <input type="checkbox" data-intel-bonus-iq="${escapeAttr(id)}"
                 ${ov.ignoreQuality ? 'checked' : ''}>
          Any quality
        </label>
        <button class="rwth-btn rwth-btn-ghost rwth-intel-bonus-rm" type="button"
                data-action="remove-intel-bonus" data-id="${escapeAttr(id)}">✕</button>
      </div>`).join('');
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
          <span class="rwth-field-label">Default bonus tolerance %</span>
          <input class="rwth-field-input" type="number" min="0" max="100" step="1"
                 data-intel="defaults.bonusTolerance"
                 value="${escapeAttr(intel.defaults.bonusTolerance)}">
        </label>
        <label class="rwth-field">
          <span class="rwth-field-label">Default quality tolerance %</span>
          <input class="rwth-field-input" type="number" min="0" max="100" step="1"
                 data-intel="defaults.qualityTolerance"
                 value="${escapeAttr(intel.defaults.qualityTolerance)}">
        </label>
        <label class="rwth-field">
          <span class="rwth-field-label">Verdict band %</span>
          <input class="rwth-field-input" type="number" min="0" max="100" step="1"
                 data-intel="band"
                 value="${escapeAttr(intel.band)}">
        </label>
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
      <p class="rwth-form-title" style="margin:10px 0 4px;">Per-bonus overrides</p>
      <div id="rwth-intel-bonuses">${buildIntelBonusOverrides(intel.bonuses)}</div>
      <div class="rwth-intel-add-row">
        <input class="rwth-field-input" type="text" id="rwth-intel-add-name"
               placeholder="Bonus name (e.g. Blindfire)" autocomplete="off" spellcheck="false">
        <input class="rwth-field-input" type="number" id="rwth-intel-add-tol"
               placeholder="Tol %" min="0" max="100" step="1">
        <label class="rwth-intel-check">
          <input type="checkbox" id="rwth-intel-add-iq">
          Any quality
        </label>
        <button class="rwth-btn" type="button" data-action="add-intel-bonus">+ Add</button>
      </div>
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
  // WEAPON_CATEGORY is only an offline fallback for common RW items used before
  // the dictionary has been fetched (first run, pre-scan).
  const WEAPON_CATEGORY = {
    'Enfield SA-80': 'Primary',
    'Sub-Machine Gun': 'Primary',
    'Heavy Machine Gun': 'Primary',
    'Light Anti-Tank Weapon': 'Primary',
    'Rocket-Propelled Grenade Launcher': 'Primary',
    'Cobra Derringer': 'Secondary',
    'Diamond Bladed Knife': 'Melee',
  };
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
    return WEAPON_CATEGORY[name] || 'Other';
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
        case 'add-intel-bonus':     addIntelBonus(); break;
        case 'remove-intel-bonus':  removeIntelBonus(id); break;
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
      bonuses:  { ...MEM.intel.bonuses },
      band:         MEM.intel.band,
      mugBuffer:    MEM.intel.mugBuffer,
      marginTarget: MEM.intel.marginTarget,
      markup:       MEM.intel.markup,
    };
    document.querySelectorAll('#rwth-content [data-intel]').forEach((el) => {
      const path = el.dataset.intel;
      const val  = el.type === 'checkbox' ? el.checked : el.value;
      if (path === 'enabled.auction')           nextIntel.enabled.auction  = Boolean(val);
      else if (path === 'enabled.ledger')       nextIntel.enabled.ledger   = Boolean(val);
      else if (path === 'defaults.bonusTolerance') nextIntel.defaults.bonusTolerance = Number(val) || 0;
      else if (path === 'defaults.qualityTolerance') nextIntel.defaults.qualityTolerance = Number(val) || 0;
      else if (path === 'defaults.ignoreQuality') nextIntel.defaults.ignoreQuality = Boolean(val);
      else if (path === 'band')         nextIntel.band         = Number(val) || 0;
      else if (path === 'mugBuffer')    nextIntel.mugBuffer    = Number(val) || 0;
      else if (path === 'marginTarget') nextIntel.marginTarget = Number(val) || 0;
      else if (path === 'markup')       nextIntel.markup       = Number(val) || 1;
    });
    // Collect per-bonus override edits made inline.
    document.querySelectorAll('#rwth-content [data-intel-bonus-tol]').forEach((el) => {
      const id = el.dataset.intelBonusTol;
      if (!nextIntel.bonuses[id]) nextIntel.bonuses[id] = {};
      const v = parseFloat(el.value);
      nextIntel.bonuses[id].tolerance = Number.isFinite(v) ? v : null;
    });
    document.querySelectorAll('#rwth-content [data-intel-bonus-iq]').forEach((el) => {
      const id = el.dataset.intelBonusIq;
      if (!nextIntel.bonuses[id]) nextIntel.bonuses[id] = {};
      nextIntel.bonuses[id].ignoreQuality = el.checked;
    });
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

  // Add a per-bonus intel override from the "Add override" row inputs.
  function addIntelBonus() {
    const nameEl = document.getElementById('rwth-intel-add-name');
    const tolEl  = document.getElementById('rwth-intel-add-tol');
    const iqEl   = document.getElementById('rwth-intel-add-iq');
    if (!nameEl) return;
    const raw = (nameEl.value || '').trim();
    if (!raw) return;
    const id = raw.toLowerCase();
    const tol = tolEl ? parseFloat(tolEl.value) : NaN;
    const nextBonuses = {
      ...MEM.intel.bonuses,
      [id]: {
        tolerance:     Number.isFinite(tol) ? tol : null,
        ignoreQuality: iqEl ? iqEl.checked : false,
      },
    };
    const nextIntel = { ...MEM.intel, bonuses: nextBonuses };
    Store.set('rwth_intel_settings', nextIntel);
    setState({ intel: nextIntel });
  }

  // Remove a per-bonus intel override by its id (lower-cased bonus name).
  function removeIntelBonus(id) {
    if (!id) return;
    const nextBonuses = { ...MEM.intel.bonuses };
    delete nextBonuses[id];
    const nextIntel = { ...MEM.intel, bonuses: nextBonuses };
    Store.set('rwth_intel_settings', nextIntel);
    setState({ intel: nextIntel });
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
    const cacheKey = 'pricecheck:' + JSON.stringify({
      n: item.itemName, b: item.bonuses, q: item.quality, c: itemCategory(item),
      e: intel.enabled.ledger,
      d: intel.defaults, ov: intel.bonuses,
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
    const comps = [...(composite.history || []), ...(composite.live || [])]
      .map(compShape).filter(Boolean);
    if (!comps.length) {
      writePriceCheckResult(item.id, { error: 'no comp' });
      return;
    }
    const verdict = PricingEngine.verdict(
      { price: item.buyPrice || 0, quality: item.quality || 0 }, comps);
    const suggest = PricingEngine.ledgerSuggest(comps, item.buyPrice || 0, {
      markup: intel.markup, mugBuffer: intel.mugBuffer,
    });
    writePriceCheckResult(item.id, { verdict, suggest });
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
        items = items.map(i => (i.id === row.matchedId ? {
          ...i, status: 'sold',
          saleGross: sell.saleGross, saleFees: sell.saleFees, saleNet: sell.saleNet,
          soldTimestamp: sell.timestamp || Date.now(),
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

  // ─── PricingEngine (pure) ─────────────────────────────────────────────────────
  // Verdict + ledger-suggest engine — pure functions, no GM calls, no DOM.
  // All impure callers (fetch/cache/render) live in later slices.

  /** Internal: median of a numeric array. Returns null for empty input. */
  function _median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

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
     * fetchComps(item, intelSettings) → Promise<{ history, live }>
     *
     * Orchestrates Supabase (auction history) and weav3r (live market) in
     * parallel. Applies effective per-bonus + quality tolerances via
     * IntelSettings → similarity.calcRange to derive value/quality ranges.
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

      const weav3rQuery = { sortField: 'price', sortDirection: 'asc' };
      const cat = itemCategory(item || {});
      if (cat === 'Armor') {
        weav3rQuery.tab = 'armor';
        if (itemName) weav3rQuery.armorPiece = itemName;
      } else {
        weav3rQuery.tab = 'weapons';
        if (itemName) weav3rQuery.weaponName = itemName;
      }

      bonuses.slice(0, 2).forEach((b, i) => {
        const lo  = String(b.name).toLowerCase();
        const id  = BONUS_NAME_TO_ID[lo] != null
          ? BONUS_NAME_TO_ID[lo]
          : BONUS_NAME_TO_ID[lo.replace(/[\s-]/g, '')];
        const tol = IntelSettings.getEffectiveBonusTolerance(lo, intel);
        const val = Number(b.value);
        const hasVal = Number.isFinite(val);
        const range  = hasVal ? similarity.calcRange(val, tol) : null;
        if (i === 0) {
          if (id != null) supabaseQuery.bonus1_id = id;
          if (range)      { supabaseQuery.bonus1_value_min = range.min;
                            supabaseQuery.bonus1_value_max = range.max; }
          weav3rQuery.bonus1 = b.name;
          if (range) { weav3rQuery.minBonus1Value = range.min;
                       weav3rQuery.maxBonus1Value = range.max; }
        } else {
          if (id != null) supabaseQuery.bonus2_id = id;
          if (range)      { supabaseQuery.bonus2_value_min = range.min;
                            supabaseQuery.bonus2_value_max = range.max; }
          weav3rQuery.bonus2 = b.name;
        }
      });

      const primaryKey = bonuses[0] ? String(bonuses[0].name).toLowerCase() : '';
      const qTol = IntelSettings.getEffectiveQualityTolerance(primaryKey, intel);
      const qv   = Number(item && item.quality);
      if (Number.isFinite(qv)) {
        const qr = similarity.calcRange(qv, qTol);
        supabaseQuery.quality_min = qr.min;
        supabaseQuery.quality_max = qr.max;
        weav3rQuery.minQuality    = qr.min;
        weav3rQuery.maxQuality    = qr.max;
      }

      const [history, live] = await Promise.all([
        SupabaseClient.search(supabaseQuery).then(r => r.auctions || []).catch(() => []),
        Weav3rClient.search(weav3rQuery).then(r => r.weapons || []).catch(() => []),
      ]);
      return { history, live };
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
      const info = li.querySelector('.show-item-info');
      if (!info) {
        return { itemName: titleName, parsedBonuses: [], quality: null, itemType: 'weapon' };
      }
      const inner = DomScanner.parseItemMarketRow(info);
      return {
        itemName: titleName || inner.itemName,
        parsedBonuses: inner.parsedBonuses,
        quality: inner.quality,
        itemType: inner.itemType,
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
    const q = Number(c.quality != null ? c.quality : NaN);
    return { price: p, quality: Number.isFinite(q) ? q : 0 };
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
      if (s.error) {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-none';
        badge.textContent = s.error;
        return;
      }
      const v = s.verdict;
      if (!v || v.tier === 'none') {
        badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-none';
        badge.textContent = 'no comp';
        return;
      }
      const labels = { good: 'Good', fair: 'Fair', over: 'Over', thin: 'Thin' };
      const tierLabel = labels[v.tier] || v.tier;
      badge.className = InlineRenderer.BADGE_CLASS + ' rwth-tier-' + v.tier;
      const parts = [tierLabel];
      if (s.listingPrice != null && v.reference != null) {
        parts.push(`${fmtChatPrice(s.listingPrice)} vs ${fmtChatPrice(v.reference)} median`);
      } else if (v.reference != null) {
        parts.push(`${fmtChatPrice(v.reference)} median`);
      }
      parts.push(`(${v.compsUsed} comps · ±${v.tolerance}%)`);
      if (v.slopeProjection != null && s.listingQuality != null) {
        parts.push(`slope ${fmtChatPrice(v.slopeProjection)} at ${s.listingQuality}% q`);
      }
      badge.textContent = parts.join(' · ');
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
    _sweep() {
      if (!MEM.intel.enabled.auction) return;
      if (!AuctionScanner._onAmarket()) return;
      const lis = document.querySelectorAll('li');
      for (const li of lis) {
        if (!li.querySelector || !li.querySelector('.item-cont-wrap')) continue;
        const info = li.querySelector('.show-item-info');
        if (!info || info.style.display === 'none') continue;
        if (AuctionScanner._processed.has(info)) continue;
        AuctionScanner._processed.add(info);
        AuctionScanner._handle(li, info);
      }
    },
    async _handle(li, info) {
      InlineRenderer.renderAuctionBadge(info, { loading: true });
      let parsed = null;
      try { parsed = DomScanner.parseAuctionRow(li); } catch {}
      if (!parsed || !parsed.itemName) {
        InlineRenderer.renderAuctionBadge(info, { error: 'no comp' });
        return;
      }
      const listingPrice = readAuctionListingPrice(li);
      const item = {
        itemName: parsed.itemName,
        bonuses: parsed.parsedBonuses,
        quality: parsed.quality,
        type: parsed.itemType,
      };
      let comps = [];
      try {
        const r = await PricingEngine.fetchComps(item);
        comps = [...(r.history || []), ...(r.live || [])]
          .map(compShape).filter(Boolean);
      } catch {
        InlineRenderer.renderAuctionBadge(info, { error: 'no comp' });
        return;
      }
      if (!comps.length) {
        InlineRenderer.renderAuctionBadge(info, { error: 'no comp' });
        return;
      }
      const verdict = PricingEngine.verdict(
        { price: listingPrice || 0, quality: item.quality || 0 }, comps);
      InlineRenderer.renderAuctionBadge(info, {
        verdict, listingPrice, listingQuality: item.quality,
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
    IntelSettings,
    similarity,
    PricingEngine,
    Cache,
    SupabaseClient,
    Weav3rClient,
    BONUS_DATA,
    BONUS_NAME_TO_ID,
    DomScanner,
    compShape,
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  function bootstrap() {
    hydrate();
    render();          // builds the shell (hidden until MEM.ui.open)
    startLauncher();
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
