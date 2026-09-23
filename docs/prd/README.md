# How LOOM plans and tracks work

Everything lives in GitHub: requirements in this folder, work in issues, flow on the project board.

| Jira habit | Here |
|---|---|
| Epic | A **PRD**: a doc in `docs/prd/` plus a tracking issue labelled `prd` |
| Story / task | An issue labelled `task`, attached as a **sub-issue** of the PRD issue |
| Board | The LOOM project board — Backlog → Ready → In progress → In review → Done |
| Sprint / release | Milestones `M1 · COD live`, `M2 · Payme + payouts`, `M3 · Growth surface` |
| Component | `area:backend` `area:web` `area:mobile` `area:admin` `area:infra` |
| Priority | `priority:P0` blocks launch · `P1` needed this milestone · `P2` nice to have |
| MR link | A PR whose description starts `Closes #123` |

## Lifecycle

1. **Write the PRD.** Copy [TEMPLATE.md](TEMPLATE.md) to `PRD-NNN-short-slug.md` (next free number) and open a PR. The doc is the source of truth for *what* and *why*; changing scope means changing the doc in a PR, so history shows when and why it moved.
2. **Open the tracking issue** with the PRD form. Set the milestone.
3. **Break it into tasks** with "Create sub-issue" on the tracking issue. Each task cites the requirement it serves (`PRD-001 · R2`) and has acceptance criteria someone else could check.
4. **Work a task:** move it to *In progress*, branch `task/<issue>-<slug>`, open a PR with `Closes #<issue>`. Merging closes the task and the board moves it to *Done*. The PRD issue's progress bar fills as its sub-issues close.
5. **Close the PRD** when every sub-issue is closed and the success metric has been checked. Set the doc's status to *Shipped*.

**Ready** means the task has acceptance criteria, a size, and nothing blocking it. **Done** means merged, deployed, and verified in production — not just merged.

## Security work stays private

This repository is public. Vulnerabilities are tracked as **draft security advisories** (repository → Security → Advisories), which only maintainers can see. A public task may say "security context is tracked in a private advisory"; it never describes how to exploit anything. Publish an advisory only after the fix is deployed, if at all.

## PRDs

| PRD | Title | Milestone | Status |
|---|---|---|---|
