# PRD-002 — Operability, deploy safety and the funnel readout

| | |
|---|---|
| **Status** | Draft — awaiting founder review |
| **Owner** | @TIMURNASRIDDINOV |
| **Tracking issue** | [#14](https://github.com/TIMURNASRIDDINOV/LOOM/issues/14) — tasks live there as sub-issues |
| **Milestone** | M1 · COD live |
| **Last updated** | 2026-09-23 |

## 1. Problem

LOOM is about to take its first real cash-on-delivery orders. Today the founder cannot tell whether a deploy is safe, whether production is failing, or whether the configurator converts. Each gap shows in the code.

**Deploys are unverified.**
- `backend/package.json:7` is a bare `wrangler deploy`. None of the scripts in `backend/package.json:5-23` runs `tsc`, even though `backend/tsconfig.json:7-10` turns on `strict`, `noUnusedLocals` and `noUnusedParameters`. Wrangler bundles with esbuild, which strips types without checking them. `mobile/package.json:42-47` has no typecheck script either. Both projects pass `tsc --noEmit` on 2026-09-23, but nothing keeps them passing.
- A single Worker serves both `api.loomdesign.uz` and `admin.loomdesign.uz` (`backend/wrangler.toml:7-10`) against the production D1 (`backend/wrangler.toml:18-21`). There is no environment block, no post-deploy check and no documented rollback (`dev.md:266-272`).
- The static site has 269 hand-maintained `?v=` references to 48 files, all served with a one-year `immutable` cache (`_headers:22-23`, `_headers:34-50`). One has already drifted: `designer.html:47` loads `assets/market.js?v=1`, while `designers.html:46` and `market.html:48` load `?v=4`.

**Failures are invisible.**
- `backend/src/index.ts:97-100` logs an unhandled error with `console.error` and returns a generic 500. `backend/wrangler.toml` has no `[observability]` block, so no logs are kept to read afterwards.
- `safeQuery` (`backend/src/db/queries.ts:8-15`) logs the D1 message and then rethrows an error that carries only a label (`queries.ts:14`). The real cause never reaches the top-level handler.
- The mobile `ErrorBoundary` reports only in development builds (`mobile/src/components/ErrorBoundary.tsx:22-24`). In a release build, a crash shows the fallback screen and nobody is told.

**The schema cannot be rebuilt reliably.**
- `migrate:prod` (`backend/package.json:11`) passes no `--remote` flag, so wrangler applies it to the local copy. The scripts a few lines below (`backend/package.json:17`, `:19`) do pass it.
- Both migration chains stop at 0006 of 20 (`backend/package.json:10-11`), and `dev.md:229-230` tells contributors to apply the rest by hand. Nothing records which migrations a database has already had.
- On an empty database the chain fails at 0006, because `backend/migrations/0004_profile_visitors.sql:7` and `backend/migrations/0006_roles_avatars.sql:2` both add `users.avatar_key`. With that one line removed, all 20 files apply cleanly and in order to an empty SQLite database (checked 2026-09-23).
- Following the quickstart gives a broken local setup:
  - `backend/.dev.vars.example:7-9` leaves out `ENVIRONMENT` and `TELEGRAM_WEBHOOK_SECRET`.
  - `backend/wrangler.toml:13` hardcodes `ENVIRONMENT = "production"`, which turns off the dev CORS origins (`backend/src/index.ts:44-45`).
  - `DEV_ORIGINS` (`backend/src/index.ts:26-29`) does not include port 8000, the port that `README.md:186` and `dev.md:236` tell you to use.
  - The Telegram webhook silently ignores every update when the secret is not set (`backend/src/routes/telegram-auth.ts:264-267`), so bot login fails with no error.

**The funnel is recorded but never read.**
- `POST /api/files/track` accepts six configurator events from an allow-list (`backend/src/routes/files.ts:67-75`). `trackPageVisit` stores them together with `page` and `referrer` (`backend/src/db/queries.ts:1391-1420`). `getVisitorStats` (`queries.ts:1434-1469`) never reads `event`, `page` or `referrer`, and it is the only query over `page_visits` behind the admin panel (`backend/src/routes/admin.ts:550-553`).
- The device, browser and OS counts use `COUNT(*)` (`queries.ts:1448-1450`), not distinct sessions like the totals just above them (`queries.ts:1443-1447`). Funnel events live in the same table (`backend/migrations/0016_visit_events.sql:11`), so these charts over-count whichever device does the most configurator work.
- The funnel has no final step. The web checkout success path (`assets/checkout.js:367-374`) records nothing, and `orders` has no session column (`backend/migrations/0001_initial.sql:38-53`). An order cannot be linked to the session that produced it.
- Events are inconsistent across clients:
  - `cfg_order` means intent on the web (the first line of `buyNow`, `configurator.js:4670`) but a completed order in the app (`mobile/app/(tabs)/checkout.tsx:137-138`).
  - `cfg_lab_teaser` (`configurator.js:4029`) is not on the allow-list, so it is stored as a plain pageview.
  - The app keeps one session id for its whole install lifetime (`mobile/src/api/track.ts:20-35`), while the web starts a new one per tab (`assets/track.js:4-11`).

**Dead and duplicate code sits next to live code.**
- A legacy order notification still ships to every page: the URL in `assets/config.js:8` and `configurator.js:112-115`, a call at `configurator.js:5833-5837`, and a console test helper at `configurator.js:5944-5971`. It targets a separately deployed Worker (`cloudflare-worker/wrangler.jsonc:3`). The backend already sends the real notification after it writes the order (`backend/src/routes/cart.ts:275-276`), and nothing calls the modal that leads to the legacy call any more (`openOrderModal`, `configurator.js:5233`).
- `backend/src/routes/user-profile.ts` is mounted (`backend/src/index.ts:69`) after `auth.ts` (`index.ts:60`), so `auth.ts:76` shadows its `GET /me` (`user-profile.ts:15`). Its `PATCH /me` and `POST /me/avatar` (`user-profile.ts:38`, `:85`) duplicate `auth.ts:146` and `:209`, but use a different bucket and key scheme (`user-profile.ts:116-117` against `auth.ts:226-228`). No client calls them.

**What this costs:** a customer will be the first to notice a failed checkout, a bad deploy or a broken migration. The founder also cannot answer the first question an investor asks: of the people who open the configurator, how many place an order? The data to answer it is already being collected.

## 2. Goal and success metric

The founder can deploy knowing type errors and stale assets were caught first, hears about production failures from LOOM rather than from a customer, and reads the configurator funnel in admin without writing SQL.

- **Metric:**
  - (a) Detection: how quickly an unhandled production error reaches the founder, and what share of errors do.
  - (b) Readout: how closely the funnel's `order_placed` sessions match the sessions that actually produced an order in the same window.
- **Target:**
  - (a) Every distinct error signature in Workers Logs produces a Telegram alert within 5 minutes, the admin alert drill arrives within 1 minute, and no M1 incident is first reported by a customer.
  - (b) Over the first 30 days after T7 ships, `order_placed` sessions in the funnel are within 5% of the distinct `session_id` values in `orders` (any status) for the same window. The funnel is readable for any 7-, 30- or 90-day window without SQL.
- **How it is measured:**
  - (a) Run the admin-only alert drill from T3 after each Worker deploy. Each week, compare the error list in Workers Logs (Cloudflare dashboard → Workers → loom-backend → Logs, filtered to exceptions) with the alerts in the Telegram chat.
  - (b) The admin funnel panel shows the "Orders (server)" step and the `order_placed` count side by side. Spot-check with `SELECT COUNT(DISTINCT session_id) FROM orders WHERE session_id IS NOT NULL AND created_at >= ?`.

## 3. Users and scenarios

- **Founder / operator (@TIMURNASRIDDINOV)** deploys by hand, runs migrations, answers every alert, and reads the numbers.
- **Customers** benefit indirectly: fewer broken deploys, and failures fixed the same day.
- **A new contributor or technical reviewer** clones the repo and expects the documented setup to work, with a schema that can be rebuilt from scratch.

Scenarios:
1. **A type error never ships.** The founder runs `npm run deploy` in `backend/` with a type error in a route. `tsc` prints the error, the command stops, and nothing reaches `api.loomdesign.uz`.
2. **A failure reaches the founder, not a customer.** At 21:00 a checkout request throws on a D1 error. Within minutes the founder's Telegram shows the method, path, the error with its D1 cause, and the ray id. He opens Workers Logs by ray id, fixes it, and runs `wrangler rollback` if needed.
3. **The Monday readout.** The founder opens Admin → Visitors, picks "7 days", and sees sessions at each step (open configurator → add design → style → 3D preview → cart → checkout → order), split by web and app, with the top referrers (instagram.com, t.me, direct) and the top entry pages. He uses it to decide where ad money goes.
4. **Local setup works first time.** A contributor runs `cp .dev.vars.example .dev.vars`, `npm run migrate:local` and `npm run dev`, serves the site on port 8000, signs in and loads the cart with no CORS error.

## 4. Scope

**In:**
- A typecheck gate on `npm run deploy` (backend), a `typecheck` script in `mobile/`, a post-deploy health check, and the rollback steps written into `dev.md`.
- A static-asset version check run from `predeploy`, plus the fix for `designer.html:47`.
- Error visibility:
  - Workers Logs turned on.
  - Unhandled Worker errors forwarded to the founder's Telegram, throttled, with an admin-only drill route.
  - `safeQuery` keeping the original error as `cause`.
  - Mobile release builds reporting crashes.
- Reproducible migrations: `--remote` on `migrate:prod`, the duplicate `avatar_key` resolved, a move to `wrangler d1 migrations apply` with `d1_migrations` backfilled for 0001–0020, and a corrected quickstart and `.dev.vars.example`.
- A funnel readout built from data already collected: `getFunnelStats`, referrer and page breakdowns, device, OS and browser counts by distinct session, and an admin dashboard panel.
- A complete funnel: an `order_placed` event on web and mobile, a nullable `orders.session_id`, `cfg_lab_teaser` on the allow-list, one meaning for `cfg_order`, and one app session per launch.
- Removal of the legacy order notification (client code, config key, the Worker itself) and of `backend/src/routes/user-profile.ts`.
- A staging environment with its own D1 (T9, milestone **M2**, so it is ready before payment webhooks are tested).

**Out (and why):**
- **Unit and integration tests** for pricing, checkout and webhooks. They belong with the money-path work in PRD-001. The predeploy gate comes first because it attaches to the command the founder already runs.
- **A GitHub Actions workflow.** The `.github/` ignore rule is already fixed in the PR that creates this tracker. Whether to add CI is an open question in §8, not a task here.
- **A third-party error service** (Sentry, a Tail Worker). At current volume, Workers Logs plus Telegram is enough. Revisit if alert volume grows.
- **Global error reporting on the storefront** (`window.onerror`). It can reuse the T4 endpoint later. It would touch every page's `?v=`, so it waits until T2's check exists.
- **Server-side pricing and the single atomic order writer.** These are PRD-001 (server-authoritative money).
- **Deleting the rest of the unreachable direct-order modal and deciding the future of `POST /api/orders`.** PRD-001 changes that endpoint, so the decision waits until PRD-001 T3 lands and gets its own follow-up sub-issue. T8 removes only the legacy notification inside that code.
- **Ad pixels** (Meta, Yandex Metrica), **UTM capture, SEO and language URLs.** These belong to the M3 growth surface.
- **Retention policy and write controls for `page_visits`.** They are tracked separately.
- **Translating the admin panel.** It is Russian-only by convention. New admin labels follow that convention.

## 5. Requirements

**R1 — A Worker deploy cannot ship a type error or an inconsistent static-asset reference.**
- Given a type error anywhere in `backend/src`, when the founder runs `npm run deploy` in `backend/`, then `tsc` prints the error, the command exits non-zero, and `wrangler deploy` never starts.
- Given two HTML files that reference the same local asset with different `?v=` values, or that reference a local file that does not exist, when `npm run deploy` runs, then the check prints each offending `file:line` and the deploy stops.
- Given the current `mobile/` tree, when `npm run typecheck` runs there, then it exits 0.
- Given a deploy that has finished, when the post-deploy check runs, then it confirms that `GET https://api.loomdesign.uz/` returns `"status":"ok"`. If it does not, the check prints the rollback command and exits non-zero.

**R2 — Every unhandled production failure reaches the founder within five minutes, and the message contains no customer data.**
- Given an unhandled exception in any Worker route, when it happens, then:
  - the client gets the same generic 500 as today;
  - Workers Logs keeps the error, including the D1 cause for database errors;
  - the founder's Telegram receives one alert within 5 minutes with the method, the path without its query string, the error message, the top stack frames and the `cf-ray` id;
  - the alert contains no request body, headers, tokens, phone numbers or addresses.
- Given the same error signature repeats many times within 10 minutes, when alerts are sent, then Telegram receives one alert for that window, not one per request.
- Given Telegram is slow or unreachable, when an error is reported, then the response to the customer is unaffected, because delivery runs through `executionCtx.waitUntil`.
- Given a render crash in a release build of the mobile app, when the `ErrorBoundary` catches it, then the customer sees the existing recovery screen and the founder receives one alert tagged `mobile` with the platform and the app version.

**R3 — The production schema can be rebuilt from an empty database, and the set of applied migrations is known.**
- Given an empty local D1, when `npm run migrate:local` runs, then every file in `backend/migrations/` applies in order. A second run reports nothing to apply.
- Given production after the one-time backfill, when `npm run migrate:prod` runs, then it targets the remote database and applies only migrations missing from `d1_migrations`.
- Given a fresh clone, when a contributor follows the README quickstart, then the site served on `http://localhost:8000` can sign in and load the cart with no CORS error, and a local webhook update that carries the example secret is processed instead of silently ignored.

**R4 — The founder can read the configurator funnel, traffic sources and top pages in admin without SQL.**
- Given events in `page_visits`, when the founder opens the admin dashboard's funnel panel and picks 7, 30 or 90 days, then each funnel step shows its distinct sessions and the percentage kept from the previous step, split into web and app.
- Given the same window, when the panel loads, then a referrer table lists the top sources by host, with `(direct)` for an empty referrer and LOOM's own domains excluded, and a pages table lists the top 20 entry paths without query strings.
- Given the same window, when the device, browser and OS breakdowns render, then they count distinct sessions, not rows.
- Given a failed analytics request, when the panel loads, then it shows the dashboard's existing error state instead of staying on the loading placeholder.

**R5 — The funnel has a completion step, and each event means one thing on every client.**
- Given a customer completes checkout on the web or in the app, when the server confirms the order, then an `order_placed` event is recorded for that session and the new `orders` row stores the same `session_id`.
- Given a customer reaches checkout with a non-empty cart, on either client, when the checkout screen shows, then `cfg_order` is recorded. It no longer fires on the web's buy-now tap or after the app's order succeeds.
- Given a tap on the LOOM Lab teaser, when it is tracked, then it is stored as `cfg_lab_teaser`, not as a pageview.
- Given the app is relaunched, when it tracks its next event, then it uses a new session id.
- Given the funnel panel, when it shows the final step, then "Orders (server)" counts distinct `session_id` values in `orders` (any status), and `order_placed` events appear next to it as a client-side cross-check.

**R6 — Each behaviour has exactly one implementation.**
- Given an order is placed, when notifications go out, then exactly one Telegram order message is sent, by the backend, after the order row is written. No page ships a legacy notification URL in its config, and the legacy Worker is no longer deployed.
- Given the auth routes, when `/api/auth/me`, `/api/auth/profile` or `/api/auth/avatar` is called, then only `backend/src/routes/auth.ts` serves it and `backend/src/routes/user-profile.ts` no longer exists.

**R7 — (M2) A staging Worker with its own data lets schema and webhook changes be tested before production.**
- Given `npm run deploy:staging`, when it completes, then a separate Worker on a `workers.dev` hostname is running with its own D1, KV and R2 bindings, and it cannot claim `api.loomdesign.uz` or `admin.loomdesign.uz`.
- Given `npm run migrate:staging`, when it runs against the empty staging D1, then it builds the full schema through `wrangler d1 migrations apply`.

### Standard requirements (delete a line only with a reason)

- [ ] Every new user-facing string exists in **uz, ru and en** (`assets/i18n.js`, `mobile/src/i18n/strings.ts`, and a stable error `code` for server messages).
- [ ] Web and mobile behave the same, or the gap is listed under Out.
- [ ] Works in light and dark theme on the customer site.
- [ ] Money is computed on the server; the client only displays it.
- [ ] Failures are visible to the founder (log, alert or admin state) — never silent.
- [ ] Changed static assets have their `?v=` bumped (see the cache contract in `_headers`).

## 6. Technical approach

**Deploy gate (R1).**
- Add `typecheck` (`tsc --noEmit`), `predeploy` (`npm run typecheck && npm run check:assets`) and `postdeploy` (a health check against `GET /`, served at `backend/src/index.ts:89-91`) to `backend/package.json`. npm runs `pre`/`post` hooks automatically, so the command the founder types stays the same.
- Add a new `backend/scripts/check-assets.mjs` with no dependencies. It scans `*.html` and `admin/*.html` for local `src`/`href` values that carry `?v=N`, and fails on version drift or on a missing file.
- Add `typecheck` to `mobile/package.json`.

**Error visibility (R2).**
- Add `[observability] enabled = true` to `backend/wrangler.toml`.
- Add a new `backend/src/lib/alert.ts` with `reportError(env, ctx, info)`. It builds a fingerprint (source, name, message, first stack frame) and throttles it through the existing `RATE_LIMIT` KV binding (`backend/src/types.ts:27`), writing KV only when it actually sends. It then calls the existing `sendTelegramMessage` (`backend/src/lib/telegram.ts:91`, which never throws) inside `ctx.waitUntil`, the same pattern the order notification already uses (`backend/src/routes/cart.ts:275-276`). It sends to an optional `ALERT_CHAT_ID` and falls back to `TELEGRAM_CHAT_ID`.
- `app.onError` (`backend/src/index.ts:97-100`) calls it.
- `safeQuery` (`backend/src/db/queries.ts:8-15`) passes `{ cause: err }`.
- Mobile: add a new `mobile/src/api/telemetry.ts`, called from `ErrorBoundary.componentDidCatch` when `!__DEV__`. It posts to a new bounded, rate-limited `POST /api/files/client-error`, placed next to `/track` in `backend/src/routes/files.ts`. That route reuses `isRateLimited`, moved from `backend/src/routes/public.ts:13` to `backend/src/lib/rate-limit.ts`.

**Migrations (R3).**
- Make 0006's `ALTER` a comment.
- Point `migrate:local` and `migrate:prod` at `wrangler d1 migrations apply loom-db --local|--remote`. Wrangler 3.114 is installed and keeps a `d1_migrations` table.
- Add a one-time `backend/scripts/backfill-d1-migrations.sql` that marks 0001–0020 as applied in production. It lives outside `migrations/`, so it is never applied as a migration.
- Add `ENVIRONMENT=development` and `TELEGRAM_WEBHOOK_SECRET` to `.dev.vars.example`, and add `http://localhost:8000` to `DEV_ORIGINS`.

**Funnel readout (R4).**
- Add `getFunnelStats(db, { from, to })` in `backend/src/db/queries.ts`, beside `getVisitorStats`, and wrap it in `safeQuery`. It runs one grouped query over `event` (using `idx_visits_event`, `0016_visit_events.sql:14`), split by `device_type = 'app'`. It also computes the first-touch referrer per session, normalised to a host in TypeScript, and the top entry paths with the query string removed.
- Expose it at `GET /api/admin/analytics/funnel?days=7|30|90` behind `requireAdmin` and `requireCap('analytics.view')`, next to `admin.ts:550`.
- Switch `getVisitorStats` breakdowns (`queries.ts:1448-1450`) to `COUNT(DISTINCT session_id)` over the same window.
- Render the panel in `admin/dashboard.html` and `admin/assets/dashboard.js`, extending `renderVisitors` (`dashboard.js:165-178`) and `load` (`dashboard.js:208-229`).

**Funnel completeness (R5).**
- Add a new migration (the next free number, 0021 today): `ALTER TABLE orders ADD COLUMN session_id TEXT` plus an index.
- `createOrder` (`backend/src/db/queries.ts:264`) gets an optional `session_id`. `POST /api/cart/checkout` (`backend/src/routes/cart.ts:162`) accepts an optional `sessionId` string of at most 64 characters.
- Add `order_placed` and `cfg_lab_teaser` to `EVENTS` (`files.ts:67-74`).
- Web:
  - `assets/track.js` exposes `LOOM_TRACK.sessionId()`.
  - `assets/checkout.js` sends it with the order, fires `cfg_order` when the checkout grid shows (`checkout.js:424`), and fires `order_placed` on success (`checkout.js:367-374`).
  - `configurator.js:4670` stops firing `cfg_order`.
- Mobile:
  - `mobile/src/api/track.ts` keeps the session id in memory for each launch and exports it.
  - `checkout.tsx` fires `cfg_order` when the screen gains focus with items in the cart, and `order_placed` after the POST succeeds.

**Dead code (R6).**
- Delete `WORKER_URL`, the legacy notification block and `window.testTelegramConnection` from `configurator.js`, and `TELEGRAM_WORKER_URL` from `assets/config.js`.
- Delete `cloudflare-worker/` and un-deploy that Worker.
- Delete `backend/src/routes/user-profile.ts` and its import and mount (`index.ts:15`, `:69`).

**Staging (R7, M2).**
- Add an `[env.staging]` block that redeclares every binding: `vars`, D1, KV, R2, `ai` and `images` are not inherited by environments. Set `routes = []` explicitly.
- Add `deploy:staging` and `migrate:staging` scripts, with secrets set via `wrangler secret put --env staging`.

No existing API contract changes shape. The additions are one optional request field (`sessionId`), two allow-listed event names, one admin endpoint, one telemetry endpoint and one admin-only drill route.

## 7. Rollout and verification

1. **T1, T2: scripts only, no production change.** Verify by adding a deliberate type error and a deliberate `?v=` mismatch locally (neither committed). Each must stop `npm run deploy` before wrangler starts.
2. **T3: Worker deploy.** Verify:
   - Workers Logs shows live requests.
   - The admin drill route produces one Telegram alert within 1 minute, and a second drill within 10 minutes produces none.
   - `postdeploy` reports `status: ok`.

   Roll back with `npx wrangler rollback` in `backend/`.
3. **T4: Worker deploy, then an app build (founder, EAS).** Verify before the build with `npx expo start --no-dev --minify` and a temporary throw (not committed).
4. **T5: production migration bookkeeping (founder).**
   - Run the backfill SQL once with `--remote`, then `npm run migrate:prod`. The expected result is "no migrations to apply".
   - `SELECT COUNT(*) FROM d1_migrations` must return 20.

   Undo with `DELETE FROM d1_migrations`. The schema itself does not change.
5. **T6: Worker deploy, then Pages** (push of `admin/` assets with bumped `?v=`). Verify the panel against a manual `wrangler d1 execute --remote` count for the same window.
6. **T7:**
   - Run migration 0021 with `npm run migrate:prod`.
   - Deploy the Worker, which writes the new column.
   - Push Pages (`checkout.js`, `track.js`, `configurator.js` with bumped `?v=`), then ship an app build.
   - Verify with one test COD order on web: its `orders.session_id` matches an `order_placed` row in `page_visits`.

   The column is nullable and additive, so rollback means reverting the Worker and Pages commits. No down-migration is needed.
7. **T8:**
   - Push Pages first, so clients stop calling the legacy Worker.
   - Un-deploy the legacy Worker (`npx wrangler delete` in `cloudflare-worker/`, founder).
   - Deploy the Worker without `user-profile.ts`.

   Verify that one test order sends exactly one Telegram message, and that avatar upload still works on the web account page and in the app.
8. **T9 (M2):** create the staging D1, KV and R2, run `npm run migrate:staging`, then `npm run deploy:staging`, and check that the staging health route returns `ok`.

## 8. Risks and open questions

- **Q:** Did 0006's `UPDATE users SET role = 'user' WHERE role = 'customer'` ever run in production? Check `SELECT role, COUNT(*) FROM users GROUP BY role` before the backfill marks 0006 as applied. If `customer` rows exist, the cleanup needs its own new migration. The founder decides before T5 starts.
- **Risk:** The backfill assumes production already has every object from 0001–0020. Migrations were applied by hand, so T5 compares the production schema with a freshly migrated local database before marking anything as applied; a migration whose objects are missing in production is resolved first, not marked.
- **Q:** Should alerts go to the existing order chat or a separate chat? The proposal is an optional `ALERT_CHAT_ID` secret that falls back to `TELEGRAM_CHAT_ID`. The founder decides before T3 merges.
- **Q:** The gates in T1 and T2 cover only the Worker deploy. Cloudflare Pages deploys every push to `main` without them. Should a GitHub Actions workflow run the same two commands on pull requests? The founder decides by the M1 due date (2026-10-23).
- **Risk:** Until T7 ships, historical `cfg_order` rows mean intent on the web and a completed order in the app. The panel splits web and app, so each series stays readable, but pre-T7 data should not be compared across the two channels.
- **Risk:** "Visitors" are sessions, not people: one per browser tab on the web, and one per launch in the app after T7. The panel labels them as sessions.
- **Risk:** An error loop could flood Telegram or exhaust the KV free-tier write quota. The fingerprint throttle sends at most one alert per signature per 10 minutes and writes KV only when it sends.
- **Risk:** The first `tsc` run on `main` could surface errors that are not visible on this branch. If so, T1 fixes them before wiring the gate.
- **Risk:** Other PRDs may add migrations at the same time. T7 takes the next free number at merge time, and T5 must land first so that every new migration goes through `migrations apply`.
- **Risk:** PRD-001 T3 rewrites `POST /api/cart/checkout` and `createOrder` into one atomic order writer. T7's change there is one optional `session_id` field. Whichever lands second rebases, and the new writer must keep passing `session_id` through.

## 9. Tasks

Tracked as sub-issues of the tracking issue — that list is the source of truth. Summary for reading offline:

| # | Task | Req | Size |
|---|---|---|---|
| [#15](https://github.com/TIMURNASRIDDINOV/LOOM/issues/15) T1 | Gate backend deploys on a typecheck and a post-deploy health check | R1 | S |
| [#16](https://github.com/TIMURNASRIDDINOV/LOOM/issues/16) T2 | Fail the deploy on static-asset `?v=` drift or missing files | R1 | S |
| [#17](https://github.com/TIMURNASRIDDINOV/LOOM/issues/17) T3 | Send unhandled Worker errors to Telegram and keep Workers Logs | R2 | M |
| [#18](https://github.com/TIMURNASRIDDINOV/LOOM/issues/18) T4 | Report mobile release-build crashes to the founder | R2 | S |
| [#19](https://github.com/TIMURNASRIDDINOV/LOOM/issues/19) T5 | Make D1 migrations reproducible and fix the local quickstart | R3 | M |
| [#20](https://github.com/TIMURNASRIDDINOV/LOOM/issues/20) T6 | Show the configurator funnel, referrers and pages in admin | R4 | M |
| [#21](https://github.com/TIMURNASRIDDINOV/LOOM/issues/21) T7 | Add the order_placed step and link orders to sessions | R5 | M |
| [#22](https://github.com/TIMURNASRIDDINOV/LOOM/issues/22) T8 | Remove the legacy order notifier and the duplicate profile routes | R6 | S |
| [#23](https://github.com/TIMURNASRIDDINOV/LOOM/issues/23) T9 | Add a staging Worker with its own D1, KV and R2 (M2) | R7 | M |

## Changelog

- 2026-09-23 — Drafted from the September audit.
- 2026-09-24 — Status set to Draft pending founder review; tracking issue and tasks created.
