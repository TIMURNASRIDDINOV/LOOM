# LOOM — notes for Claude

## Work comes from GitHub issues

Planning lives in GitHub, not in chat. Read `docs/prd/README.md` once; the short version:

- **Before starting a task,** read its issue (`gh issue view <n>`), its parent PRD issue, and the PRD doc in `docs/prd/` it links. The acceptance criteria in the issue are the definition of done — if they are ambiguous, say so instead of guessing.
- **Branch** `task/<issue>-<slug>` off `main`. **PR description** starts with `Closes #<issue>` and names the PRD requirement (`PRD-001 · R2`). One task per PR.
- **If the scope turns out different** from the PRD, update the PRD doc in the same PR and add a changelog line — do not let the issue and the doc disagree.
- **New work you notice** goes in as a new sub-issue of the relevant PRD (`gh api repos/{owner}/{repo}/issues/<prd>/sub_issues -F sub_issue_id=<id>`), not into the current PR.
- **Never put vulnerability details in an issue, PR, commit message or PRD** — this repo is public. Security findings go to a draft advisory (`gh api repos/{owner}/{repo}/security-advisories`) and the public text says only "security context is tracked in a private advisory".

## Traps in this repo

- **The repo root is the Cloudflare Pages deploy root.** No build step: every file here is served on loomdesign.uz. Don't commit secrets, tokens, test credentials or throwaway reports at the root.
- **Static assets are cached immutably for a year.** Editing anything under `assets/`, `admin/assets/` or the root `.js`/`.css` bundles ships only if you bump its `?v=` in every HTML file that references it. See the contract at the top of `_headers`.
- **The customer site and the admin panel have different design systems** on purpose (`assets/theme.css` vs `admin/assets/theme.css`). Don't unify them.
- **Deploys and native builds are run by the founder**, not by Claude: `wrangler deploy`, D1 migrations against production, and EAS builds.
