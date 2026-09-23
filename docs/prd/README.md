# How LOOM plans and tracks work

The backlog lives in **Jira Cloud — loomdesign.atlassian.net, project KAN**. Code, pull requests and security advisories stay on GitHub.

| Concept | Where |
|---|---|
| PRD | A Jira **Epic** titled `PRD-NNN — <title>`; the description is the PRD, written from [TEMPLATE.md](TEMPLATE.md) |
| Task | A Jira **Task** whose parent is the epic |
| Board | KAN board — Idea → To Do → In Progress → In Review → Done |
| Milestone | Label `M1-COD-live` · `M2-Payme-payouts` · `M3-Growth-surface`, plus the milestone date as due date |
| Area | Label `area-web` · `area-mobile` · `area-backend` · `area-admin` · `area-infra` |
| Size | Label `size-S` · `size-M` · `size-L` · `size-XL` |
| Priority | P0 → Highest · P1 → High · P2 → Medium |
| Dependency | "Blocks" issue link |
| Code | Branch `KAN-123-slug`, PR title contains `KAN-123` |

Numbering: PRD-001–099 are platform and engineering PRDs, PRD-101 and up are UX and product PRDs, so parallel authors never collide.

## Lifecycle

1. **Write the PRD** from [TEMPLATE.md](TEMPLATE.md) and create the epic with it as the description.
2. **Break it into tasks** under the epic. Each cites the requirement it serves (`PRD-001 · R2`) and has acceptance criteria someone else could check.
3. **Work a task:** move it to *In Progress*, branch `KAN-<n>-<slug>`, open a PR with the key in its title. Move it to *In Review* when the PR is up.
4. **Done** means merged, deployed and verified in production — not just merged.
5. **Close the epic** when every child is done and its success metric has been checked.

**To Do** (ready) means the task has acceptance criteria, a size label, and nothing blocking it; everything else waits in **Idea**.

## Security work stays private

This repository is public and Jira is shared. Vulnerabilities are tracked as **draft security advisories** on GitHub (repository → Security → Advisories), which only maintainers can see; outside reporters use private vulnerability reporting. A task may say "security context is tracked in a private advisory"; it never describes how to exploit anything.
