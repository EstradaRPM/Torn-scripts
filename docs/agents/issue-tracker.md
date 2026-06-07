# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. In PowerShell, use `& 'C:\Program Files\GitHub CLI\gh.exe'` for all operations. Pass long bodies via `--body-file`, never inline.

## Conventions

- **Create an issue**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue create --title "..." --body-file <path>`.
- **Read an issue**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue comment <number> --body-file <path>`
- **Apply / remove labels**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `& 'C:\Program Files\GitHub CLI\gh.exe' issue close <number>`; add any closing note with the comment command above.

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `& 'C:\Program Files\GitHub CLI\gh.exe' issue view <number> --comments`.
