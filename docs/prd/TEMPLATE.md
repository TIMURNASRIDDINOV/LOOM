<!-- Paste into the description of a Jira epic titled "PRD-NNN — Title" in project LOOM (Feature Management board).
     Labels: prd + the milestone label. Size: soft 9 KB Markdown (over 9216 bytes = warn); hard 30000 B ADF (block; a larger body is split into comments).
     Copied from the prd-standard skill, which stays canonical: change the skill, then re-copy. -->

# PRD template (epic)

Replace each `<hint>`; drop a hint line only where the contract allows. Build tickets use [STORY.md](STORY.md).

```markdown
Status: Draft | Owner: <name> | Milestone: <label> | Last updated: <date> | Supersedes: <KEY + inherited D-n, or none>

## 1. Problem
Who: <actor>. Observable behavior: <what users do or fail to do today>. Evidence: <file#symbol | dated metric | user message>
Why now: <trigger, cost of waiting>. Hypothesis: We believe <change> will result in <measurable outcome>.
## 2. Goal and metric
Outcome: <one sentence>. Business value: <who gains what, in money, time or risk>. Metric: <name>. Baseline: <value, source, read date>.
Target: <value | deferred until <trigger>, decider <name>>. Measured by: <query or check runnable today>
## 3. Users and scenarios
Actors: <list>. Scenarios: 1. <real values> 2. <real values>
## 4. Scope
| Surface | In / Out: <reason> / No change |   (one row per profile surface)
| customer web + Telegram Mini App | <In / Out: reason / No change> |
| configurator 2D/3D | <In / Out: reason / No change> |
| admin | <In / Out: reason / No change> |
| backend Worker + D1 | <In / Out: reason / No change> |
| mobile Expo app | <In / Out: reason / No change> |
| payments (COD / Payme) | <In / Out: reason / No change> |
| print handoff | <In / Out: reason / No change> |
In: <item>. Out: <item> — <reason | owner KEY>. Removed: <date> <item> — <reason>
Scope dimensions (axes each R-n states its scope on): viewport (phone / desktop); product type (custom / blank / ready-made); garment; face (front / back)
## 5. Decisions
D-1 <what> — decider <name>, <date>; rejected: <alternative>
## 6. Requirements
R-1 <one behaviour>. Scope: <scope-dimension values>.
Given <state> When <action> Then <result with values>. IF <failure> THEN <block | retry | degrade>, reported in <sink>.
## 7. Contracts
STD-1: <applies | N/A because <reason> | owned by <KEY>>. Data / API / compatibility: <contract per touched area>
## 8. Rollout
| Step | Who | Verified by | Rollback |   Merged code is inert until step <n>.
## 9. Open items and assumptions
OPEN-1 <question> — proposed: <answer>; owner <name>; due <date>; blocks <Ready for Dev | Done | go-live>; affects R-<n>
A-1 <default> — chosen by <author | assistant>
## 10. Coverage
R-1 → <KEY>. Edge case <case> → <KEY>. Order: <KEY> before <KEY>
## Changelog
<date> — <change>; invalidates <IDs>; affects <KEYs>
```

## Epic contract

Section n of the epic = check ID En. Headings read `## <n>. <Title>`; E0 is the header block above section 1.

| ID | Must contain | Blocks when |
|---|---|---|
| E0 Header | Status (Draft / Approved / In progress / Shipped / Superseded by KEY / Dropped), Owner, Milestone, Last updated; Supersedes KEY + inherited D-n list | E0: no Status; Superseded or Supersedes without the inherited D-n list |
| E1 Problem | Who: the actor; Observable behavior: what users do or fail to do today, with evidence (`file#symbol`, a dated metric or a user message); Why now: the trigger and the cost of waiting; Hypothesis: "We believe <change> will result in <measurable outcome>" | E1: never blocks; warn when no evidence or no Hypothesis |
| E2 Goal + metric | outcome; Business value: who gains what, in money, time or risk; metric; baseline + source + read date; target, or "deferred until <trigger>, decider <name>"; how measured, runnable today | E2: any of these missing, except Business value (warn) |
| E3 Users | actors; 2-3 concrete scenarios with real values | E3: never blocks; warn under 2 scenarios |
| E4 Scope | surfaces matrix: each profile surface In / Out: reason / No change; In list; Out list, each item with a reason or an owner key; Removed-on-date list | E4: a surface unmarked; an Out item without reason or owner |
| E5 Decisions | D-n register | E5: a decision stated in prose ("decided", "we will", "chosen") and not registered |
| E6 Requirements | R-n: one behaviour; G/W/T with concrete values; IF failure THEN branch; scope per profile `scope-dimensions`; quality bars as numbered R-n | E6: no failure branch; a J1 vague word; M5 either/or; two behaviours in one R-n |
| E7 Contracts | each profile STD-n: applies / N/A because / owned by KEY; data contract, API contract and compatibility (existing data, installed builds) for each touched area | E7: an STD-n without status; N/A without reason; a touched area without its contract |
| E8 Rollout | step, who runs it, how verified, rollback; "merged code is inert until step <n>" | E8: missing while any deploy, migration or owner step exists |
| E9 Open + assumptions | OPEN-n and A-n with every ID-scheme field | E9: an OPEN-n blocking Ready for Dev; an OPEN-n missing a field |
| E10 Coverage | R-n, D-n and listed edge cases → child keys; dependencies with order | E10: an R-n that no child covers; a child that cites no R-n. Coverage counted as in M2 (tracker children whose S0 cites the ID; file lint: the E10 table) |
| Changelog | dated lines: what changed, invalidated IDs, affected children; a scope change lands here first | C3: a child adds behaviour with no matching Changelog amendment |

## ID scheme

| ID | Lives in | Rule |
|---|---|---|
| R-n | epic E6 | one behaviour; stable, never renumbered; a cut R-n becomes "Withdrawn <date>: <reason>" and stays in place |
| D-n | epic E5, story S2 | what, decider, date, rejected alternative; replaced = "Superseded by D-m <date>", kept in place |
| OPEN-n | epic E9, story S2 | question, proposed answer, owner, due, blocks (Ready for Dev / Done / go-live), affected R-n |
| A-n | epic E9, story S2 | a default, marked "chosen by author" or "chosen by assistant" |
| STD-n | profile `STD` | standing contract; cited as "applies", "N/A because <reason>" or "owned by <KEY>" |

IDs are scoped to their issue. Cross-issue cite: `KEY:R-3`. A story cites its own epic's R-n bare (the S0 epic key scopes them). Every other cross-issue ID, including epic D-n, uses `KEY:ID`. New items take the next free number.

## Spec text

- Fits the profile `size` budget.
- Self-contained: the builder sees only the ticket; the verifier sees only the ACs.
- No local paths (M6).
- Security is one line: "tracked in a private advisory". No details in the summary, description or comments.
- Description = spec. QA verdicts, agent evidence, Q/A logs and PR links go in comments.
- No volatile state: PR numbers, branch names, current `?v=` cache values, pinned migration numbers.

## Standing contracts (STD-n)

| STD | Areas | Contract |
|---|---|---|
| 1 | strings | i18n: 4 stores (web DICT `assets/i18n.js`, mobile `mobile/src/i18n/strings.ts`, admin RU, bot RU). Per-language data fields (`name_uz`) read by every client. |
| 2 | API | Error codes named. Mapping in every client: `configurator.js`, `assets/checkout.js`, `products-catalog.js`, `mobile/app/(tabs)/checkout.tsx`, `mobile/src/api/client.ts`. |
| 3 | cache | `?v=` bumped in every HTML file and JS-embedded ref (`configurator.js`, `mobile/src/lib/scene-html.ts`), value set at final rebase. Check pages.dev before the versioned URL. Unversioned media (`/images`, app-referenced files) ship under a new filename. |
| 4 | UI | Themes per surface: customer light + dark (`assets/theme.css`); admin own system (`admin/assets/theme.css`); JS-rendered states in every theme. |
| 5 | none (E7 or S0 cite only) | Money computed on the server; clients display only. |
| 6 | none (E7 or S0 cite only) | Failures visible in a named sink (admin state, alert, stored log). console.error alone fails. |
| 7 | data | Migrations additive (no DROP/RENAME). Number = next free at pickup across branches (P4), never pinned in a spec. `backend/src/db/schema.ts` "Added in migration NNNN" note. |
| 8 | none (E7 or S0 cite only) | New bindings in `backend/src/types.ts` and both `backend/wrangler.toml` sections (top level + `[env.staging]`). |
| 9 | admin | Admin capability id in `backend/src/lib/permissions.ts`, role presets, nav cap in `admin/assets/layout.js`. |
| 10 | mobile, API | Mobile parity: the named mobile file changes, or "web only" + gap key. No OTA: installed builds keep old code, so API changes stay compatible. |
| 11 | UI, data (configurator work) | Derived outputs, each unchanged / changed: print PNG, order mockups (3D + flat), saved PNG, cart mockups, Step 3 snapshot, GLB export, admin order detail. |
| 12 | UI, data (configurator work) | 3D asset contract (LOOM-167) passes before any model swap. Configurator fixture = real prod GLB + prod-mirrored config, every product type in scope. |
| 13 | none (E7 or S0 cite only) | Analytics event is in the allowlist in `backend/src/routes/files.ts` (P6). |
| 14 | all | Security: "tracked in a private advisory" only. |
| 15 | data, mobile | Founder-only: deploys, prod D1 migrations, EAS builds (story S6). |
