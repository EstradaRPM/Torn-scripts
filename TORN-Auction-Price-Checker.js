// ==UserScript==
// @name         TORN Auction Price Checker
// @namespace    https://torn.com/
// @version      3.6.10
// @description  Check historical prices for similar auction items
// @author       WinterValor [3945658]
// @match        https://www.torn.com/amarket.php*
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/bazaar.php*
// @match        https://www.torn.com/displaycase.php*
// @match        https://www.torn.com/factions.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      btrmmuuoofbonmuwrkzg.supabase.co
// @connect      weav3r.dev
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/564049/TORN%20Auction%20Price%20Checker.user.js
// @updateURL https://update.greasyfork.org/scripts/564049/TORN%20Auction%20Price%20Checker.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SUPABASE_URL: 'https://btrmmuuoofbonmuwrkzg.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0cm1tdXVvb2Zib25tdXdya3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4NTEzMTgsImV4cCI6MjA4NDQyNzMxOH0.E-s0k46BORXLICAvxtEpqoM3Qmh4-TRLaJAwXO6wJTY',
        WEAV3R_API: 'https://weav3r.dev/api/ranked-weapons',
        CACHE_TTL: 5 * 60 * 1000,
        CACHE_KEY: 'ah_search_cache',
        SETTINGS_KEY: 'ah_bonus_settings',
        POSITION_KEY: 'ah_modal_position',
        MAX_CACHE_ENTRIES: 50
    };

    // Default settings structure
    const DEFAULT_SETTINGS = {
        defaults: {
            bonusTolerance: 10,    // ±10% for bonus values
            qualityTolerance: 10,  // ±10% for quality
            ignoreQuality: false   // Whether to ignore quality by default
        },
        bonuses: {},  // Per-bonus overrides: { [bonusId]: { bonusTolerance, qualityTolerance, ignoreQuality } }
        theme: 'system',  // 'system', 'light', 'dark'
        market: {
            disableBonusValueFilter: false,  // Disable bonus value min/max in market search
            disableQualityFilter: false       // Disable quality min/max in market search
        }
    };

    // Settings management
    const settingsManager = {
        _settings: null,
        load() {
            try {
                const stored = localStorage.getItem(CONFIG.SETTINGS_KEY);
                this._settings = stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : { ...DEFAULT_SETTINGS };
            } catch {
                this._settings = { ...DEFAULT_SETTINGS };
            }
            return this._settings;
        },
        save() {
            try {
                localStorage.setItem(CONFIG.SETTINGS_KEY, JSON.stringify(this._settings));
            } catch { /* quota exceeded */ }
        },
        get() {
            if (!this._settings) this.load();
            return this._settings;
        },
        getDefaults() {
            return this.get().defaults;
        },
        getBonusSettings(bonusId) {
            const settings = this.get();
            return settings.bonuses[bonusId] || null;
        },
        setBonusSettings(bonusId, config) {
            const settings = this.get();
            if (config === null) {
                delete settings.bonuses[bonusId];
            } else {
                settings.bonuses[bonusId] = config;
            }
            this.save();
        },
        setDefaults(defaults) {
            this._settings.defaults = { ...this._settings.defaults, ...defaults };
            this.save();
        },
        export() {
            return JSON.stringify(this.get(), null, 2);
        },
        import(jsonStr) {
            try {
                const imported = JSON.parse(jsonStr);
                if (imported.defaults && typeof imported.defaults === 'object') {
                    this._settings = {
                        defaults: { ...DEFAULT_SETTINGS.defaults, ...imported.defaults },
                        bonuses: imported.bonuses || {}
                    };
                    this.save();
                    return true;
                }
            } catch (e) {
                console.error('[AH] Import failed:', e);
            }
            return false;
        },
        reset() {
            this._settings = { ...DEFAULT_SETTINGS, bonuses: {} };
            this.save();
        },
        // Get effective tolerance for a bonus (uses per-bonus override or default)
        getEffectiveBonusTolerance(bonusId) {
            const bonusSettings = this.getBonusSettings(bonusId);
            if (bonusSettings && bonusSettings.bonusTolerance !== undefined) {
                return bonusSettings.bonusTolerance;
            }
            return this.getDefaults().bonusTolerance;
        },
        // Get effective quality tolerance for a bonus (uses per-bonus override or default)
        // Returns null if quality should be ignored
        getEffectiveQualityTolerance(bonusId) {
            const bonusSettings = this.getBonusSettings(bonusId);
            if (bonusSettings) {
                if (bonusSettings.ignoreQuality) return null;
                if (bonusSettings.qualityTolerance !== undefined) {
                    return bonusSettings.qualityTolerance;
                }
            }
            // Check default ignoreQuality setting
            const defaults = this.getDefaults();
            if (defaults.ignoreQuality) return null;
            return defaults.qualityTolerance;
        },
        // Theme management
        getTheme() {
            return this.get().theme || 'system';
        },
        setTheme(theme) {
            this._settings.theme = theme;
            this.save();
            applyTheme(theme);
        },
        // Market settings
        getMarketSettings() {
            const settings = this.get();
            return settings.market || { disableBonusValueFilter: false, disableQualityFilter: false };
        },
        setMarketSettings(marketSettings) {
            this._settings.market = { ...this.getMarketSettings(), ...marketSettings };
            this.save();
        }
    };

    // Theme application
    function getEffectiveTheme(theme) {
        if (theme === 'system') {
            return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        return theme;
    }

    function applyTheme(theme) {
        const effective = getEffectiveTheme(theme);
        const modal = document.getElementById('ah-modal');
        if (modal) {
            modal.dataset.theme = effective;
        }
    }

    // Client-side cache using localStorage
    const searchCache = {
        _getStore() {
            try {
                return JSON.parse(localStorage.getItem(CONFIG.CACHE_KEY) || '{}');
            } catch { return {}; }
        },
        _setStore(store) {
            try {
                localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(store));
            } catch { /* quota exceeded - ignore */ }
        },
        get(key) {
            const store = this._getStore();
            const entry = store[key];
            if (entry && Date.now() - entry.ts < CONFIG.CACHE_TTL) {

                return entry.data;
            }
            if (entry) delete store[key]; // expired
            return null;
        },
        set(key, data) {
            const store = this._getStore();
            // Evict oldest if full
            const keys = Object.keys(store);
            if (keys.length >= CONFIG.MAX_CACHE_ENTRIES) {
                const sorted = keys.sort((a, b) => store[a].ts - store[b].ts);
                sorted.slice(0, 10).forEach(k => delete store[k]);
            }
            store[key] = { data, ts: Date.now() };
            this._setStore(store);
        },
        clear() {
            localStorage.removeItem(CONFIG.CACHE_KEY);
        }
    };

    GM_addStyle(`
        /* CSS Variables - Dark Theme (default) */
        .ah-modal {
            --ah-bg-primary: #0a0a0a;
            --ah-bg-secondary: #171717;
            --ah-bg-tertiary: #0d0d0d;
            --ah-bg-elevated: #262626;
            --ah-border: #262626;
            --ah-border-hover: #404040;
            --ah-text-primary: #fafafa;
            --ah-text-secondary: #a3a3a3;
            --ah-text-muted: #737373;
            --ah-text-faint: #525252;
            --ah-input-bg: #0a0a0a;
            --ah-input-border: #333;
            --ah-input-border-focus: #525252;
            --ah-btn-primary-bg: #fff;
            --ah-btn-primary-text: #000;
            --ah-btn-primary-hover: #e5e5e5;
            --ah-success: #22c55e;
            --ah-error: #ef4444;
            --ah-link: #60a5fa;
            --ah-spinner-track: #262626;
            --ah-spinner-fill: #fff;
            --ah-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }

        /* Light Theme */
        .ah-modal[data-theme="light"] {
            --ah-bg-primary: #ffffff;
            --ah-bg-secondary: #f5f5f5;
            --ah-bg-tertiary: #fafafa;
            --ah-bg-elevated: #e5e5e5;
            --ah-border: #e5e5e5;
            --ah-border-hover: #d4d4d4;
            --ah-text-primary: #171717;
            --ah-text-secondary: #525252;
            --ah-text-muted: #737373;
            --ah-text-faint: #a3a3a3;
            --ah-input-bg: #ffffff;
            --ah-input-border: #d4d4d4;
            --ah-input-border-focus: #a3a3a3;
            --ah-btn-primary-bg: #171717;
            --ah-btn-primary-text: #fff;
            --ah-btn-primary-hover: #262626;
            --ah-success: #16a34a;
            --ah-error: #dc2626;
            --ah-link: #2563eb;
            --ah-spinner-track: #e5e5e5;
            --ah-spinner-fill: #171717;
            --ah-shadow: 0 8px 32px rgba(0,0,0,0.15);
        }

        .ah-btn {
            position: absolute;
            top: 28px;
            right: 0;
            padding: 4px 10px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 3px;
            color: #aaa;
            cursor: pointer;
            font-size: 11px;
            font-family: Arial, sans-serif;
            transition: background 0.15s, color 0.15s;
        }
        .ah-btn:hover {
            background: #333;
            color: #fff;
        }

        .ah-overlay {
            display: none;
        }
        .ah-overlay.open { display: none; }

        .ah-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 650px;
            max-width: 95vw;
            max-height: 85vh;
            background: var(--ah-bg-primary);
            border: 1px solid var(--ah-border);
            border-radius: 8px;
            z-index: 99999;
            display: none;
            flex-direction: column;
            color: var(--ah-text-primary);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            box-shadow: var(--ah-shadow);
            transition: background 0.2s, color 0.2s, border-color 0.2s;
        }
        .ah-modal.open { display: flex; }

        /* PC-only: draggable and resizable */
        @media (min-width: 768px) and (pointer: fine) {
            .ah-modal {
                resize: both;
                overflow: auto;
                min-width: 400px;
                min-height: 300px;
            }
            .ah-modal.dragging {
                user-select: none;
            }
            .ah-header {
                cursor: move;
            }
        }

        .ah-header {
            padding: 16px;
            border-bottom: 1px solid var(--ah-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .ah-title { font-size: 14px; font-weight: 600; margin: 0 !important; margin-top: 0 !important; margin-bottom: 0 !important; color: var(--ah-text-primary); }
        .ah-close {
            background: none;
            border: none;
            color: var(--ah-text-muted);
            cursor: pointer;
            font-size: 18px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 20px;
        }
        .ah-close:hover { color: var(--ah-text-primary); }

        .ah-filters {
            padding: 12px 16px;
            background: var(--ah-bg-secondary);
            border-bottom: 1px solid var(--ah-border);
        }
        .ah-filter-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 8px;
            align-items: flex-end;
        }
        .ah-filter-row:last-child { margin-bottom: 0; }
        .ah-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .ah-field.wide { flex: 1; min-width: 200px; }
        .ah-field.medium { width: 130px; }
        .ah-field.small { width: 60px; }
        .ah-field label {
            font-size: 10px;
            color: var(--ah-text-muted);
            text-transform: uppercase;
        }
        .ah-field input, .ah-field select {
            padding: 6px 8px;
            background: var(--ah-input-bg);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-primary);
            font-size: 12px;
        }
        .ah-field input:focus, .ah-field select:focus {
            outline: none;
            border-color: var(--ah-input-border-focus);
        }
        .ah-search-btn {
            padding: 8px 20px;
            background: var(--ah-btn-primary-bg);
            border: none;
            border-radius: 4px;
            color: var(--ah-btn-primary-text);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            align-self: flex-end;
            margin-top: auto;
        }
        .ah-search-btn:hover { background: var(--ah-btn-primary-hover); }

        .ah-bonus-row {
            display: flex;
            gap: 6px;
            align-items: flex-end;
            padding: 6px 8px;
            background: var(--ah-bg-tertiary);
            border-radius: 4px;
            flex: 1;
        }
        .ah-bonus-row .ah-field { gap: 2px; }
        .ah-bonus-row .ah-field.bonus-select { width: 110px; }
        .ah-bonus-row .ah-field.bonus-val { width: 50px; }
        .ah-bonus-row label { font-size: 9px; }
        .ah-bonus-row input, .ah-bonus-row select { padding: 4px 6px; font-size: 11px; }
        .ah-bonus-row.quality { flex: none; }

        .ah-results {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            max-height: 300px;
            min-height: 120px;
        }

        .ah-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            background: var(--ah-bg-secondary);
            border: 1px solid var(--ah-border);
            border-radius: 6px;
            margin-bottom: 6px;
        }
        .ah-item:hover { border-color: var(--ah-border-hover); }
        .ah-item-left { flex: 1; }
        .ah-item-name { font-size: 13px; font-weight: 500; margin: 0 0 2px; color: var(--ah-text-primary); }
        .ah-item-meta { font-size: 11px; color: var(--ah-text-muted); margin: 0; }
        .ah-item-bonuses { margin-top: 4px; }
        .ah-bonus {
            display: inline-block;
            padding: 2px 6px;
            background: var(--ah-bg-elevated);
            border-radius: 3px;
            font-size: 10px;
            color: var(--ah-text-secondary);
            margin-right: 4px;
        }
        .ah-item-right { text-align: right; }
        .ah-price { font-size: 14px; font-weight: 600; color: var(--ah-success); margin: 0; }
        .ah-date { font-size: 10px; color: var(--ah-text-faint); margin: 2px 0 0; }
        .ah-players { font-size: 10px; color: var(--ah-text-muted); margin: 3px 0 0; }
        .ah-players a { color: var(--ah-link); text-decoration: none; }
        .ah-players a:hover { text-decoration: underline; }

        .ah-loading, .ah-empty, .ah-error {
            padding: 40px;
            text-align: center;
            color: var(--ah-text-muted);
            font-size: 13px;
        }
        .ah-error { color: var(--ah-error); }
        .ah-spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--ah-spinner-track);
            border-top-color: var(--ah-spinner-fill);
            border-radius: 50%;
            animation: ah-spin 0.6s linear infinite;
            margin: 0 auto 10px;
        }
        @keyframes ah-spin { to { transform: rotate(360deg); } }

        .ah-footer {
            padding: 10px 16px;
            border-top: 1px solid var(--ah-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            color: var(--ah-text-muted);
        }
        .ah-nav { display: flex; gap: 4px; }
        .ah-nav-btn {
            padding: 4px 10px;
            background: var(--ah-bg-secondary);
            border: 1px solid var(--ah-border);
            border-radius: 4px;
            color: var(--ah-text-secondary);
            font-size: 11px;
            cursor: pointer;
        }
        .ah-nav-btn:hover:not(:disabled) { background: var(--ah-bg-elevated); color: var(--ah-text-primary); }
        .ah-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Tabs */
        .ah-tabs {
            display: flex;
            border-bottom: 1px solid var(--ah-border);
        }
        .ah-tab {
            padding: 10px 20px;
            background: none;
            border: none;
            color: var(--ah-text-muted);
            cursor: pointer;
            font-size: 12px;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
        }
        .ah-tab:hover { color: var(--ah-text-secondary); }
        .ah-tab.active {
            color: var(--ah-text-primary);
            border-bottom-color: var(--ah-text-primary);
        }

        /* Settings Panel */
        .ah-settings {
            padding: 16px;
            overflow-y: auto;
            max-height: 400px;
        }
        .ah-settings-section {
            margin-bottom: 20px;
        }
        .ah-settings-section h4 {
            font-size: 12px;
            font-weight: 600;
            color: var(--ah-text-secondary);
            margin: 0 0 12px;
            text-transform: uppercase;
        }
        .ah-settings-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 12px;
            background: var(--ah-bg-secondary);
            border-radius: 4px;
            margin-bottom: 6px;
        }
        .ah-settings-row label {
            font-size: 11px;
            color: var(--ah-text-secondary);
            min-width: 100px;
        }
        .ah-settings-row input[type="number"] {
            width: 60px;
            padding: 4px 8px;
            background: var(--ah-input-bg);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-primary);
            font-size: 11px;
        }
        .ah-settings-row select {
            padding: 4px 8px;
            background: var(--ah-input-bg);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-primary);
            font-size: 11px;
            min-width: 120px;
        }
        .ah-settings-row .ah-unit {
            font-size: 10px;
            color: var(--ah-text-faint);
        }
        .ah-settings-row input[type="checkbox"] {
            width: 14px;
            height: 14px;
            accent-color: var(--ah-link);
        }

        /* Bonus settings list */
        .ah-bonus-settings-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: var(--ah-bg-secondary);
            border-radius: 4px;
            margin-bottom: 4px;
            flex-wrap: wrap;
        }
        .ah-bonus-settings-item .ah-bonus-name {
            font-size: 12px;
            color: var(--ah-text-primary);
            min-width: 120px;
            flex-shrink: 0;
        }
        .ah-bonus-settings-item .ah-field-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .ah-bonus-settings-item .ah-field-label {
            font-size: 10px;
            color: var(--ah-text-muted);
        }
        .ah-bonus-settings-item input[type="number"] {
            width: 50px;
            padding: 3px 6px;
            background: var(--ah-input-bg);
            border: 1px solid var(--ah-input-border);
            border-radius: 3px;
            color: var(--ah-text-primary);
            font-size: 10px;
        }
        .ah-bonus-settings-item input[type="checkbox"] {
            width: 12px;
            height: 12px;
            accent-color: var(--ah-link);
        }
        .ah-bonus-settings-item .ah-remove-btn {
            background: #7f1d1d;
            border: none;
            color: #fca5a5;
            padding: 2px 6px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 10px;
            margin-left: auto;
        }
        .ah-bonus-settings-item .ah-remove-btn:hover {
            background: #991b1b;
        }

        /* Add bonus dropdown */
        .ah-add-bonus-row {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-top: 8px;
        }
        .ah-add-bonus-row select {
            flex: 1;
            padding: 6px 8px;
            background: var(--ah-input-bg);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-primary);
            font-size: 11px;
        }
        .ah-add-btn {
            padding: 6px 12px;
            background: #166534;
            border: none;
            border-radius: 4px;
            color: #fff;
            font-size: 11px;
            cursor: pointer;
        }
        .ah-add-btn:hover { background: #15803d; }

        /* Import/Export */
        .ah-import-export {
            display: flex;
            gap: 8px;
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid var(--ah-border);
            flex-wrap: wrap;
        }
        .ah-import-export button {
            padding: 6px 12px;
            background: var(--ah-bg-secondary);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-secondary);
            font-size: 11px;
            cursor: pointer;
        }
        .ah-import-export button:hover {
            background: var(--ah-bg-elevated);
            color: var(--ah-text-primary);
        }
        .ah-import-export .ah-reset-btn {
            margin-left: auto;
            background: #7f1d1d;
            border-color: #7f1d1d;
            color: #fca5a5;
        }
        .ah-import-export .ah-reset-btn:hover {
            background: #991b1b;
        }

        /* Theme selector */
        .ah-theme-row {
            display: flex;
            gap: 8px;
        }
        .ah-theme-btn {
            padding: 6px 14px;
            background: var(--ah-bg-tertiary);
            border: 1px solid var(--ah-input-border);
            border-radius: 4px;
            color: var(--ah-text-secondary);
            font-size: 11px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .ah-theme-btn:hover {
            background: var(--ah-bg-elevated);
            color: var(--ah-text-primary);
        }
        .ah-theme-btn.active {
            background: var(--ah-btn-primary-bg);
            color: var(--ah-btn-primary-text);
            border-color: var(--ah-btn-primary-bg);
        }

        /* Hidden file input */
        .ah-hidden { display: none; }
    `);

    let state = {
        open: false,
        activeTab: 'search', // 'search', 'market', or 'settings'
        loading: false,
        error: null,
        results: [],
        total: 0,
        offset: 0,
        filters: {
            itemName: '',
            bonus1Id: '',
            bonus1Min: '',
            bonus1Max: '',
            bonus2Id: '',
            bonus2Min: '',
            bonus2Max: '',
            qualityMin: '',
            qualityMax: ''
        },
        // Market tab state
        marketLoading: false,
        marketError: null,
        marketResults: [],
        marketTotal: 0,
        // Item type: 'weapon' or 'armor'
        itemType: 'weapon',
        // Track last searched item for auto-search
        lastSearchedItem: '',
        lastMarketSearchedItem: '',
        bonusList: [],
        bonusMap: {}
    };

    // Check if we're on a PC (not mobile/touch device)
    function isPC() {
        return window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
    }

    // Drag state
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // Position management
    const positionManager = {
        load() {
            try {
                const stored = localStorage.getItem(CONFIG.POSITION_KEY);
                return stored ? JSON.parse(stored) : null;
            } catch { return null; }
        },
        save(pos) {
            try {
                localStorage.setItem(CONFIG.POSITION_KEY, JSON.stringify(pos));
            } catch { /* ignore */ }
        },
        clear() {
            localStorage.removeItem(CONFIG.POSITION_KEY);
        }
    };

    function createModal() {
        const overlay = document.createElement('div');
        overlay.id = 'ah-overlay';
        overlay.className = 'ah-overlay';
        // No click handler - modal only closes via X button

        const modal = document.createElement('div');
        modal.id = 'ah-modal';
        modal.className = 'ah-modal';

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // Apply saved theme
        applyTheme(settingsManager.getTheme());

        // Listen for system theme changes (when theme is set to 'system')
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
            if (settingsManager.getTheme() === 'system') {
                applyTheme('system');
            }
        });

        // Set up drag handlers for PC only
        if (isPC()) {
            setupDragHandlers(modal);
        }
    }

    function saveModalPosition(modal) {
        const rect = modal.getBoundingClientRect();
        positionManager.save({
            top: modal.style.top,
            left: modal.style.left,
            width: modal.offsetWidth,
            height: modal.offsetHeight,
            useTransform: modal.style.transform && modal.style.transform !== 'none'
        });
    }

    function setupDragHandlers(modal) {
        document.addEventListener('mousedown', (e) => {
            const header = e.target.closest('.ah-header');
            if (!header || !state.open) return;
            // Don't drag if clicking the close button
            if (e.target.closest('.ah-close')) return;

            isDragging = true;
            modal.classList.add('dragging');

            // If modal still has transform, convert to absolute positioning
            const rect = modal.getBoundingClientRect();
            if (modal.style.transform && modal.style.transform !== 'none') {
                modal.style.transform = 'none';
                modal.style.top = rect.top + 'px';
                modal.style.left = rect.left + 'px';
            }

            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const newX = e.clientX - dragOffsetX;
            const newY = e.clientY - dragOffsetY;

            // Keep modal within viewport bounds
            const maxX = window.innerWidth - modal.offsetWidth;
            const maxY = window.innerHeight - modal.offsetHeight;

            modal.style.left = Math.max(0, Math.min(newX, maxX)) + 'px';
            modal.style.top = Math.max(0, Math.min(newY, maxY)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                modal.classList.remove('dragging');
                // Save position after drag ends
                saveModalPosition(modal);
            }
        });

        // Save position on resize (using ResizeObserver)
        const resizeObserver = new ResizeObserver(() => {
            if (state.open && !isDragging) {
                saveModalPosition(modal);
            }
        });
        resizeObserver.observe(modal);
    }

    function apiRequest(endpoint, method, body) {
        return new Promise((resolve, reject) => {
            const url = `${CONFIG.SUPABASE_URL}/functions/v1/${endpoint}`;

            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': CONFIG.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
                },
                data: body ? JSON.stringify(body) : undefined,
                timeout: 15000,
                onload: function(response) {

                    try {
                        const data = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) {
                            resolve(data);
                        } else {
                            reject(new Error(data.error || 'API error'));
                        }
                    } catch (e) {
                        reject(new Error('Parse error'));
                    }
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    const BONUS_DATA = [
        {id:50,title:"Achilles"},
        {id:72,title:"Assassinate"},
        {id:52,title:"Backstab"},
        {id:54,title:"Berserk"},
        {id:57,title:"Bleed"},
        {id:33,title:"Blindfire"},
        {id:51,title:"Blindside"},
        {id:85,title:"Bloodlust"},
        {id:67,title:"Comeback"},
        {id:55,title:"Conserve"},
        {id:45,title:"Cripple"},
        {id:49,title:"Crusher"},
        {id:47,title:"Cupid"},
        {id:63,title:"Deadeye"},
        {id:62,title:"Deadly"},
        {id:36,title:"Demoralize"},
        {id:86,title:"Disarm"},
        {id:105,title:"Double Tap"},
        {id:74,title:"Double-edged"},
        {id:87,title:"Empower"},
        {id:56,title:"Eviscerate"},
        {id:75,title:"Execute"},
        {id:1,title:"Expose"},
        {id:82,title:"Finale"},
        {id:79,title:"Focus"},
        {id:38,title:"Freeze"},
        {id:80,title:"Frenzy"},
        {id:64,title:"Fury"},
        {id:53,title:"Grace"},
        {id:34,title:"Hazardous"},
        {id:83,title:"Home run"},
        {id:115,title:"Immutable"},
        {id:26,title:"Impassable"},
        {id:17,title:"Impenetrable"},
        {id:22,title:"Imperviable"},
        {id:15,title:"Impregnable"},
        {id:92,title:"Insurmountable"},
        {id:91,title:"Invulnerable"},
        {id:102,title:"Irradiate"},
        {id:121,title:"Irrepressible"},
        {id:112,title:"Kinetokinesis"},
        {id:89,title:"Lacerate"},
        {id:61,title:"Motivation"},
        {id:59,title:"Paralyze"},
        {id:84,title:"Parry"},
        {id:101,title:"Penetrate"},
        {id:21,title:"Plunder"},
        {id:68,title:"Powerful"},
        {id:14,title:"Proficience"},
        {id:66,title:"Puncture"},
        {id:88,title:"Quicken"},
        {id:90,title:"Radiation Protection"},
        {id:65,title:"Rage"},
        {id:41,title:"Revitalize"},
        {id:43,title:"Roshambo"},
        {id:120,title:"Shock"},
        {id:44,title:"Slow"},
        {id:104,title:"Smash"},
        {id:73,title:"Smurf"},
        {id:71,title:"Specialist"},
        {id:35,title:"Spray"},
        {id:37,title:"Storage"},
        {id:20,title:"Stricken"},
        {id:58,title:"Stun"},
        {id:60,title:"Suppress"},
        {id:78,title:"Sure Shot"},
        {id:48,title:"Throttle"},
        {id:103,title:"Toxin"},
        {id:81,title:"Warlord"},
        {id:46,title:"Weaken"},
        {id:76,title:"Wind-up"},
        {id:42,title:"Wither"},
    ];

    function loadBonuses() {
        state.bonusList = BONUS_DATA.slice().sort((a, b) => a.title.localeCompare(b.title));
        BONUS_DATA.forEach(b => {
            state.bonusMap[b.id] = b.title;
            state.bonusMap[b.title.toLowerCase()] = b.id;
            state.bonusMap[b.title.toLowerCase().replace(/[\s-]/g, '')] = b.id;
        });

    }

    function formatPrice(p) {
        if (p >= 1e9) return '$' + (p/1e9).toFixed(2) + 'B';
        if (p >= 1e6) return '$' + (p/1e6).toFixed(2) + 'M';
        if (p >= 1e3) return '$' + (p/1e3).toFixed(1) + 'K';
        return '$' + p.toLocaleString();
    }

    function formatDate(ts) {
        const d = new Date(ts * 1000);
        const now = new Date();
        const diff = Math.floor((now - d) / 86400000);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return diff + 'd ago';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function getBonusName(id) {
        return state.bonusMap[id] || 'Bonus #' + id;
    }

    async function doSearch() {
        state.loading = true;
        state.error = null;
        render();

        try {
            const body = {
                limit: 20,
                offset: state.offset,
                sort_by: 'timestamp',
                sort_order: 'desc'
            };

            const f = state.filters;
            const marketSettings = settingsManager.getMarketSettings();

            if (f.itemName) body.item_name = f.itemName;

            // Bonus 1 with its own value range (unless disabled)
            if (f.bonus1Id) {
                body.bonus1_id = parseInt(f.bonus1Id);
                if (!marketSettings.disableBonusValueFilter) {
                    if (f.bonus1Min) body.bonus1_value_min = parseFloat(f.bonus1Min);
                    if (f.bonus1Max) body.bonus1_value_max = parseFloat(f.bonus1Max);
                }
            }

            // Bonus 2 with its own value range (unless disabled)
            if (f.bonus2Id) {
                body.bonus2_id = parseInt(f.bonus2Id);
                if (!marketSettings.disableBonusValueFilter) {
                    if (f.bonus2Min) body.bonus2_value_min = parseFloat(f.bonus2Min);
                    if (f.bonus2Max) body.bonus2_value_max = parseFloat(f.bonus2Max);
                }
            }

            // Quality range (unless disabled)
            if (!marketSettings.disableQualityFilter) {
                if (f.qualityMin) body.quality_min = parseFloat(f.qualityMin);
                if (f.qualityMax) body.quality_max = parseFloat(f.qualityMax);
            }

            // Check client-side cache first
            const cacheKey = JSON.stringify(body);
            const cached = searchCache.get(cacheKey);
            if (cached) {
                state.results = cached.auctions || [];
                state.total = cached.total || 0;
            } else {
                const data = await apiRequest('search-auctions', 'POST', body);
                state.results = data.auctions || [];
                state.total = data.total || 0;
                searchCache.set(cacheKey, data);
            }
        } catch (e) {
            console.error('[AH] Search error:', e);
            state.error = e.message;
            state.results = [];
            state.total = 0;
        }

        state.loading = false;
        state.lastSearchedItem = state.filters.itemName;
        render();
    }

    // Helper to make market API request
    function marketApiRequest(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 15000,
                onload: function(response) {
                    try {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(JSON.parse(response.responseText));
                        } else {
                            reject(new Error(`API error: ${response.status}`));
                        }
                    } catch (e) {
                        reject(new Error('Parse error'));
                    }
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    // Build market search params (without tab - that's added separately)
    function buildMarketParams() {
        const f = state.filters;
        const marketSettings = settingsManager.getMarketSettings();
        const params = new URLSearchParams();

        // Item name filter: weaponName for weapons, armorPiece for armor
        if (f.itemName) {
            if (state.itemType === 'armor') {
                params.set('armorPiece', f.itemName);
            } else {
                params.set('weaponName', f.itemName);
            }
        }

        // Bonus 1 (name, not ID)
        if (f.bonus1Id) {
            const bonusName = state.bonusMap[f.bonus1Id];
            if (bonusName) params.set('bonus1', bonusName);

            // Bonus value range (unless disabled)
            if (!marketSettings.disableBonusValueFilter) {
                if (f.bonus1Min) params.set('minBonus1Value', f.bonus1Min);
                if (f.bonus1Max) params.set('maxBonus1Value', f.bonus1Max);
            }
        }

        // Bonus 2 (name, not ID)
        if (f.bonus2Id) {
            const bonusName = state.bonusMap[f.bonus2Id];
            if (bonusName) params.set('bonus2', bonusName);

            // Bonus value range (unless disabled)
            if (!marketSettings.disableBonusValueFilter) {
                if (f.bonus2Min) params.set('minBonus2Value', f.bonus2Min);
                if (f.bonus2Max) params.set('maxBonus2Value', f.bonus2Max);
            }
        }

        // Quality range (unless disabled)
        if (!marketSettings.disableQualityFilter) {
            if (f.qualityMin) params.set('minQuality', f.qualityMin);
            if (f.qualityMax) params.set('maxQuality', f.qualityMax);
        }

        // Sort by price ascending
        params.set('sortField', 'price');
        params.set('sortDirection', 'asc');

        return params;
    }

    async function doMarketSearch() {
        state.marketLoading = true;
        state.marketError = null;
        render();

        try {
            const params = buildMarketParams();

            // Use detected item type (weapon or armor)
            const tab = state.itemType === 'armor' ? 'armor' : 'weapons';
            params.set('tab', tab);

            const url = `${CONFIG.WEAV3R_API}?${params.toString()}`;


            const data = await marketApiRequest(url);
            state.marketResults = data.weapons || [];
            state.marketTotal = data.total_count || 0;

        } catch (e) {
            console.error('[AH] Market search error:', e);
            state.marketError = e.message;
            state.marketResults = [];
            state.marketTotal = 0;
        }

        state.marketLoading = false;
        state.lastMarketSearchedItem = state.filters.itemName;
        render();
    }

    function render() {
        const overlay = document.getElementById('ah-overlay');
        const modal = document.getElementById('ah-modal');

        overlay.className = state.open ? 'ah-overlay open' : 'ah-overlay';
        modal.className = state.open ? 'ah-modal open' : 'ah-modal';

        if (!state.open) return;

        if (state.activeTab === 'search') {
            renderSearchTab(modal);
        } else if (state.activeTab === 'market') {
            renderMarketTab(modal);
        } else {
            renderSettingsTab(modal);
        }
    }

    function renderSearchTab(modal) {
        const f = state.filters;
        const marketSettings = settingsManager.getMarketSettings();
        const bonusOptions = state.bonusList.map(b =>
            `<option value="${b.id}">${b.title}</option>`
        ).join('');

        modal.innerHTML = `
            <div class="ah-header">
                <h3 class="ah-title">Price History</h3>
                <button class="ah-close" id="ah-close">&times;</button>
            </div>
            <div class="ah-tabs">
                <button class="ah-tab active" data-tab="search">History</button>
                <button class="ah-tab" data-tab="market">Market & Bazaar</button>
                <button class="ah-tab" data-tab="settings">Settings</button>
            </div>
            <div class="ah-filters">
                <div class="ah-filter-row">
                    <div class="ah-field wide">
                        <label>Item Name</label>
                        <input type="text" id="ah-item-name" value="${f.itemName}" placeholder="e.g. Kodachi, AK-47">
                    </div>
                    <button class="ah-search-btn" id="ah-do-search">Search</button>
                </div>
                <div class="ah-filter-row">
                    <div class="ah-bonus-row">
                        <div class="ah-field bonus-select">
                            <label>Bonus 1</label>
                            <select id="ah-bonus1">
                                <option value="">Any</option>
                                ${bonusOptions}
                            </select>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Min</label>
                            <input type="number" id="ah-bonus1-min" value="${f.bonus1Min}" placeholder="0" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-bonus1-max" value="${f.bonus1Max}" placeholder="200" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                    <div class="ah-bonus-row">
                        <div class="ah-field bonus-select">
                            <label>Bonus 2</label>
                            <select id="ah-bonus2">
                                <option value="">Any</option>
                                ${bonusOptions}
                            </select>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Min</label>
                            <input type="number" id="ah-bonus2-min" value="${f.bonus2Min}" placeholder="0" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-bonus2-max" value="${f.bonus2Max}" placeholder="200" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                    <div class="ah-bonus-row quality">
                        <div class="ah-field bonus-val">
                            <label>Quality</label>
                            <input type="number" id="ah-quality-min" value="${f.qualityMin}" placeholder="0" ${marketSettings.disableQualityFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-quality-max" value="${f.qualityMax}" placeholder="200" ${marketSettings.disableQualityFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                </div>
                <div class="ah-filter-row" style="margin-top: 4px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ah-text-secondary);">
                        <input type="checkbox" id="ah-disable-bonus-value" ${marketSettings.disableBonusValueFilter ? 'checked' : ''}>
                        Disable bonus value filter
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ah-text-secondary);margin-left:16px;">
                        <input type="checkbox" id="ah-disable-quality" ${marketSettings.disableQualityFilter ? 'checked' : ''}>
                        Disable quality filter
                    </label>
                </div>
            </div>
            <div class="ah-results">
                ${state.loading ? `
                    <div class="ah-loading"><div class="ah-spinner"></div>Searching...</div>
                ` : state.error ? `
                    <div class="ah-error">Error: ${state.error}</div>
                ` : state.results.length === 0 ? `
                    <div class="ah-empty">No matching sales found</div>
                ` : state.results.map(a => {
                    let bonusHtml = '';
                    if (a.bonus_values && a.bonus_values.length > 0) {
                        bonusHtml = a.bonus_values.map(bv =>
                            `<span class="ah-bonus">${bv.bonus_value != null ? bv.bonus_value + '%' : ''} ${getBonusName(bv.bonus_id)}</span>`
                        ).join('');
                    } else if (a.bonus_ids?.length) {
                        bonusHtml = a.bonus_ids.map(id => `<span class="ah-bonus">${getBonusName(id)}</span>`).join('');
                    }
                    const sellerLink = a.seller_id ? `<a href="https://www.torn.com/profiles.php?XID=${a.seller_id}" target="_blank">${a.seller_name || a.seller_id}</a>` : 'Unknown';
                    const buyerLink = a.buyer_id ? `<a href="https://www.torn.com/profiles.php?XID=${a.buyer_id}" target="_blank">${a.buyer_name || a.buyer_id}</a>` : 'Unknown';
                    return `
                    <div class="ah-item">
                        <div class="ah-item-left">
                            <p class="ah-item-name">${a.item_name}</p>
                            <p class="ah-item-meta">
                                Quality: ${a.stat_quality?.toFixed(1) || '?'}%
                                ${a.stat_damage ? ' · DMG: ' + a.stat_damage.toFixed(1) : ''}
                                ${a.stat_accuracy ? ' · ACC: ' + a.stat_accuracy.toFixed(1) : ''}
                                ${a.stat_armor ? ' · Armor: ' + a.stat_armor.toFixed(1) : ''}
                            </p>
                            ${bonusHtml ? `<div class="ah-item-bonuses">${bonusHtml}</div>` : ''}
                            <p class="ah-players">Seller: ${sellerLink} · Buyer: ${buyerLink}</p>
                        </div>
                        <div class="ah-item-right">
                            <p class="ah-price">${formatPrice(a.price)}</p>
                            <p class="ah-date">${formatDate(a.timestamp)}</p>
                        </div>
                    </div>
                `}).join('')}
            </div>
            <div class="ah-footer">
                <span>${state.total.toLocaleString()} results</span>
                <div class="ah-nav">
                    <button class="ah-nav-btn" id="ah-prev" ${state.offset === 0 ? 'disabled' : ''}>Prev</button>
                    <button class="ah-nav-btn" id="ah-next" ${state.offset + 20 >= state.total ? 'disabled' : ''}>Next</button>
                </div>
            </div>
        `;

        // Set select values
        const bonus1El = document.getElementById('ah-bonus1');
        const bonus2El = document.getElementById('ah-bonus2');
        if (bonus1El) bonus1El.value = f.bonus1Id;
        if (bonus2El) bonus2El.value = f.bonus2Id;

        // Tab switching
        modal.querySelectorAll('.ah-tab').forEach(tab => {
            tab.onclick = () => {
                const newTab = tab.dataset.tab;
                state.activeTab = newTab;
                render();
                // Trigger market search when switching to market tab if no results yet
                if (newTab === 'market' && state.marketResults.length === 0 && !state.marketLoading) {
                    doMarketSearch();
                }
            };
        });

        // Event listeners
        document.getElementById('ah-close').onclick = closeModal;
        document.getElementById('ah-do-search').onclick = () => {
            state.filters.itemName = document.getElementById('ah-item-name').value.trim();
            state.filters.bonus1Id = document.getElementById('ah-bonus1').value;
            state.filters.bonus1Min = document.getElementById('ah-bonus1-min').value;
            state.filters.bonus1Max = document.getElementById('ah-bonus1-max').value;
            state.filters.bonus2Id = document.getElementById('ah-bonus2').value;
            state.filters.bonus2Min = document.getElementById('ah-bonus2-min').value;
            state.filters.bonus2Max = document.getElementById('ah-bonus2-max').value;
            state.filters.qualityMin = document.getElementById('ah-quality-min').value;
            state.filters.qualityMax = document.getElementById('ah-quality-max').value;
            state.offset = 0;
            doSearch();
        };

        // Auto-search if item changed since last search
        if (state.filters.itemName && state.filters.itemName !== state.lastSearchedItem && !state.loading) {
            state.offset = 0;
            doSearch();
        }

        // Filter toggle checkboxes
        document.getElementById('ah-disable-bonus-value').onchange = (e) => {
            settingsManager.setMarketSettings({ disableBonusValueFilter: e.target.checked });
            render();
        };
        document.getElementById('ah-disable-quality').onchange = (e) => {
            settingsManager.setMarketSettings({ disableQualityFilter: e.target.checked });
            render();
        };

        document.getElementById('ah-prev').onclick = () => {
            state.offset = Math.max(0, state.offset - 20);
            doSearch();
        };
        document.getElementById('ah-next').onclick = () => {
            state.offset += 20;
            doSearch();
        };
        document.getElementById('ah-item-name').onkeypress = (e) => {
            if (e.key === 'Enter') document.getElementById('ah-do-search').click();
        };
    }

    function renderMarketTab(modal) {
        const f = state.filters;
        const marketSettings = settingsManager.getMarketSettings();
        const bonusOptions = state.bonusList.map(b =>
            `<option value="${b.id}">${b.title}</option>`
        ).join('');

        // Check if we have no results and filters are enabled
        const noResultsWithFilters = !state.marketLoading && state.marketResults.length === 0 &&
            !state.marketError && (f.bonus1Id || f.qualityMin) &&
            (!marketSettings.disableBonusValueFilter || !marketSettings.disableQualityFilter);

        modal.innerHTML = `
            <div class="ah-header">
                <h3 class="ah-title">Price History</h3>
                <button class="ah-close" id="ah-close">&times;</button>
            </div>
            <div class="ah-tabs">
                <button class="ah-tab" data-tab="search">History</button>
                <button class="ah-tab active" data-tab="market">Market & Bazaar</button>
                <button class="ah-tab" data-tab="settings">Settings</button>
            </div>
            <div class="ah-filters">
                <div class="ah-filter-row">
                    <div class="ah-field wide">
                        <label>Item Name</label>
                        <input type="text" id="ah-item-name" value="${f.itemName}" placeholder="e.g. Kodachi, AK-47">
                    </div>
                    <button class="ah-search-btn" id="ah-do-market-search">Search Market</button>
                </div>
                <div class="ah-filter-row">
                    <div class="ah-bonus-row">
                        <div class="ah-field bonus-select">
                            <label>Bonus 1</label>
                            <select id="ah-bonus1">
                                <option value="">Any</option>
                                ${bonusOptions}
                            </select>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Min</label>
                            <input type="number" id="ah-bonus1-min" value="${f.bonus1Min}" placeholder="0" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-bonus1-max" value="${f.bonus1Max}" placeholder="200" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                    <div class="ah-bonus-row">
                        <div class="ah-field bonus-select">
                            <label>Bonus 2</label>
                            <select id="ah-bonus2">
                                <option value="">Any</option>
                                ${bonusOptions}
                            </select>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Min</label>
                            <input type="number" id="ah-bonus2-min" value="${f.bonus2Min}" placeholder="0" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-bonus2-max" value="${f.bonus2Max}" placeholder="200" ${marketSettings.disableBonusValueFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                    <div class="ah-bonus-row quality">
                        <div class="ah-field bonus-val">
                            <label>Quality</label>
                            <input type="number" id="ah-quality-min" value="${f.qualityMin}" placeholder="0" ${marketSettings.disableQualityFilter ? 'disabled' : ''}>
                        </div>
                        <div class="ah-field bonus-val">
                            <label>Max</label>
                            <input type="number" id="ah-quality-max" value="${f.qualityMax}" placeholder="200" ${marketSettings.disableQualityFilter ? 'disabled' : ''}>
                        </div>
                    </div>
                </div>
                <div class="ah-filter-row" style="margin-top: 4px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ah-text-secondary);">
                        <input type="checkbox" id="ah-disable-bonus-value" ${marketSettings.disableBonusValueFilter ? 'checked' : ''}>
                        Disable bonus value filter
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ah-text-secondary);margin-left:16px;">
                        <input type="checkbox" id="ah-disable-quality" ${marketSettings.disableQualityFilter ? 'checked' : ''}>
                        Disable quality filter
                    </label>
                </div>
            </div>
            <div class="ah-results">
                ${state.marketLoading ? `
                    <div class="ah-loading"><div class="ah-spinner"></div>Searching market...</div>
                ` : state.marketError ? `
                    <div class="ah-error">Error: ${state.marketError}</div>
                ` : noResultsWithFilters ? `
                    <div class="ah-empty">
                        <p>No similar items found on the market.</p>
                        <button class="ah-search-btn" id="ah-disable-filters-btn" style="margin-top:12px;">
                            Disable quality & bonus value filters?
                        </button>
                    </div>
                ` : state.marketResults.length === 0 ? `
                    <div class="ah-empty">No similar items available on the item market or bazaar</div>
                ` : state.marketResults.map(item => {
                    // Build bonus display
                    let bonusHtml = '';
                    if (item.bonuses) {
                        const bonusEntries = Object.values(item.bonuses);
                        bonusHtml = bonusEntries.map(b =>
                            `<span class="ah-bonus">${b.value ? b.value + '% ' : ''}${b.bonus}</span>`
                        ).join('');
                    }

                    // Determine if bazaar or market
                    const isBazaar = item.playerId || item.playerName;
                    const sellerHtml = isBazaar
                        ? `<a href="https://www.torn.com/bazaar.php?userId=${item.playerId}#/" target="_blank">${item.playerName || 'Unknown'}'s Bazaar</a>`
                        : `<span style="color:var(--ah-text-muted);">Market Listing</span>`;

                    return `
                    <div class="ah-item">
                        <div class="ah-item-left">
                            <p class="ah-item-name">${item.itemName}</p>
                            <p class="ah-item-meta">
                                Quality: ${parseFloat(item.quality).toFixed(1)}%
                                ${item.damage ? ' · DMG: ' + parseFloat(item.damage).toFixed(1) : ''}
                                ${item.accuracy ? ' · ACC: ' + parseFloat(item.accuracy).toFixed(1) : ''}
                                ${item.rarity ? ' · ' + item.rarity : ''}
                            </p>
                            ${bonusHtml ? `<div class="ah-item-bonuses">${bonusHtml}</div>` : ''}
                            <p class="ah-players">Listed by: ${sellerHtml}</p>
                        </div>
                        <div class="ah-item-right">
                            <p class="ah-price">${formatPrice(item.price)}</p>
                        </div>
                    </div>
                `}).join('')}
            </div>
            <div class="ah-footer">
                <span>${state.marketTotal.toLocaleString()} listings found</span>
                <a href="https://weav3r.dev/" target="_blank" style="color: var(--ah-text-muted); text-decoration: none; font-size: 12px;">Possible thanks to TornW3B</a>
            </div>
        `;

        // Set select values
        const bonus1El = document.getElementById('ah-bonus1');
        const bonus2El = document.getElementById('ah-bonus2');
        if (bonus1El) bonus1El.value = f.bonus1Id;
        if (bonus2El) bonus2El.value = f.bonus2Id;

        // Tab switching
        modal.querySelectorAll('.ah-tab').forEach(tab => {
            tab.onclick = () => {
                const newTab = tab.dataset.tab;
                state.activeTab = newTab;
                render();
                // Trigger market search when switching to market tab if no results yet
                if (newTab === 'market' && state.marketResults.length === 0 && !state.marketLoading) {
                    doMarketSearch();
                }
            };
        });

        // Event listeners
        document.getElementById('ah-close').onclick = closeModal;

        // Disable filters button (when no results)
        const disableFiltersBtn = document.getElementById('ah-disable-filters-btn');
        if (disableFiltersBtn) {
            disableFiltersBtn.onclick = () => {
                settingsManager.setMarketSettings({
                    disableBonusValueFilter: true,
                    disableQualityFilter: true
                });
                doMarketSearch();
            };
        }

        // Filter toggle checkboxes
        document.getElementById('ah-disable-bonus-value').onchange = (e) => {
            settingsManager.setMarketSettings({ disableBonusValueFilter: e.target.checked });
            render();
        };
        document.getElementById('ah-disable-quality').onchange = (e) => {
            settingsManager.setMarketSettings({ disableQualityFilter: e.target.checked });
            render();
        };

        document.getElementById('ah-do-market-search').onclick = () => {
            state.filters.itemName = document.getElementById('ah-item-name').value.trim();
            state.filters.bonus1Id = document.getElementById('ah-bonus1').value;
            state.filters.bonus1Min = document.getElementById('ah-bonus1-min').value;
            state.filters.bonus1Max = document.getElementById('ah-bonus1-max').value;
            state.filters.bonus2Id = document.getElementById('ah-bonus2').value;
            state.filters.bonus2Min = document.getElementById('ah-bonus2-min').value;
            state.filters.bonus2Max = document.getElementById('ah-bonus2-max').value;
            state.filters.qualityMin = document.getElementById('ah-quality-min').value;
            state.filters.qualityMax = document.getElementById('ah-quality-max').value;
            doMarketSearch();
        };

        document.getElementById('ah-item-name').onkeypress = (e) => {
            if (e.key === 'Enter') document.getElementById('ah-do-market-search').click();
        };

        // Auto-search if item changed since last market search
        if (state.filters.itemName && state.filters.itemName !== state.lastMarketSearchedItem && !state.marketLoading) {
            doMarketSearch();
        }
    }

    function renderSettingsTab(modal) {
        const settings = settingsManager.get();
        const defaults = settings.defaults;

        // Build list of configured bonuses
        const configuredBonuses = Object.keys(settings.bonuses).map(id => ({
            id: parseInt(id),
            name: getBonusName(parseInt(id)),
            ...settings.bonuses[id]
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Build list of unconfigured bonuses for the dropdown
        const configuredIds = new Set(Object.keys(settings.bonuses).map(id => parseInt(id)));
        const availableBonuses = state.bonusList.filter(b => !configuredIds.has(b.id));

        modal.innerHTML = `
            <div class="ah-header">
                <h3 class="ah-title">Price History</h3>
                <button class="ah-close" id="ah-close">&times;</button>
            </div>
            <div class="ah-tabs">
                <button class="ah-tab" data-tab="search">History</button>
                <button class="ah-tab" data-tab="market">Market & Bazaar</button>
                <button class="ah-tab active" data-tab="settings">Settings</button>
            </div>
            <div class="ah-settings">
                <div class="ah-settings-section">
                    <h4>Appearance</h4>
                    <div class="ah-settings-row">
                        <label>Theme</label>
                        <div class="ah-theme-row">
                            <button class="ah-theme-btn ${settings.theme === 'system' ? 'active' : ''}" data-theme="system">⚙️ System</button>
                            <button class="ah-theme-btn ${settings.theme === 'light' ? 'active' : ''}" data-theme="light">☀️ Light</button>
                            <button class="ah-theme-btn ${settings.theme === 'dark' ? 'active' : ''}" data-theme="dark">🌙 Dark</button>
                        </div>
                    </div>
                </div>

                <div class="ah-settings-section">
                    <h4>Default Tolerances</h4>
                    <div class="ah-settings-row">
                        <label>Bonus Value</label>
                        <input type="number" id="ah-default-bonus-tol" value="${defaults.bonusTolerance}" min="0" max="100">
                        <span class="ah-unit">± %</span>
                        <span style="color:var(--ah-text-faint);font-size:10px;margin-left:8px">(0 = exact match)</span>
                    </div>
                    <div class="ah-settings-row">
                        <label>Quality</label>
                        <input type="number" id="ah-default-quality-tol" value="${defaults.qualityTolerance}" min="0" max="100" ${defaults.ignoreQuality ? 'disabled' : ''}>
                        <span class="ah-unit">± %</span>
                        <input type="checkbox" id="ah-default-ignore-quality" ${defaults.ignoreQuality ? 'checked' : ''}>
                        <span style="font-size:11px;color:var(--ah-text-secondary);">Any Quality</span>
                    </div>
                </div>

                <div class="ah-settings-section">
                    <h4>Per-Bonus Overrides</h4>
                    <p style="font-size:10px;color:var(--ah-text-faint);margin:0 0 12px;">Configure specific bonuses to use different tolerances than the defaults.</p>

                    ${configuredBonuses.length === 0 ? `
                        <p style="font-size:11px;color:var(--ah-text-faint);text-align:center;padding:20px;">No bonus-specific settings configured yet.</p>
                    ` : configuredBonuses.map(b => `
                        <div class="ah-bonus-settings-item" data-bonus-id="${b.id}">
                            <span class="ah-bonus-name">${b.name}</span>
                            <div class="ah-field-group">
                                <span class="ah-field-label">Bonus ±</span>
                                <input type="number" class="ah-bonus-tol" value="${b.bonusTolerance ?? defaults.bonusTolerance}" min="0" max="100">
                                <span class="ah-field-label">%</span>
                            </div>
                            <div class="ah-field-group">
                                <span class="ah-field-label">Quality ±</span>
                                <input type="number" class="ah-quality-tol" value="${b.ignoreQuality ? '' : (b.qualityTolerance ?? defaults.qualityTolerance)}" min="0" max="100" ${b.ignoreQuality ? 'disabled' : ''}>
                                <span class="ah-field-label">%</span>
                            </div>
                            <div class="ah-field-group">
                                <input type="checkbox" class="ah-ignore-quality" ${b.ignoreQuality ? 'checked' : ''}>
                                <span class="ah-field-label">Any Quality</span>
                            </div>
                            <button class="ah-remove-btn">Remove</button>
                        </div>
                    `).join('')}

                    <div class="ah-add-bonus-row">
                        <select id="ah-add-bonus-select">
                            <option value="">Select a bonus to configure...</option>
                            ${availableBonuses.map(b => `<option value="${b.id}">${b.title}</option>`).join('')}
                        </select>
                        <button class="ah-add-btn" id="ah-add-bonus-btn">Add</button>
                    </div>
                </div>

                <div class="ah-import-export">
                    <button id="ah-export-btn">Export Settings</button>
                    <button id="ah-import-btn">Import Settings</button>
                    <input type="file" id="ah-import-file" class="ah-hidden" accept=".json">
                    <button class="ah-reset-btn" id="ah-reset-btn">Reset All</button>
                </div>
            </div>
        `;

        // Tab switching
        modal.querySelectorAll('.ah-tab').forEach(tab => {
            tab.onclick = () => {
                const newTab = tab.dataset.tab;
                state.activeTab = newTab;
                render();
                // Trigger market search when switching to market tab if no results yet
                if (newTab === 'market' && state.marketResults.length === 0 && !state.marketLoading) {
                    doMarketSearch();
                }
            };
        });

        document.getElementById('ah-close').onclick = closeModal;

        // Theme buttons
        modal.querySelectorAll('.ah-theme-btn').forEach(btn => {
            btn.onclick = () => {
                settingsManager.setTheme(btn.dataset.theme);
                render(); // Re-render to update active state
            };
        });

        // Default tolerance changes
        document.getElementById('ah-default-bonus-tol').onchange = (e) => {
            settingsManager.setDefaults({ bonusTolerance: parseInt(e.target.value) || 0 });
        };
        document.getElementById('ah-default-quality-tol').onchange = (e) => {
            settingsManager.setDefaults({ qualityTolerance: parseInt(e.target.value) || 0 });
        };
        document.getElementById('ah-default-ignore-quality').onchange = (e) => {
            const qualityInput = document.getElementById('ah-default-quality-tol');
            qualityInput.disabled = e.target.checked;
            if (e.target.checked) qualityInput.value = '';
            settingsManager.setDefaults({ ignoreQuality: e.target.checked });
        };

        // Per-bonus settings
        modal.querySelectorAll('.ah-bonus-settings-item').forEach(item => {
            const bonusId = parseInt(item.dataset.bonusId);
            const bonusTolInput = item.querySelector('.ah-bonus-tol');
            const qualityTolInput = item.querySelector('.ah-quality-tol');
            const ignoreQualityCheckbox = item.querySelector('.ah-ignore-quality');
            const removeBtn = item.querySelector('.ah-remove-btn');

            const saveSettings = () => {
                settingsManager.setBonusSettings(bonusId, {
                    bonusTolerance: parseInt(bonusTolInput.value) || 0,
                    qualityTolerance: parseInt(qualityTolInput.value) || 0,
                    ignoreQuality: ignoreQualityCheckbox.checked
                });
            };

            bonusTolInput.onchange = saveSettings;
            qualityTolInput.onchange = saveSettings;
            ignoreQualityCheckbox.onchange = () => {
                qualityTolInput.disabled = ignoreQualityCheckbox.checked;
                if (ignoreQualityCheckbox.checked) qualityTolInput.value = '';
                saveSettings();
            };
            removeBtn.onclick = () => {
                settingsManager.setBonusSettings(bonusId, null);
                render();
            };
        });

        // Add bonus button
        document.getElementById('ah-add-bonus-btn').onclick = () => {
            const select = document.getElementById('ah-add-bonus-select');
            const bonusId = parseInt(select.value);
            if (bonusId) {
                const defaults = settingsManager.getDefaults();
                settingsManager.setBonusSettings(bonusId, {
                    bonusTolerance: defaults.bonusTolerance,
                    qualityTolerance: defaults.qualityTolerance,
                    ignoreQuality: false
                });
                render();
            }
        };

        // Export
        document.getElementById('ah-export-btn').onclick = () => {
            const json = settingsManager.export();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ah-price-checker-settings.json';
            a.click();
            URL.revokeObjectURL(url);
        };

        // Import
        document.getElementById('ah-import-btn').onclick = () => {
            document.getElementById('ah-import-file').click();
        };
        document.getElementById('ah-import-file').onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    if (settingsManager.import(ev.target.result)) {
                        render();
                    } else {
                        alert('Invalid settings file');
                    }
                };
                reader.readAsText(file);
            }
        };

        // Reset
        document.getElementById('ah-reset-btn').onclick = () => {
            if (confirm('Reset all settings to defaults?')) {
                settingsManager.reset();
                render();
            }
        };
    }

    function openModal(itemName, parsedBonuses, quality, itemType = 'weapon') {

        state.open = true;
        state.activeTab = 'search'; // Always open to search tab
        state.offset = 0;
        state.filters.itemName = itemName || '';
        state.itemType = itemType; // Store item type for market search

        // Restore saved position or center the modal
        const modal = document.getElementById('ah-modal');
        if (modal && isPC()) {
            const savedPos = positionManager.load();
            if (savedPos && savedPos.top && savedPos.left) {
                // Restore saved position
                modal.style.transform = 'none';
                modal.style.top = savedPos.top;
                modal.style.left = savedPos.left;
                if (savedPos.width) modal.style.width = savedPos.width + 'px';
                if (savedPos.height) modal.style.height = savedPos.height + 'px';
            } else {
                // Center the modal
                modal.style.transform = 'translate(-50%, -50%)';
                modal.style.top = '50%';
                modal.style.left = '50%';
            }
        } else if (modal) {
            // Mobile: always center
            modal.style.transform = 'translate(-50%, -50%)';
            modal.style.top = '50%';
            modal.style.left = '50%';
        }

        // Helper to calculate min/max based on tolerance percentage
        const calcRange = (value, tolerancePct) => {
            if (!value) return { min: '', max: '' };
            if (tolerancePct === 0) {
                // Exact match
                return { min: value.toString(), max: value.toString() };
            }
            const factor = tolerancePct / 100;
            return {
                min: Math.floor(value * (1 - factor)).toString(),
                max: Math.ceil(value * (1 + factor)).toString()
            };
        };

        // Set bonus 1 with its value range based on per-bonus settings
        if (parsedBonuses?.[0]) {
            const bonusId = parsedBonuses[0].id;
            state.filters.bonus1Id = bonusId?.toString() || '';
            const val = parsedBonuses[0].value;
            const tolerance = settingsManager.getEffectiveBonusTolerance(bonusId);
            const range = calcRange(val, tolerance);
            state.filters.bonus1Min = range.min;
            state.filters.bonus1Max = range.max;
        } else {
            state.filters.bonus1Id = '';
            state.filters.bonus1Min = '';
            state.filters.bonus1Max = '';
        }

        // Set bonus 2 with its value range based on per-bonus settings
        if (parsedBonuses?.[1]) {
            const bonusId = parsedBonuses[1].id;
            state.filters.bonus2Id = bonusId?.toString() || '';
            const val = parsedBonuses[1].value;
            const tolerance = settingsManager.getEffectiveBonusTolerance(bonusId);
            const range = calcRange(val, tolerance);
            state.filters.bonus2Min = range.min;
            state.filters.bonus2Max = range.max;
        } else {
            state.filters.bonus2Id = '';
            state.filters.bonus2Min = '';
            state.filters.bonus2Max = '';
        }

        // Quality based on per-bonus settings (use first bonus's quality settings)
        // If first bonus has "ignore quality" enabled, leave quality fields empty
        const primaryBonusId = parsedBonuses?.[0]?.id;
        const qualityTolerance = settingsManager.getEffectiveQualityTolerance(primaryBonusId);

        if (qualityTolerance === null) {
            // Quality should be ignored for this bonus
            state.filters.qualityMin = '';
            state.filters.qualityMax = '';
        } else if (quality) {
            const qualRange = calcRange(quality, qualityTolerance);
            state.filters.qualityMin = qualRange.min;
            state.filters.qualityMax = qualRange.max;
        } else {
            state.filters.qualityMin = '';
            state.filters.qualityMax = '';
        }

        state.results = [];
        state.total = 0;
        render();
        doSearch();
    }

    function closeModal() {
        state.open = false;
        render();
    }

    // Detect current page type
    function getPageType() {
        const url = window.location.href;
        if (url.includes('amarket.php')) return 'auction';
        if (url.includes('sid=ItemMarket')) return 'itemmarket';
        if (url.includes('item.php')) return 'inventory';
        if (url.includes('bazaar.php')) return 'bazaar';
        if (url.includes('displaycase.php')) return 'displaycase';
        if (url.includes('factions.php') && url.includes('armoury')) return 'armory';
        return 'unknown';
    }

    // Check if item has auction-eligible rarity (Yellow, Orange, Red quality OR extraordinary circulation rarity)
    function hasAuctionRarity(container) {
        // Check for quality rarity (Yellow, Orange, Red)
        const rarityEl = container.querySelector('[class*="rarity___"]');
        if (rarityEl) {
            const className = rarityEl.className.toLowerCase();
            const text = rarityEl.textContent.toLowerCase();
            if (className.includes('yellow') || className.includes('orange') || className.includes('red') ||
                text.includes('yellow') || text.includes('orange') || text.includes('red')) {
                return true;
            }
        }

        // Check for rare circulation rarity (very rare items that can be auctioned)
        const rareIcon = container.querySelector('.extraordinary-rarity-icon, .extremely-rare-rarity-icon, [class*="extraordinary"], [class*="extremely-rare"]');
        if (rareIcon) {
            return true;
        }

        return false;
    }

    // Parse item data from auction house row
    function parseAuctionRow(row) {
        // Prefer the visible row title for item name
        let itemName = row.querySelector('.item-name')?.textContent.trim() || '';

        // Parse the expanded info using the same logic as item market/inventory/display case
        const expandedInfo = row.querySelector('.show-item-info');
        if (expandedInfo) {
            const parsed = parseItemMarketRow(expandedInfo);

            return {
                itemName: itemName || parsed.itemName || '',
                parsedBonuses: parsed.parsedBonuses || [],
                quality: parsed.quality ?? null,
                itemType: parsed.itemType || 'weapon'
            };
        }

        return {
            itemName,
            parsedBonuses: [],
            quality: null,
            itemType: 'weapon'
        };
    }

    // Parse item data from item market
    function parseItemMarketRow(container) {
        let itemName = '';
        let parsedBonuses = [];
        let quality = null;
        let itemType = 'weapon'; // Default to weapon

        // Get item name from description bold text
        const nameEl = container.querySelector('.description___xJ1N5 .bold');
        if (nameEl) {
            itemName = nameEl.textContent.trim();
            // Remove "The " prefix if present (e.g., "The Riot Body" -> "Riot Body")
            itemName = itemName.replace(/^The\s+/i, '');
        }

        // Get all property wrappers (use li elements to avoid duplicates)
        const properties = container.querySelectorAll('li.propertyWrapper___xSOH1');
        for (const prop of properties) {
            const titleEl = prop.querySelector('.title___DbORn');
            if (!titleEl) continue;
            const title = titleEl.textContent.trim();

            // Detect item type based on stats
            if (title === 'Damage:') {
                itemType = 'weapon';
            } else if (title === 'Armor:') {
                itemType = 'armor';
            }

            if (title === 'Quality:') {
                const valueEl = prop.querySelector('[aria-label*="Quality"]');
                if (valueEl) {
                    const match = valueEl.getAttribute('aria-label')?.match(/([\d.]+)%?\s*Quality/i);
                    if (match) {
                        quality = parseFloat(match[1]);
                    }
                }
            }

            if (title === 'Bonus:') {
                const valueEl = prop.querySelector('[aria-label*="Bonus"]');
                if (valueEl) {
                    const ariaLabel = valueEl.getAttribute('aria-label') || '';
                    // Parse bonuses with values: "20% Impregnable Bonus" or "3 T Disarm Bonus"
                    // Also parse bonuses without values: " Irradiate Bonus"
                    let bonusValue = null;
                    let bonusName = null;

                    // Try to match with numeric value first
                    const matchWithValue = ariaLabel.match(/([\d.]+)\s*(%|T)?\s*(.+?)\s*Bonus/i);
                    if (matchWithValue) {
                        bonusValue = parseFloat(matchWithValue[1]);
                        bonusName = matchWithValue[3].trim();
                    } else {
                        // Try to match without numeric value (e.g., " Irradiate Bonus")
                        const matchNoValue = ariaLabel.match(/^\s*(.+?)\s*Bonus/i);
                        if (matchNoValue) {
                            bonusName = matchNoValue[1].trim();
                        }
                    }

                    if (bonusName) {
                        const bonusNameKey = bonusName.toLowerCase().replace(/[\s-]/g, '');
                        let bonusId = state.bonusMap[bonusNameKey];
                        if (!bonusId) {
                            bonusId = state.bonusMap[bonusName.toLowerCase()];
                        }
                        if (bonusId) {
                            parsedBonuses.push({ id: bonusId, value: bonusValue });
                        }

                    }
                }
            }
        }


        return { itemName, parsedBonuses, quality, itemType };
    }

    function injectButtons() {
        const pageType = getPageType();

        if (pageType === 'auction') {
            injectAuctionButtons();
        } else if (pageType === 'itemmarket') {
            injectItemMarketButtons();
        } else if (pageType === 'inventory' || pageType === 'displaycase') {
            // Inventory and display case have identical DOM structure
            injectInventoryButtons();
        } else if (pageType === 'bazaar') {
            injectBazaarButtons();
        } else if (pageType === 'armory') {
            injectArmoryButtons();
        }
    }

    function injectAuctionButtons() {
        const allLis = document.querySelectorAll('li');
        Array.from(allLis).forEach(li => {
            if (!li.querySelector('.item-cont-wrap')) return;

            const expandedInfo = li.querySelector('.show-item-info');
            if (!expandedInfo || expandedInfo.style.display === 'none') {
                const existingBtn = li.querySelector('.ah-btn');
                if (existingBtn) existingBtn.remove();
                return;
            }

            if (li.querySelector('.ah-btn')) return;

            const btn = document.createElement('button');
            btn.className = 'ah-btn';
            btn.textContent = 'Price Check';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const data = parseAuctionRow(li);
                openModal(data.itemName, data.parsedBonuses, data.quality, data.itemType);
            };

            const descWrapper = expandedInfo.querySelector('.descriptionWrapper___Lh0y0');
            if (descWrapper) {
                descWrapper.style.position = 'relative';
                descWrapper.appendChild(btn);
            } else {
                expandedInfo.appendChild(btn);
            }
        });
    }

    function injectItemMarketButtons() {
        // Find item info containers in the item market
        const containers = document.querySelectorAll('.itemInfoWrapper___nA_eu, [class*="itemInfo___"]');
        Array.from(containers).forEach(container => {
            // Skip if button already exists
            if (container.querySelector('.ah-btn')) return;

            // Only show button for Yellow, Orange, Red rarity items
            if (!hasAuctionRarity(container)) return;

            const btn = document.createElement('button');
            btn.className = 'ah-btn';
            btn.textContent = 'Price Check';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const data = parseItemMarketRow(container);
                openModal(data.itemName, data.parsedBonuses, data.quality, data.itemType);
            };

            // Place button in description wrapper
            const descWrapper = container.querySelector('.descriptionWrapper___Lh0y0');
            if (descWrapper) {
                descWrapper.style.position = 'relative';
                descWrapper.appendChild(btn);
            } else {
                // Fallback: place in item-info div
                const itemInfo = container.querySelector('[class*="itemInfo___"]') || container;
                itemInfo.style.position = 'relative';
                itemInfo.appendChild(btn);
            }
        });
    }

    function injectInventoryButtons() {
        // Find expanded item info in inventory (li.show-item-info)
        const containers = document.querySelectorAll('li.show-item-info');
        Array.from(containers).forEach(container => {
            // Skip if button already exists
            if (container.querySelector('.ah-btn')) return;

            // Only show button for Yellow, Orange, Red rarity items
            if (!hasAuctionRarity(container)) return;

            const btn = document.createElement('button');
            btn.className = 'ah-btn';
            btn.textContent = 'Price Check';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Reuse item market parser - same DOM structure
                const data = parseItemMarketRow(container);
                openModal(data.itemName, data.parsedBonuses, data.quality, data.itemType);
            };

            // Place button in description wrapper
            const descWrapper = container.querySelector('.descriptionWrapper___Lh0y0');
            if (descWrapper) {
                descWrapper.style.position = 'relative';
                descWrapper.appendChild(btn);
            } else {
                const itemInfo = container.querySelector('[class*="itemInfo___"]') || container;
                itemInfo.style.position = 'relative';
                itemInfo.appendChild(btn);
            }
        });
    }

    function injectBazaarButtons() {
        // Find expanded item info in bazaar (div.info___liccG.show-item-info or div.show-item-info)
        const containers = document.querySelectorAll('div.show-item-info, [class*="info___"].show-item-info');
        Array.from(containers).forEach(container => {
            // Skip if button already exists
            if (container.querySelector('.ah-btn')) return;

            // Only show button for Yellow, Orange, Red rarity items
            if (!hasAuctionRarity(container)) return;

            const btn = document.createElement('button');
            btn.className = 'ah-btn';
            btn.textContent = 'Price Check';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Reuse item market parser - same DOM structure
                const data = parseItemMarketRow(container);
                openModal(data.itemName, data.parsedBonuses, data.quality, data.itemType);
            };

            // Place button in description wrapper
            const descWrapper = container.querySelector('.descriptionWrapper___Lh0y0');
            if (descWrapper) {
                descWrapper.style.position = 'relative';
                descWrapper.appendChild(btn);
            } else {
                const itemInfo = container.querySelector('[class*="itemInfo___"]') || container;
                itemInfo.style.position = 'relative';
                itemInfo.appendChild(btn);
            }
        });
    }

    function injectArmoryButtons() {
        // Find expanded item info in faction armory (div.view-item-info with display:block)
        const containers = document.querySelectorAll('div.view-item-info');
        Array.from(containers).forEach(container => {
            // Skip if not visible
            if (container.style.display === 'none') return;

            // Skip if button already exists
            if (container.querySelector('.ah-btn')) return;

            // Only show button for Yellow, Orange, Red rarity items
            if (!hasAuctionRarity(container)) return;

            const btn = document.createElement('button');
            btn.className = 'ah-btn';
            btn.textContent = 'Price Check';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Reuse item market parser - same DOM structure
                const data = parseItemMarketRow(container);
                openModal(data.itemName, data.parsedBonuses, data.quality, data.itemType);
            };

            // Place button in description wrapper
            const descWrapper = container.querySelector('.descriptionWrapper___Lh0y0');
            if (descWrapper) {
                descWrapper.style.position = 'relative';
                descWrapper.appendChild(btn);
            } else {
                const itemInfo = container.querySelector('[class*="itemInfo___"]') || container;
                itemInfo.style.position = 'relative';
                itemInfo.appendChild(btn);
            }
        });
    }

    function observe() {
        const observer = new MutationObserver(() => setTimeout(injectButtons, 200));
        observer.observe(document.body, { childList: true, subtree: true });
    }

    async function init() {

        createModal();
        loadBonuses();
        injectButtons();
        observe();
        setInterval(injectButtons, 2000);

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
