# RW Auction Advisor — Ledger Roadmap

Pending implementation. Each step is a separate session with user confirmation before starting. All changes go in `torn-rw-auction-advisor-v1.user.js`. Increment the minor version for each.

**Step A — Result capture (version → 1.22.0)**
Add a `result` field UI per ledger entry. Each row in the ledger table gets
a compact dropdown: `—` / `Won` / `Lost` / `Passed`. On change, update
`entry.result` in `MEM.ledger` and re-persist via `Store.set(KEYS.LEDGER, ...)`.
No other changes needed — the Result column already exists as a placeholder.

**Step B — P&L calculation (version → 1.23.0)**
For entries with `result === 'Won'`, add an "Actual sell price" input per row.
On blur/enter: compute `actualNet = sellPrice × (1 − marketFee) × (1 − mugBuffer) − entry.currentBid`.
Display `actualNet` alongside the projected max offer. Add `actualSellPrice`
and `actualNet` fields to the entry schema and persist.

**Step C — CSV export (version → 1.24.0)**
Add a "Copy CSV" button to the ledger header. On click, serialize all
`MEM.ledger` entries to a comma-separated string (one header row + one row
per entry, all columns including result and actualNet) and copy to clipboard
via `navigator.clipboard.writeText()`. Show a brief "Copied!" confirmation
in the button label that resets after 2 seconds.

**Step D — Filtering (version → 1.25.0)**
Add a filter bar above the ledger table with four controls:
- Item set: `All` / `Riot` / `Assault` (derive from `entry.itemName`)
- Rarity: `All` / `yellow` / `orange` / `red`
- Outcome: `All` / `Won` / `Lost` / `Passed` / `Pending`
- Date range: two `<input type="date">` fields for start/end

Filter state is held in a local `ledgerFilter` object (not persisted). Apply
filters inside `renderLedger()` before building the table rows.

**Step E — Summary stats (version → 1.26.0)**
Add a summary bar between the ledger header and the filter bar showing:
- Total entries
- Win rate (Won ÷ decided entries, as %)
- Average actual ROI (mean of `actualNet / currentBid` for Won entries)
- Total P&L (sum of all `actualNet` values for Won entries)

Render the summary bar inside `renderLedger()` before the table. Display `—`
for any stat that requires data not yet available (e.g. no Won entries yet).
