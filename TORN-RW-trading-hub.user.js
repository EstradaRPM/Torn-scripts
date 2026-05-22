// ==UserScript==
// @name         Torn RW Trading Hub
// @namespace    estradarpm-rw-trading-hub
// @version      0.1.8
// @description  Trader's workbench for ranked-war armor & weapon flipping — ledger + advertising hub
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/estradarpm/torn-scripts/main/TORN-RW-trading-hub.user.js
// @downloadURL  https://raw.githubusercontent.com/estradarpm/torn-scripts/main/TORN-RW-trading-hub.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.1.8';

  // Skip the DOM bootstrap when required by the Node test shim (ADR-0002).
  const TEST = typeof globalThis !== 'undefined' && globalThis.__RWTH_TEST__ === true;

  // ─── Brand (static, in-file; not exposed in Settings) ────────────────────────
  const BRAND = {
    mark: 'NC17',
  };

  // ─── State ───────────────────────────────────────────────────────────────────
  const MEM = {
    ui: {
      open: false,
      maximized: false,
      activeTab: 'ledger', // 'ledger' | 'advertise' | 'settings'
    },
    ledger: {
      items: [],
      statusFilter: 'all',
      editingId: null,        // null | 'new' | itemId — drives the add/edit form
      expandedId: null,       // null | itemId — the tap-expanded row
      scanResults: [],
      scanError: null,
      lastScan: 0,
    },
    advertise: {
      selectedIds: [],
      transactions: [],
      outputs: { title: '', forumHtml: '', chat: '', bazaarHtml: '', signatureHtml: '' },
    },
    settings: {
      playerId: '',
      forumThreadUrl: '',
      weav3rPricelistUrl: '',
      bannerImageUrl: '',
      forumHeaderImageUrl: '',
      apiKey: '###PDA-APIKEY###',
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

    const transactions = Store.get('rwth_transactions');
    if (Array.isArray(transactions)) MEM.advertise.transactions = transactions;

    const settings = Store.get('rwth_settings');
    if (settings && typeof settings === 'object') {
      MEM.settings = { ...MEM.settings, ...settings };
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
  function buildAdvertiseTab() { return placeholder('Advertise'); }

  // ROI = net proceeds minus buy price. The sell log states fees exactly, so
  // saleNet is authoritative — no venue fee table. Null until the row is sold.
  const ROI = {
    compute(item) {
      if (!item || item.saleNet == null) return null;
      return item.saleNet - (item.buyPrice || 0);
    },
  };

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

  function buildLedgerRow(item, expanded) {
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
          bonus ? ` <span class="rwth-row-bonus">${escapeAttr(bonus)}</span>` : ''}</span>
        <span class="rwth-row-price">${fmtMoney(item.buyPrice)}</span>
        ${statusCell}
      </div>`;
    if (!expanded) return `<div class="rwth-row">${head}</div>`;
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
          <button class="rwth-btn-sm" type="button" data-action="edit-item" data-id="${item.id}">edit</button>
          <button class="rwth-btn-sm rwth-btn-danger" type="button" data-action="delete-item" data-id="${item.id}">delete</button>
        </div>
      </div>`;
    return `<div class="rwth-row rwth-row-expanded">${head}${detail}</div>`;
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
      <label class="rwth-field">
        <span class="rwth-field-label">Type</span>
        <select class="rwth-field-input" data-form="type">
          <option value="weapon"${v.type === 'armor' ? '' : ' selected'}>Weapon</option>
          <option value="armor"${v.type === 'armor' ? ' selected' : ''}>Armor</option>
        </select>
      </label>
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

  function buildLedgerTab(mem) {
    const L = (mem && mem.ledger) || { items: [], statusFilter: 'all' };
    const items = L.items || [];
    const filter = L.statusFilter || 'all';
    const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);

    const filterBtns = STATUS_FILTERS.map(f =>
      `<button class="rwth-filter${f === filter ? ' rwth-filter-active' : ''}" type="button"
               data-filter="${f}">${f}</button>`).join('');

    const list = filtered.length
      ? filtered.map(i => buildLedgerRow(i, i.id === L.expandedId)).join('')
      : `<div class="rwth-placeholder">No ${filter === 'all' ? '' : filter + ' '}items yet.</div>`;

    return `<div class="rwth-ledger">
      <div class="rwth-ledger-bar">
        <div class="rwth-filters">${filterBtns}</div>
        <button class="rwth-btn rwth-btn-add" type="button" data-action="add-item">+ add</button>
      </div>
      ${L.editingId ? buildLedgerForm(mem) : ''}
      <div class="rwth-rows">${list}</div>
    </div>`;
  }

  // Settings fields — order is the on-screen order.
  const SETTINGS_FIELDS = [
    { key: 'playerId',            label: 'Player ID',            type: 'text', placeholder: 'e.g. 1234567' },
    { key: 'forumThreadUrl',      label: 'Forum thread URL',     type: 'url',  placeholder: 'https://www.torn.com/forums.php#/p=threads&f=...' },
    { key: 'weav3rPricelistUrl',  label: 'Weav3r pricelist URL', type: 'url',  placeholder: 'https://...' },
    { key: 'bannerImageUrl',      label: 'Bazaar banner image URL',  type: 'url', placeholder: 'https://...' },
    { key: 'forumHeaderImageUrl', label: 'Forum header image URL',   type: 'url', placeholder: 'https://...' },
    { key: 'apiKey',              label: 'Torn API key',         type: 'password', placeholder: '###PDA-APIKEY###' },
  ];

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function buildSettingsTab(mem) {
    const s = (mem && mem.settings) || {};
    const rows = SETTINGS_FIELDS.map(f => `
      <label class="rwth-field">
        <span class="rwth-field-label">${f.label}</span>
        <input class="rwth-field-input" type="${f.type}" data-setting="${f.key}"
               value="${escapeAttr(s[f.key])}" placeholder="${escapeAttr(f.placeholder)}"
               autocomplete="off" spellcheck="false">
      </label>`).join('');
    return `<div class="rwth-settings">
      ${rows}
      <div class="rwth-settings-actions">
        <button class="rwth-btn" type="button" data-action="save-settings">Save</button>
        <span id="rwth-settings-status" class="rwth-settings-status" role="status" aria-live="polite"></span>
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
        setState({ ledger: { ...MEM.ledger, expandedId: MEM.ledger.expandedId === id ? null : id } });
        return;
      }
      const filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        setState({ ledger: { ...MEM.ledger, statusFilter: filterBtn.dataset.filter } });
        return;
      }
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const id = actionEl.dataset.id;
      switch (actionEl.dataset.action) {
        case 'close':         setState({ ui: { ...MEM.ui, open: false } }); break;
        case 'maximize':      setState({ ui: { ...MEM.ui, maximized: !MEM.ui.maximized } }); break;
        case 'save-settings': saveSettings(); break;
        case 'add-item':      setState({ ledger: { ...MEM.ledger, editingId: 'new' } }); break;
        case 'edit-item':     setState({ ledger: { ...MEM.ledger, editingId: id, expandedId: id } }); break;
        case 'cancel-item':   setState({ ledger: { ...MEM.ledger, editingId: null } }); break;
        case 'save-item':     saveLedgerItem(); break;
        case 'mark-listed':   Ledger.markListed(id); break;
        case 'delete-item':   if (confirm('Delete this ledger item?')) Ledger.remove(id); break;
      }
    });
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
    setState({ settings: next });

    const status = document.getElementById('rwth-settings-status');
    if (!status) return;
    status.textContent = '✓ Saved';
    status.classList.add('rwth-saved-show');
    setTimeout(() => {
      const el = document.getElementById('rwth-settings-status');
      if (el) { el.textContent = ''; el.classList.remove('rwth-saved-show'); }
    }, 2200);
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
        bonuses: patch.bonuses || [],
        quality: patch.quality != null ? patch.quality : null,
        buyPrice: patch.buyPrice || 0,
        buyTimestamp: patch.buyTimestamp || Date.now(),
        buySource: patch.buySource || 'market',
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
    const patch = {
      itemName,
      type: get('type') || 'weapon',
      bonuses,
      quality: numOrNull(get('quality')),
      buyPrice: numOrNull(get('buyPrice')) || 0,
      buyTimestamp: dateStr ? Date.parse(dateStr) : Date.now(),
      buySource: get('buySource') || 'market',
    };
    if (MEM.ledger.editingId === 'new') Ledger.add(patch);
    else Ledger.update(MEM.ledger.editingId, patch);
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

      .rwth-ledger { display: flex; flex-direction: column; gap: 10px; }
      .rwth-ledger-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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

      @media (max-width: 480px) {
        #rwth-panel { width: calc(100vw - 24px); right: 12px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Test seam (ADR-0002) ────────────────────────────────────────────────────
  // Pure functions exposed for the Node test runner. More are added in later slices.
  globalThis.__RwthPure = {
    buildLedgerTab,
    buildAdvertiseTab,
    buildSettingsTab,
    buildContent,
    ROI,
  };

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  function bootstrap() {
    hydrate();
    render();          // builds the shell (hidden until MEM.ui.open)
    startLauncher();
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
