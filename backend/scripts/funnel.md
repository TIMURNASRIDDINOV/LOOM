# LOOM-160 local QA

Requires the LOOM-159 / LOOM-158 checkout implementation and its additive
`0023_atomic_checkout.sql` migration. This change adds no migration.

Run `node backend/scripts/funnel-test.mjs` from the repository root. It bundles
the real Worker, applies the migrations to an ephemeral local D1 database, seeds
`qa-admin@loom.test` / `qa-user@loom.test`, and exercises both the tracker and COD
checkout routes. It compares the analytics output with independent read-only D1
SELECTs and fixture expectations. No remote resources or credentials are used.

For browser QA, `node backend/scripts/funnel-test.mjs --serve` keeps the fixture
Worker on localhost:8790. Serve the repository on localhost and point local API
requests at that Worker. The fixture admin has id 1; the test script documents
its local-only JWT signing key. The default dashboard API address is port 8787.
The fixture includes events on 2026-10-05 / 2026-10-06 and live checkout events
on the current day. Select those two historical days to inspect known totals:

| Platform | Opens | Cart | Checkout | Placed sessions | Orders |
| --- | ---: | ---: | ---: | ---: | ---: |
| Web | 6 | 5 | 5 | 1 | 2 |
| App | 3 | 2 | 2 | 2 | 2 |

## Counting contract

- GET `/api/admin/analytics/funnel` uses `requireAdmin` and `analytics.view`.
  Anonymous/customer sessions receive 401; an admin denied analytics receives 403.
- `from` / `to` accept inclusive `YYYY-MM-DD` dates in UTC, up to 366 days.
  The default is today plus the preceding 29 calendar days. SQL uses the
  half-open interval `[from midnight, midnight after to)`.
- A session/platform is assigned to its first `cfg_open` day within the range.
  Later cart, checkout-submit and placement events must fall within the same
  range and follow the preceding step. Repeated events do not add sessions.
  This also keeps daily counts additive to the period totals.
- App events have `device_type = 'app'` or an `app_` session prefix; other
  events are web. Dates, platform totals and daily rows all use the same query.
- Placement requires the server's `order_placed` event and a matching order
  with the same session and creation timestamp (the atomic writer stores both).
  `cfg_order` is only a click. KR3 excludes cancelled orders and known test #54,
  following the existing PM measurement rule. No other test marker exists.
- The four funnel counts are sessions. Rates use the preceding step, with an
  em dash for a zero denominator. The separate orders column counts eligible
  orders from those sessions; one session can place more than one order.

Check date/platform filters, zero days, empty ranges, failed request/retry,
light/dark themes, horizontal table scrolling at 390px, and uz/ru/en copy.
The existing admin document chooses Russian; the new copy follows its `lang`.

Only after the founder deploys the prerequisites and this change, anonymous
GETs on staging and production should return 401. Compare the deployed
`/admin/assets/dashboard.js?v=31` SHA256 with the repository file. Authenticated
checks stay on localhost; this PR does not deploy or migrate remote resources.
