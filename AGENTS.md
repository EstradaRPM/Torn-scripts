# Torn Scripts Agent Start Here

This repo is a multi-script workspace. Do not assume every file is current.

Before changing anything, read:

1. `docs/agent-contract.md`
2. `docs/current-rwth.md` when working on `TORN-RW-trading-hub.user.js`
3. `docs/doc-authority.md` before using any docs as implementation guidance
4. `docs/test-policy.md` before running or changing tests

Current priority unless the user says otherwise:

- Finish `TORN-RW-trading-hub.user.js`
- Keep old docs, audits, PRDs, community notes, and reference scripts from overriding the current script

Hard rules:

- Ask before deleting, moving, archiving, or rewriting docs.
- Ask before broad refactors or cross-script changes.
- Do not treat reference/community/forum material as implementation authority.
- Do not infer "no tests"; use the scoped test policy.
- Userscript change -> bump `@version` and `SCRIPT_VERSION` together.
- Torn API v2 only for new work unless v2 has no equivalent.
- PowerShell by default on this Windows machine.
