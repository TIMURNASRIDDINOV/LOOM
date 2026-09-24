# LOOM — notes for Claude

## Work comes from Jira

The backlog lives in Jira Cloud — **loomdesign.atlassian.net, project LOOM**, set up like DOMO's Jira. Read `docs/prd/README.md` once; the short version:

- **Two boards.** *Feature Management* holds **epics only** — each epic is a PRD titled `PRD-NNN — <title>`, its description is the PRD. *Micro Management* holds the **tickets** (tasks, stories, bugs), each a child of its epic.
- **Ticket flow:** PM → Ready for Dev → Development → Content → Redevelopment → Ready for Test → QA → Done. **PM** is the return state for unclear requirements or scope changes; **Content** is translations, copy and media (uz / ru / en); **Redevelopment** is the QA bug-fix loop and is entered only from QA. Epics move PO (PRD) → PM → Ready for Dev → Development → Ready for Test → QA → Done by hand.
- **Picking up a ticket:** read the ticket, its epic and any "Blocks" links; set **Story Points** and **Developer Estimated Days**, then move it Ready for Dev → Development and assign yourself. Jira refuses that move until both estimates are set. The acceptance criteria in the ticket are the definition of done — if they are ambiguous, send it back to PM instead of guessing.
- **Finishing:** branch `LOOM-<n>-<slug>` off `main`, put the key in the PR title, and when the code is done add the PR link and a short implementation summary to the ticket and move it to Ready for Test (or Content when strings, copy or media still need work). One ticket per PR.
- **If the scope turns out different** from the epic, update the epic description and say so in the PR. New work you notice becomes a new ticket under the relevant epic, not part of the current PR.
- **Jira access:** this repo has no Jira connector. The DOMO gateway's Jira tools point at a different company's Jira — never put LOOM data there. Ask the founder how to reach LOOM's Jira.
- **Never put vulnerability details in Jira, an issue, a PR, a commit message or a doc** — this repo is public and Jira is shared. Security findings are GitHub **draft security advisories** (`gh api repos/{owner}/{repo}/security-advisories`); public text says only "security context is tracked in a private advisory".

## Traps in this repo

- **The repo root is the Cloudflare Pages deploy root.** No build step: every file here is served on loomdesign.uz. Don't commit secrets, tokens, test credentials or throwaway reports at the root.
- **Static assets are cached immutably for a year.** Editing anything under `assets/`, `admin/assets/` or the root `.js`/`.css` bundles ships only if you bump its `?v=` in every HTML file that references it. See the contract at the top of `_headers`.
- **The customer site and the admin panel have different design systems** on purpose (`assets/theme.css` vs `admin/assets/theme.css`). Don't unify them.
- **Deploys and native builds are run by the founder**, not by Claude: `wrangler deploy`, D1 migrations against production, and EAS builds.
