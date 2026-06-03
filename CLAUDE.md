# Torn Scripts

Personal collection of Tampermonkey / Torn PDA userscripts for Torn City (torn.com).

## Current script

**`TORN-RW-trading-hub.user.js`**

Context / memory for it lives in **GitHub**, not in docs:
- Recent commits — what's been done
- Open issues — what's left

To switch scripts: change the filename on the line above (on my command).

## Rules

- Work the script file only. Don't create or update docs or memory files unless asked.
- Tests: only add or update them when it unequivocally makes more sense to test the slice than not — e.g. pure logic with branchy edge cases the acceptance criteria explicitly call out. When in doubt, skip the test.
- **Torn API v2 only** — never v1 unless v2 has no equivalent.
- Userscript change → bump `@version` and `SCRIPT_VERSION` together.
- Commit + push after a change. No separate doc/test commits.
- Shell: use the PowerShell tool by default, never the Bash tool. This is a Windows machine; reaching for Bash first wastes a failed call before falling back.
- PowerShell: `gh` is only at `C:\Program Files\GitHub CLI\gh.exe`; pass long bodies via `--body-file`, never inline.
