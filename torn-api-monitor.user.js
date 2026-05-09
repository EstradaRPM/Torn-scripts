// ==UserScript==
// @name         Torn API Monitor
// @namespace    EstradaRPM-ApiMonitor
// @version      1.1.0
// @description  Floating widget showing req/min heat bars for loaded API keys
// @author       Built for EstradaRPM
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '1.1.0';

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
    keys: [],        // [{ id, label, maskedKey, rawKey, disabled? }]
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
    disable(id) {
      const key = MEM.keys.find(k => k.id === id);
      if (key) {
        key.disabled = true;
        Store.set('mon_keys', MEM.keys);
      }
    },
    list() {
      return MEM.keys;
    },
  };

  // ---------------------------------------------------------------------------
  // LogAnalyzer — pure analysis of log entries; no side effects
  // ---------------------------------------------------------------------------
  const LogAnalyzer = {
    calcReqPerMin(entries, nowMs) {
      const cutoff = nowMs - 60000;
      const count = entries.filter(e => e.timestamp * 1000 >= cutoff).length;
      return Math.min(Math.max(count, 0), 100);
    },
    calcEndpointBreakdown(entries) {
      if (!entries.length) return [];
      const groups = new Map();
      for (const e of entries) {
        const key = `${e.type}||${e.selections}`;
        if (!groups.has(key)) groups.set(key, { type: e.type, selections: e.selections, count: 0 });
        groups.get(key).count++;
      }
      return [...groups.values()].sort((a, b) => b.count - a.count);
    },
    getRecentEntries(entries, n) {
      return [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, n);
    },
    calcHeatLevel(reqPerMin) {
      if (reqPerMin <= 33) return 'low';
      if (reqPerMin <= 66) return 'medium';
      if (reqPerMin <= 90) return 'high';
      return 'critical';
    },
  };

  // ---------------------------------------------------------------------------
  // LogFetcher — one GM_xmlhttpRequest per call to v2/key/log
  // ---------------------------------------------------------------------------
  const LogFetcher = {
    fetchLog(rawKey, limit = 100) {
      return new Promise(resolve => {
        GM_xmlhttpRequest({
          method: 'GET',
          url: `https://api.torn.com/v2/key/log?limit=${limit}&key=${rawKey}`,
          onload(res) {
            let data;
            try { data = JSON.parse(res.responseText); } catch {
              resolve({ entries: [], error: { code: -1, message: 'Parse error' } });
              return;
            }
            if (data.error) {
              const { code } = data.error;
              const message = data.error.error || data.error.message || 'API error';
              resolve({
                entries: [],
                error: { code, message },
                disableKey: code === 2 || code === 13,
              });
              return;
            }
            const entries = Object.values(data.log || {});
            resolve({ entries, error: null });
          },
          onerror() {
            resolve({ entries: [], error: { code: -1, message: 'Network error' } });
          },
        });
      });
    },
  };

  // ---------------------------------------------------------------------------
  // refreshAll — fetches all non-disabled keys in parallel
  // ---------------------------------------------------------------------------
  async function refreshAll() {
    if (MEM.refreshing) return;
    const active = MEM.keys.filter(k => !k.disabled);
    if (active.length === 0) return;

    MEM.refreshing = true;
    render();

    const results = await Promise.all(
      active.map(async key => {
        const result = await LogFetcher.fetchLog(key.rawKey);
        return { id: key.id, result };
      })
    );

    for (const { id, result } of results) {
      if (result.disableKey) KeyStore.disable(id);
      MEM.logs[id] = {
        entries: result.entries,
        fetchedAt: Date.now(),
        error: result.error,
      };
    }

    MEM.refreshing = false;
    render();
  }

  // ---------------------------------------------------------------------------
  // heatColor — maps heat level to CSS color
  // ---------------------------------------------------------------------------
  function heatColor(level) {
    return { low: '#4caf50', medium: '#ffc107', high: '#ff9800', critical: '#f44336' }[level] || '#888';
  }

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

    const toggleLabel = MEM.collapsed ? '▼' : '▲';
    const refreshDisabled = MEM.refreshing || MEM.keys.filter(k => !k.disabled).length === 0;
    const refreshLabel = MEM.refreshing ? 'Refreshing…' : 'Refresh All';

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
        <div style="display:flex;gap:6px;align-items:center;">
          <button id="tam-refresh-btn" ${refreshDisabled ? 'disabled' : ''} style="
            background:${refreshDisabled ? '#333' : '#1a4a8a'};
            border:none;
            border-radius:4px;
            color:${refreshDisabled ? '#666' : '#e0e0e0'};
            cursor:${refreshDisabled ? 'default' : 'pointer'};
            font-size:11px;
            padding:3px 8px;
            white-space:nowrap;
          ">${refreshLabel}</button>
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
        const nowMs = Date.now();
        for (const key of MEM.keys) {
          const log = MEM.logs[key.id];
          const hasError = log && log.error;
          const hasData = log && !log.error && log.entries;

          let heatBarHtml = '';
          let metaHtml = '';

          if (hasError) {
            heatBarHtml = `
              <div style="margin-top:6px;font-size:11px;color:#f44336;padding:4px 6px;background:#2a1a1a;border-radius:4px;">
                Error ${log.error.code}: ${escHtml(log.error.message)}
              </div>
            `;
          } else if (hasData) {
            const reqPerMin = LogAnalyzer.calcReqPerMin(log.entries, nowMs);
            const level = LogAnalyzer.calcHeatLevel(reqPerMin);
            const color = heatColor(level);
            const pct = Math.round(reqPerMin);
            const fetchedAgo = Math.round((nowMs - log.fetchedAt) / 1000);
            heatBarHtml = `
              <div style="margin-top:6px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-bottom:3px;">
                  <span>${reqPerMin} req/min</span>
                  <span>${fetchedAgo}s ago</span>
                </div>
                <div style="background:#333;border-radius:3px;height:6px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:${color};transition:width 0.3s;"></div>
                </div>
              </div>
            `;
          }

          if (key.disabled) {
            metaHtml = `<span style="font-size:10px;color:#888;margin-left:4px;">[disabled]</span>`;
          }

          html += `
            <div style="
              padding:6px 8px;
              margin-bottom:6px;
              background:#2a2a2a;
              border-radius:6px;
            ">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="min-width:0;overflow:hidden;flex:1;">
                  <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${escHtml(key.label)}${metaHtml}
                  </div>
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
              ${heatBarHtml}
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
      header.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        MEM.collapsed = !MEM.collapsed;
        Store.set('mon_collapsed', MEM.collapsed);
        render();
      });
    }

    // Bind refresh button
    const refreshBtn = document.getElementById('tam-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', e => {
        e.stopPropagation();
        refreshAll();
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
        delete MEM.logs[id];
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
