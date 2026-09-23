# LOOM — notes for Claude

## Work comes from Jira

The backlog lives in Jira Cloud — **loomdesign.atlassian.net, project KAN** ("LOOM Progress panel"). Read `docs/prd/README.md` once; the short version:

- **A PRD is an Epic** titled `PRD-NNN — <title>`; its description is the PRD. **Tasks are its children** (the epic is their parent). Before starting a task, read the task, its epic, and any linked blockers. The acceptance criteria in the task are the definition of done — if they are ambiguous, say so instead of guessing.
- **Branch** `KAN-<n>-<slug>` off `main`; put the key in the PR title too, so Jira links branch, commits and PR to the task. One task per PR.
- **If the scope turns out different** from the epic, update the epic description and say so in the PR — do not let the task and the epic disagree.
- **New work you notice** becomes a new task under the relevant epic, not part of the current PR.
- **Jira access:** this repo has no Jira connector. The DOMO gateway's Jira tools point at a different company's Jira — never put LOOM data there. Ask the founder how to reach KAN.
- **Never put vulnerability details in Jira, an issue, a PR, a commit message or a doc** — this repo is public and Jira is shared. Security findings are GitHub **draft security advisories** (`gh api repos/{owner}/{repo}/security-advisories`); public text says only "security context is tracked in a private advisory".

## Traps in this repo

- **The repo root is the Cloudflare Pages deploy root.** No build step: every file here is served on loomdesign.uz. Don't commit secrets, tokens, test credentials or throwaway reports at the root.
- **Static assets are cached immutably for a year.** Editing anything under `assets/`, `admin/assets/` or the root `.js`/`.css` bundles ships only if you bump its `?v=` in every HTML file that references it. See the contract at the top of `_headers`.
- **The customer site and the admin panel have different design systems** on purpose (`assets/theme.css` vs `admin/assets/theme.css`). Don't unify them.
- **Deploys and native builds are run by the founder**, not by Claude: `wrangler deploy`, D1 migrations against production, and EAS builds.
