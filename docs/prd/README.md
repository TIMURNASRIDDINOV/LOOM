# How LOOM plans and tracks work

The backlog lives in **Jira Cloud — loomdesign.atlassian.net, project LOOM**, organised the same way as DOMO's Jira: a Feature Management board for PRDs and a Micro Management board for the work. Code, pull requests and security advisories stay on GitHub.

## The two boards

| Board | Holds | Flow |
|---|---|---|
| **Feature Management** | Epics only — one per PRD, titled `PRD-NNN — <title>`, the PRD in its description ([TEMPLATE.md](TEMPLATE.md)) | PO (PRD) → PM → Ready for Dev → Development → Ready for Test → QA → Done |
| **Micro Management** | Tickets (Task, Story, Bug), each a child of its epic | PM → Ready for Dev → Development → Content → Redevelopment → Ready for Test → QA → Done |

| Status | Meaning |
|---|---|
| **PO (PRD)** | The PRD is being written or reviewed (epics only) |
| **PM** | PM owns it — decomposing, clarifying, or sent back because requirements were unclear or the scope changed. Any ticket can return here |
| **Ready for Dev** | Acceptance criteria are clear; a developer can pick it up |
| **Development** | Being built. **Jira refuses this move until Story Points and Developer Estimated Days are both set** — the developer fills them at pickup |
| **Content** | Translations, copy, media, localization (uz / ru / en) |
| **Redevelopment** | QA found a code problem — entered only from QA |
| **Ready for Test** | Built and deployed for testing |
| **QA** | Being tested. Code issue → Redevelopment · content issue → Content · approved → Done |
| **Done** | Merged, deployed and verified in production |

On epics, Content and Redevelopment don't exist — while any child is in either, the epic stays in Development. Epics are moved by hand.

## Fields and labels

| | |
|---|---|
| Estimates | **Story Points** and **Developer Estimated Days** — set at pickup, required to enter Development |
| Milestone | Label `M1-COD-live` · `M2-Payme-payouts` · `M3-Growth-surface`, plus the milestone date as due date |
| Area | Label `area-web` · `area-mobile` · `area-backend` · `area-admin` · `area-infra` |
| Size | Label `size-S` · `size-M` · `size-L` · `size-XL` (the author's rough size; the estimate fields are the developer's) |
| Priority | P0 → Highest · P1 → High · P2 → Medium |
| Dependency | "Blocks" link; overlap between tickets is a "Relates" link |
| Code | Branch `LOOM-123-slug`, PR title contains `LOOM-123` |

Numbering: PRD-001–099 are platform and engineering PRDs, PRD-101 and up are UX and product PRDs, so parallel authors never collide.

## Working a ticket

1. **Pick it up:** move it from Ready for Dev to Development (setting both estimates) and assign yourself.
2. **Build it** on branch `LOOM-<n>-<slug>`; one ticket per PR.
3. **Hand it over:** add the PR link, the build or version if there is one, and a short implementation summary to the ticket, then move it to **Ready for Test** — or to **Content** if strings, copy or media still need work.
4. **QA decides:** code problem → Redevelopment, content problem → Content, approved → Done.
5. **Close the epic** when every child is Done and its success metric has been checked.

## Security work stays private

This repository is public and Jira is shared. Vulnerabilities are tracked as **draft security advisories** on GitHub (repository → Security → Advisories), which only maintainers can see; outside reporters use private vulnerability reporting. A ticket may say "security context is tracked in a private advisory"; it never describes how to exploit anything.
