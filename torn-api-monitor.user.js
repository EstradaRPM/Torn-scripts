// ==UserScript==
// @name         Torn API Monitor
// @namespace    EstradaRPM-ApiMonitor
// @version      1.0.0
// @description  Floating widget showing req/min heat bars for loaded API keys
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.0.0';

  // ---------------------------------------------------------------------------
  // Store — localStorage wrapper; never throws
  // ---------------------------------------------------------------------------
  const Store = {
    get(k) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  // ---------------------------------------------------------------------------
  // MEM — single state object; never rebound
  // ---------------------------------------------------------------------------
  const MEM = {
    keys: [],        // [{ id, label, maskedKey, rawKey }]
    logs: {},        // { [keyId]: { entries, fetchedAt, error } }
    expanded: {},    // { [keyId]: boolean }
    collapsed: false,
    refreshing: false,
  };

  // ---------------------------------------------------------------------------
  // KeyStore — CRUD for loaded API keys
  // ---------------------------------------------------------------------------
  const KeyStore = {
    add(label, rawKey) {
      const nextId = (Store.get('mon_next_id') || 0) + 1;
      Store.set('mon_next_id', nextId);
      const id = String(nextId);
      const maskedKey = rawKey.slice(0, 4) + '****' + rawKey.slice(-4);
      MEM.keys.push({ id, label, maskedKey, rawKey });
      Store.set('mon_keys', MEM.keys);
    },
    remove(id) {
      MEM.keys = MEM.keys.filter(k => k.id !== id);
      Store.set('mon_keys', MEM.keys);
    },
    list() {
      return MEM.keys;
    },
  };

  // ---------------------------------------------------------------------------
  // Widget — mounts floating DOM shell; delegates all content to render()
  // ---------------------------------------------------------------------------
  const Widget = {
    mount() {
      if (document.getElementById('torn-api-monitor')) return;
      const el = document.createElement('div');
      el.id = 'torn-api-monitor';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        zIndex: '99999',
        minWidth: '260px',
        maxWidth: '340px',
        fontFamily: 'sans-serif',
        fontSize: '13px',
        background: '#1a1a1a',
        color: '#e0e0e0',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        userSelect: 'none',
      });
      document.body.appendChild(el);
    },
  };

  // ---------------------------------------------------------------------------
  // render() — rebuilds entire widget content from MEM
  // ---------------------------------------------------------------------------
  function render() {
    const el = document.getElementById('torn-api-monitor');
    if (!el) return;

    // Header
    const toggleLabel = MEM.collapsed ? '▼' : '▲';
    let html = `
      <div id="tam-header" style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:8px 12px;
        background:#111;
        cursor:pointer;
      ">
        <span style="font-weight:600;font-size:13px;letter-spacing:0.5px;">API Monitor</span>
        <button id="tam-toggle" style="
          background:none;
          border:none;
          color:#e0e0e0;
          cursor:pointer;
          font-size:13px;
          padding:0;
          line-height:1;
        ">${toggleLabel}</button>
      </div>
    `;

    if (!MEM.collapsed) {
      // Add-key form
      html += `
        <div style="padding:10px 12px;border-bottom:1px solid #333;">
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <input id="tam-label-input" type="text" placeholder="Label" style="
              flex:1;
              background:#2a2a2a;
              border:1px solid #444;
              border-radius:4px;
              color:#e0e0e0;
              padding:4px 8px;
              font-size:12px;
              min-width:0;
            " />
            <input id="tam-key-input" type="password" placeholder="API key" style="
              flex:2;
              background:#2a2a2a;
              border:1px solid #444;
              border-radius:4px;
              color:#e0e0e0;
              padding:4px 8px;
              font-size:12px;
              min-width:0;
            " />
          </div>
          <button id="tam-add-btn" style="
            width:100%;
            background:#2d6a4f;
            border:none;
            border-radius:4px;
            color:#fff;
            padding:5px 0;
            cursor:pointer;
            font-size:12px;
            font-weight:600;
          ">Add Key</button>
        </div>
      `;

      // Key list
      html += `<div style="padding:8px 12px;">`;
      if (MEM.keys.length === 0) {
        html += `<div style="color:#666;font-size:12px;text-align:center;padding:8px 0;">No keys loaded</div>`;
      } else {
        for (const key of MEM.keys) {
          html += `
            <div style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              padding:6px 8px;
              margin-bottom:6px;
              background:#2a2a2a;
              border-radius:6px;
              gap:8px;
            ">
              <div style="min-width:0;overflow:hidden;">
                <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(key.label)}</div>
                <div style="font-size:11px;color:#888;font-family:monospace;">${escHtml(key.maskedKey)}</div>
              </div>
              <button data-remove-id="${escHtml(key.id)}" style="
                background:#5a1a1a;
                border:none;
                border-radius:4px;
                color:#e07070;
                padding:3px 8px;
                cursor:pointer;
                font-size:11px;
                white-space:nowrap;
                flex-shrink:0;
              ">Remove</button>
            </div>
          `;
        }
      }
      html += `</div>`;
    }

    el.innerHTML = html;

    // Bind collapse/expand toggle
    const header = document.getElementById('tam-header');
    if (header) {
      header.addEventListener('click', () => {
        MEM.collapsed = !MEM.collapsed;
        Store.set('mon_collapsed', MEM.collapsed);
        render();
      });
    }

    // Bind add-key button
    const addBtn = document.getElementById('tam-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const labelInput = document.getElementById('tam-label-input');
        const keyInput = document.getElementById('tam-key-input');
        const label = labelInput ? labelInput.value.trim() : '';
        const rawKey = keyInput ? keyInput.value.trim() : '';
        if (!label || !rawKey) return;
        KeyStore.add(label, rawKey);
        if (labelInput) labelInput.value = '';
        if (keyInput) keyInput.value = '';
        render();
      });
    }

    // Bind remove buttons
    el.querySelectorAll('[data-remove-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.getAttribute('data-remove-id');
        KeyStore.remove(id);
        render();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // escHtml — minimal HTML entity escape for user-supplied strings
  // ---------------------------------------------------------------------------
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Init — load persisted state, mount widget, render
  // ---------------------------------------------------------------------------
  function init() {
    const savedCollapsed = Store.get('mon_collapsed');
    if (savedCollapsed !== null) MEM.collapsed = savedCollapsed;

    const savedExpanded = Store.get('mon_expanded');
    if (savedExpanded && typeof savedExpanded === 'object') MEM.expanded = savedExpanded;

    const savedKeys = Store.get('mon_keys');
    if (Array.isArray(savedKeys)) MEM.keys = savedKeys;

    Widget.mount();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
