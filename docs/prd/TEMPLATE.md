# PRD-NNN — Title in plain words

| | |
|---|---|
| **Status** | Draft · Approved · In progress · Shipped · Dropped |
| **Owner** | @TIMURNASRIDDINOV |
| **Tracking issue** | #NN — tasks live there as sub-issues |
| **Milestone** | M1 · COD live |
| **Last updated** | YYYY-MM-DD |

## 1. Problem

What is wrong or missing today, for whom, and what it costs. Cite evidence — `path/to/file.ts:123`, a number from the admin dashboard, a customer message. No evidence, no PRD.

## 2. Goal and success metric

One sentence on the outcome. Then the measurable signal that proves it shipped and worked:

- **Metric:** …
- **Target:** …
- **How it is measured:** the query, dashboard panel or manual check.

## 3. Users and scenarios

Who touches this (customer, designer, operator/admin, print partner) and the two or three concrete scenarios it must support.

## 4. Scope

**In:**
- …

**Out (and why):**
- …

## 5. Requirements

Numbered so tasks and PRs can cite them. Each has acceptance criteria a reviewer can check without asking.

**R1 — …**
- Given … when … then …

**R2 — …**

### Standard requirements (delete a line only with a reason)

- [ ] Every new user-facing string exists in **uz, ru and en** (`assets/i18n.js`, `mobile/src/i18n/strings.ts`, and a stable error `code` for server messages).
- [ ] Web and mobile behave the same, or the gap is listed under Out.
- [ ] Works in light and dark theme on the customer site.
- [ ] Money is computed on the server; the client only displays it.
- [ ] Failures are visible to the founder (log, alert or admin state) — never silent.
- [ ] Changed static assets have their `?v=` bumped (see the cache contract in `_headers`).

## 6. Technical approach

Files to touch, data model and migration changes, API contract changes, and anything reused instead of rebuilt. Name the existing function you are extending.

## 7. Rollout and verification

Order of deploys (migration → Worker → Pages → app), how each step is verified in production, and how to roll back (`wrangler rollback`, revert commit).

## 8. Risks and open questions

- **Q:** … — who decides, by when.

## 9. Tasks

Tracked as sub-issues of the tracking issue — that list is the source of truth. Summary for reading offline:

| # | Task | Req | Size |
|---|---|---|---|

## Changelog

- YYYY-MM-DD — Draft.
