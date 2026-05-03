# Claude Session Memory — Torn Scripts

_Active memory is managed by the auto-memory system and shown at session start via the system context. This file exists only for the SessionStart hook._

## Known limitations (non-derivable from code)

### Torn PDA — TornW3B cross-origin fetch (non-fixable)
`GM_xmlhttpRequest` on Torn PDA's WebView does NOT bypass page CSP. `weav3r.dev` calls fail silently; script falls back to Torn API data only. Console errors on PDA are expected — not a bug to fix.
