# Torn Scripts

Personal collection of Tampermonkey / Torn PDA userscripts for Torn City (torn.com).

## Current script

**`TORN-RW-trading-hub.user.js`**

Context / memory for it lives in **GitHub**, not in docs:
- Recent commits — what's been done
- Open issues — what's left

To switch scripts: change the filename on the line above (on my command).

## Rules

- Work the script file only. Don't create or update docs, test files, or memory files unless asked.
- **Torn API v2 only** — never v1 unless v2 has no equivalent.
- Userscript change → bump `@version` and `SCRIPT_VERSION` together.
- Commit + push after a change. No separate doc/test commits.
- PowerShell: `gh` is only at `C:\Program Files\GitHub CLI\gh.exe`; pass long bodies via `--body-file`, never inline.
