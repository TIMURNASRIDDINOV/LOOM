<!-- Paste into the description of a Jira ticket in project LOOM (Micro Management board), created as a child of its epic.
     Labels: one area-* and one size-*; size-S = light variant (sections 0, 3 and 5 only).
     The lane runner picks only Ready for Dev items labelled spec-ready; the prd-standard lint adds that label.
     Copied from the prd-standard skill, which stays canonical: change the skill, then re-copy. -->

# Story spec template

Replace each `<hint>`; drop a hint line only where the contract allows. R-n and D-n come from the epic; STD-n are listed in [TEMPLATE.md](TEMPLATE.md).

```markdown
## 0. Implements
Epic <KEY>. R-1: "<requirement text copied from the epic>". Relies on: <KEY>:D-<n>, STD-<n>.
Touches: <UI, strings, data, API, cache, mobile, admin | none>
Sensitive: <money, auth, PII | none>
## 1. Context
<2-4 lines why>. Anchors: <file#symbol | file:line@sha>
## 2. Scope
In: <item>. Out: <item> — owner <KEY>. Decisions taken: D-<n>. Open: OPEN-<n>. Assumptions: A-<n> <default> — chosen by <author | assistant>
## 3. Acceptance criteria
AC-1 (R-1) <one behaviour>
Given <state> When <action> Then <number, measured region>
Failure: IF <timeout | not ready | cap | upload fail> THEN <block | retry | degrade>, reported in <sink>
  (or) Failure: none possible because <reason>
Examples: | input | expected |   (≥1 negative row: exact real-world input, never a category)
Verify: <agent | author manual | real device>; fixture <fixture>; env <environment>; command <command>; pass when <observable result>
## 4. Touched areas
UI: design <ref | no design needed: reason>; flow <step, panel, focus, recovery>; states <loading, empty, error, toast, modal>; themes <list + sources>
Strings: <key> | <store> | <each language | Content: owner>
Data: <change>. API: <endpoint, error codes, mapping per client>. Cache: <plan>. Mobile: <file | web only + gap KEY>. Admin: <capability>
## 5. Boundaries
Always: <rule> — <reason>. Ask first (comment SPEC GAP:, move to return state): <rule> — <reason>. Never: <rule> — <reason>.
Apply to every occurrence: <search command>
Builder defaults: may fill internal names, file placement, helper reuse, log wording, test structure (record in the PR).
Back to the return state: user-visible behaviour, copy, data shape or defaults, error codes, money, permissions, scope, design.
## 6. Owner steps
1. <step the builder must not run> — <who runs it>
```

## Story contract

Applies to every non-epic issue type. Rule: the AC section alone suffices to build and verify. Section n = check ID Sn.

| ID | Must contain | Blocks when |
|---|---|---|
| S0 Implements | epic key; each R-n with its requirement text copied in; D-n and STD-n relied on; `Touches:` line; `Sensitive:` line | S0: no R-n; a cited R-n has an OPEN-n blocking Ready for Dev. Scope change without the epic amended first: report as C3 |
| S1 Context | 2-4 lines why; anchors `file#symbol` or `file:line@sha` | S1: never blocks; warn on a bare `file:line` |
| S2 Scope | In; Out, each with an owner key; Decisions taken (D-n); OPEN-n | S2: M5 either/or wording; an OPEN-n blocking Ready for Dev; an OPEN-n missing an ID-scheme field |
| S3 Acceptance criteria | each AC-n per the AC rules below | S3: an AC missing the state, the action or the observable result of G/W/T (in substance; quote the missing part); an AC on I/O the story adds or changes with no failure row, no failure AC on its path and no "none possible" reason (an AC that only exercises existing I/O the story does not change, or that removes I/O, needs none of these); an AC with no Verify line, or a Verify line without method, fixture or pass criterion |
| S4 Touched areas | one block per `Touches:` area, per the area rules below | S4: a `Touches:` area whose content is absent from the whole issue (Scope bullets and ACs count): report only the missing sub-field, e.g. "absent: themes in UI (STD-n)"; UI without a design ref or "no design needed: <reason>" (a screen URL or path plus a written delta anywhere in the issue, ACs or Scope included, is the "screen + written delta" kind); Strings: block only a new string missing a required language, never a store the profile `string-stores` infers from the key prefix or surface |
| S5 Boundaries | Always / Ask first (comment `SPEC GAP:`, move to the return state) / Never, each with a reason; "apply to every occurrence: <search command>"; builder-defaults policy | S5: never blocks; warn when a part is missing |
| S6 Owner steps | steps the builder must not run (deploys, prod migrations, native builds), in order, with who runs each | S6: missing while deploy or data work is involved; the light variant used while S6 is required ("light variant not allowed") |

AC rules (S3):
- G/W/T with numbers and the measured region.
- Failure rows: IF timeout / not ready / cap / upload fail THEN block, retry or degrade, plus where it is reported. A console log alone does not count. Required only for I/O the story adds or changes. An AC that only exercises existing I/O the story does not change needs no failure row; removing I/O never needs one. A failure behaviour stated as its own AC (block / retry / degrade + named sink) covers the other ACs on that path.
- No I/O, network, storage or user input in the AC: "Failure: none possible because <reason>" replaces the rows.
- Examples table with ≥1 negative row in the exact real-world input form: the actual URL, host, path or value the system will see (e.g. `http://localhost:8080/health` with the service stopped), never a category such as "host down" (missing examples or a category-only negative row = warn).
- `Verify:` method (agent / author manual / real device), fixture (or "none, because <reason>"), environment, command, pass criterion.

Area rules (S4):
- UI: design ref (one kind from profile `design-refs`; default Claude Design link, existing screen + written delta, or screenshot; screen + written delta = a screen URL or path plus the delta, anywhere in the issue); flow (step, panel, focus, recovery); states (loading, empty, error, toast, modal); themes and theme sources.
- Strings: key, store, each profile language or "Content: <owner>". The store may be left out when profile `string-stores` infers it from the key prefix or surface.
  LOOM `string-stores`: `cfg.*` and other web DICT keys: web DICT (`assets/i18n.js`). Admin text: admin RU.
- Data: the change. API: endpoints, error codes, the mapping in every client. Cache: plan. Mobile: parity. Admin: capability.

`Touches:` UI / strings / data / API / cache / mobile / admin / none, comma-separated.
No `Touches:` line: S4 and J6 use the areas from the AC content (as in lint step 4); S0 warns "absent: `Touches:` line in S0", never blocks.
`Sensitive:` money / auth / PII / none. Not none: the author reviews before Done. The text names no details.

Light variant (story with the profile light label): S0, S3 and S5 only. Facts from S4 (design ref, string keys, error codes) go inside the AC that needs them; lint applies the S4 checks to the AC text. Absent S1, S2, S4 and S6 are not findings. Not allowed when S6 would be required.

Builder-defaults policy (core default; a profile may extend). Copy it into S5:
- The builder may fill these and record them in the PR: internal names, file placement, helper reuse, log wording, test structure.
- These go back to the return state: user-visible behaviour, copy, data shape or defaults, error codes, money, permissions, scope, design.
