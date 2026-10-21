# Lab screen verification (LOOM-250)

Use a local API with a local test account for sign-in. The fixture replaces only
Lab calls; it never authenticates a user or calls an AI model.

```sh
cd mobile
EXPO_PUBLIC_API_BASE=http://localhost:8787 EXPO_PUBLIC_LAB=1 EXPO_PUBLIC_LAB_FIXTURE=success npx expo start --web
```

Open `/lab` at 390×844. `EXPO_PUBLIC_LAB` is the existing shared dev flag override.
Both overrides are ignored in production. With the normal flag off, `/lab` and
`/lab/history` redirect home. Home, Studio and Account entry points belong to
LOOM-248, LOOM-249 and LOOM-251.

Restart Expo with one of these `EXPO_PUBLIC_LAB_FIXTURE` values:

- `success`: three credits, one PNG per run; redraw spends another credit.
- `empty`: fresh empty history (successful runs still accumulate normally).
- `low_quality`: a result carrying the low-resolution badge.
- `lab_limit_reached`: zero credits, with Catalog and Studio actions.
- `prompt_refused`, `lab_global_cap`, `generation_failed`, `cutout_failed`,
  `timeout`, `502`: the corresponding error without spending a credit.
- `report_failed`: the result remains usable after the report fails.
- `offline`: status/history offline state with retry.

The fixture embeds the existing website sample from `images/lab/suzani.png` so
viewing it needs no network. Its synthetic upload keys are for UI verification.
Cancellation only stops waiting: a successful background run still appears in
history and spends one credit, matching `backend/API.md`.

Native results are written to PNG cache files before Studio receives their
`file://` URIs, keeping image bytes out of the persisted draft. Web previews use
object URLs. History loads images only for visible rows and releases browser
image buffers when a row leaves view. Blurring during generation resets the
prompt; Cancel keeps the request guard until that request settles.

```sh
node mobile/scripts/lab-test.cjs
cd mobile && npx tsc --noEmit
CI=1 npx expo export --platform web
```

Check uz, ru and en, including report success/failure, balance updates, empty
and offline history, and putting a result on the front of a garment for zero
markup. Real-device checks on an EAS preview build remain Tim's owner step.
