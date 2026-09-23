# PRD-001 — Server-authoritative money and COD launch

| | |
|---|---|
| **Status** | Draft — awaiting founder review |
| **Owner** | @TIMURNASRIDDINOV |
| **Tracking issue** | [#5](https://github.com/TIMURNASRIDDINOV/LOOM/issues/5) — tasks live there as sub-issues |
| **Milestone** | M1 · COD live |
| **Last updated** | 2026-09-23 |

## 1. Problem

LOOM already accepts cash-on-delivery orders at loomdesign.uz, but nothing about the money on an order is something the founder can trust, reconcile or show to a partner. Five gaps, each visible in the code:

1. **There is no single pricing authority.** Price is calculated in three places, and they are not guaranteed to agree: the storefront (`configurator.js:1392-1408`), the app (`mobile/src/state/studio.tsx:225-228`), and the Worker's cart total (`backend/src/routes/cart.ts:26-28`), which feeds the order total (`backend/src/routes/cart.ts:184`) and the payment-link amount (`backend/src/routes/cart.ts:291`). The Worker needs one pricing function, derived from `products.price` and the markups of approved artworks, that every order path uses. When no product is loaded, both clients fall back to a hard-coded 150 000 sum with no product attached (`configurator.js:1393`, `mobile/src/state/studio.tsx:75`). The two clients also disagree with each other: the app adds an artwork's markup once per side (`mobile/src/state/studio.tsx:226`), the web once per artwork (`configurator.js:1396-1404`). Security context is tracked in a private advisory (maintainers only).
2. **Two order writers that disagree, neither atomic.** Cart checkout writes the order header, each line, each designer credit and the cart clear as separate sequential statements (`backend/src/routes/cart.ts:216-270`); a failure part-way leaves a partial order and an uncleared cart, and a retry produces a second order. The direct-order writer, `POST /api/orders` (`backend/src/routes/public.ts:128-145`), records no designer credit at all — attribution exists only at `backend/src/routes/cart.ts:252-267`. Its only caller today is the configurator's unreachable direct-order branch; the storefront's "Buy now" button goes through the cart (`configurator.js:4669-4673`). Nothing stops two credit rows for the same line and artwork (`backend/migrations/0018_artwork_sales.sql:13-30` has no unique constraint).
3. **No record of money collected.** `payment_status` defaults to `unpaid` (`backend/migrations/0011_payments_address.sql:6`) and its only writer, `setOrderPaymentStatus` (`backend/src/db/queries.ts:334`), is called only from provider webhooks that are not live (`backend/src/routes/payments.ts:56`, `backend/src/routes/payments.ts:83`). The admin order page shows payment state read-only (`admin/assets/order-detail.js:122-135`). The dashboard's 30-day revenue therefore sums every non-cancelled order whether or not cash arrived (`backend/src/db/queries.ts:650`), and customer spend has two definitions: non-cancelled orders on the customer's account (`backend/src/db/queries.ts:240`), all orders including cancelled ones in the admin (`backend/src/db/queries.ts:1141`, `backend/src/db/queries.ts:1165`).
4. **Payment methods are switched on by credentials alone.** `providerConfigured()` (`backend/src/lib/payments.ts:35-42`) decides both what `/api/payments/methods` advertises (`backend/src/routes/payments.ts:21-29`) and what checkout accepts (`backend/src/routes/cart.ts:208`), and the documented way to connect a provider is to set its secrets and fill in its TODOs, with no separate go-live switch (`backend/src/lib/payments.ts:9-13`). Configuring a provider to test it in its sandbox would also offer it to live customers before any integration is complete.
5. **Orders can exist without printable artwork, and carts can vanish.** On the web, `_uploadDataUrl` returns `null` both when there is nothing to upload and when an upload fails (`configurator.js:4447-4463`), and `addToCart` adds the item either way (`configurator.js:4621-4637`); only the unused direct-order branch checks `_logoUploadIncomplete` (`configurator.js:5748`). In the app, cart sync sends no print-master or mockup keys (`mobile/src/state/cart.tsx:82-92`), the Worker stores them as null (`backend/src/routes/cart.ts:82-87`), and the admin falls back to an approximate reconstruction (`admin/assets/order-detail.js:575-581`). The app's checkout deletes the server cart before re-uploading its own (`mobile/src/state/cart.tsx:78-80`), discarding anything the customer added on the web (`assets/cart.js:127`, `assets/cart.js:135`). The configurator still carries a direct-order branch that shows "order accepted" even when the order failed (`configurator.js:5809-5840`); it is unreachable because `openOrderModal` (`configurator.js:5233`) has no caller, but it is maintained code.

What it costs: every figure the founder decides on — order total, 30-day revenue, customer spend, designer earnings — is unverifiable; the first payment gateway cannot be switched on safely; and a failed upload turns a first customer's order into a refund conversation.

## 2. Goal and success metric

Every sum LOOM stores, charges or reports is computed by the Worker from catalogue data, every order is written whole or not at all with printable files, and every delivered COD order ends with a recorded payment outcome.

- **Metric:** money-integrity violations among orders placed after the release: (a) order lines whose `unit_price` differs from `base_price` plus the markups credited on that line; (b) orders whose `total_price` differs from the sum of their lines; (c) lines with content on a side but no print master for that side; (d) delivered COD orders with no recorded payment outcome 7 days after delivery.
- **Target:** 0 for each of (a)–(d), measured weekly from release and on the M1 due date, 2026-10-23, over at least 20 real orders.
- **How it is measured:** the four queries below against production D1 (`wrangler d1 execute loom-db --remote --command "…"`), with `:release` replaced by the timestamp (milliseconds) of the T3 deploy — the writer that fills `base_price` and gives every order its lines. Results are pasted into the tracking issue before it is closed.

```sql
-- (a) line price ≠ base price + credited markups
SELECT COUNT(*) FROM order_items oi
WHERE oi.created_at >= :release
  AND oi.unit_price <> oi.base_price
      + COALESCE((SELECT SUM(s.markup) FROM artwork_sales s WHERE s.order_item_id = oi.id), 0);

-- (b) order total ≠ sum of lines
SELECT COUNT(*) FROM orders o
WHERE o.created_at >= :release
  AND o.total_price <> (SELECT COALESCE(SUM(unit_price * quantity), 0) FROM order_items WHERE order_id = o.id);

-- (c) side with content but no print master
SELECT COUNT(*) FROM order_items
WHERE created_at >= :release
  AND ((json_array_length(design_json, '$.front.elements') > 0 AND front_print_key IS NULL)
    OR (json_array_length(design_json, '$.back.elements') > 0 AND back_print_key IS NULL));

-- (d) delivered COD orders still without a payment outcome after 7 days
SELECT COUNT(DISTINCT o.id) FROM orders o
JOIN order_status_log l ON l.order_id = o.id AND l.new_status = 'delivered'
WHERE o.created_at >= :release AND o.payment_method = 'cod'
  AND o.payment_status NOT IN ('paid', 'refunded')
  AND l.changed_at < (strftime('%s', 'now') * 1000 - 7 * 86400000);
```

## 3. Users and scenarios

- **Customer** (web and app) designs a garment, optionally with a marketplace artwork, and pays the courier in cash.
- **Designer** is credited a share of the markup each time their artwork is ordered.
- **Operator** (the founder, in the admin panel) approves proofs, runs fulfilment and records whether the cash came back.
- **Courier** collects cash at the door; has no system access and reports to the operator.

Scenarios this PRD must support:

1. **COD order from the web.** A customer designs a shirt and adds it to the cart; the print files upload and the Worker sets the price. They check out with cash on delivery. The courier collects the cash, the operator taps "cash collected" on the order page, and the order now counts in 30-day revenue and in the customer's spend.
2. **Marketplace design from the app, cart started on the web.** A customer applies a designer's artwork in the app and adds it to the cart; print master and mockups upload. The shirt they added on the web yesterday is still in the order summary. The order is written in one step and the designer is credited exactly once for the line.
3. **Price changes mid-session.** After add-to-cart the operator raises a product's price, or a designer's artwork is unpublished. At checkout the customer sees "price changed" (or "item unavailable") with the new total, in their language, and confirms before any order exists.

## 4. Scope

**In:**
- One server pricing function used by add-to-cart, cart checkout and the direct-order endpoint (`POST /api/orders`); money validation on every price field.
- Web and app show the Worker's price, treat their own number as a hint, and never show a placeholder price.
- One atomic order writer for both order paths, with designer attribution on both and idempotent checkout.
- A payment ledger table, an admin "cash collected" / "refunded" action, and revenue and spend that count paid orders only.
- An explicit go-live flag per payment provider.
- No order without printable artwork: web add-to-cart blocks on upload failure, the app sends print and mockup files, the Worker rejects lines missing a print master; the configurator's unreachable direct-order branch is removed.
- The app merges its cart into the server cart instead of replacing it.

**Out (and why):**
- Payme, Click and Uzum integrations, webhook state machines and reconciliation — M2 "Payme + payouts". This PRD only guarantees they stay switched off until then.
- Designer payout ledger and payout destination — M2.
- Delivery fee — none exists today; left as an open question (§8), not decided here.
- Partial payments, split tender, courier tooling — not needed for the first COD orders.
- Migration tooling (`wrangler d1 migrations apply`), an error sink and automated tests — quality-infrastructure work tracked separately; acceptance here is verified with the SQL and UI checks listed per task.
- Bringing the app's studio to multi-layer parity with the web — separate work.
- Other security hardening — tracked in private advisories (maintainers only).

## 5. Requirements

Numbered so tasks and PRs can cite them. Each has acceptance criteria a reviewer can check without asking.

**R1 — The Worker is the only source of price.**
- Given an active product with price P and a design referencing distinct approved artworks with markups M1…Mn, when the design is added to the cart, then the stored line price is P + ΣMi.
- Given a client sends a price hint that differs from the Worker's price, when it adds to the cart, places a direct order or checks out, then the Worker responds 409 with `code: "price_changed"` and the current price or total, and creates no cart line or order.
- Given a cart line whose stored price no longer matches the current price, when the customer checks out, then the Worker updates the stored line, responds 409 `price_changed` with the refreshed lines and total, and creates no order.
- Given a design that references an artwork that is missing or not approved, when it is added or checked out, then the Worker responds 409 `artwork_unavailable` naming the artwork and line, and writes nothing.
- Given a request with no valid active product (including a legacy cart line with no product), when it is added or checked out, then the Worker responds 400 `product_required` or 409 `item_unavailable` naming the line, and writes nothing.
- Given a unit price — hint or computed — that is not an integer between 1 and `MAX_UNIT_PRICE`, or a total hint that is not a positive safe integer, then the Worker responds 400 `invalid_money` and writes nothing. A cart total above `MAX_UNIT_PRICE` is valid.
- Given an online payment method, then the payment-link amount equals the order total the Worker computed.

**R2 — Clients display the Worker's price and never invent one.**
- Given the product request fails, when the configurator or the app shows a price, then no number is shown and add-to-cart / buy-now are disabled with a retry; 150 000 never appears as a fallback.
- Given a 409 `price_changed` or `artwork_unavailable`, when the customer is adding to the cart or placing the order, then the UI shows the new price or the unavailable item in uz, ru or en and requires another tap; no order is placed at a price the customer did not see.
- Given the same artwork on front and back, then both clients count its markup once, matching the Worker.

**R3 — Orders are written by one atomic, idempotent writer.**
- Given either order path (cart checkout or direct order), when an order is created, then the order, every line, every designer credit and (for checkout) the cart clear are written in one `db.batch()`; if any statement fails, nothing is written.
- Given a line with approved marketplace artwork, when it is ordered through either path, then exactly one `artwork_sales` row exists per line and artwork, carrying the markup used to price that line.
- Given the same user sends the same `Idempotency-Key` twice, when checking out or placing a direct order, then the second response returns the first order's id and no second order exists.
- Given an attempt to insert a second credit for the same line and artwork, then the database rejects it.

**R4 — Payment state is recorded, and only paid money counts.**
- Given a COD order that is not cancelled, when an operator with the `orders.payment` capability records "cash collected", then the order's `payment_status` is `paid`, `paid_at` is set, and a `payment_transactions` row (provider `cod`, kind `payment`, amount = order total, admin id, optional reference) exists — written in one batch.
- Given a paid order, when the operator records "refunded", then `payment_status` is `refunded` and a refund row exists; refund is allowed only from `paid`, "cash collected" is not allowed on a cancelled or already-paid order, and a rejected action writes nothing.
- Given the admin dashboard, then 30-day revenue is the sum of `total_price` over orders with `payment_status = 'paid'` and `paid_at` inside the window; customer spend (`total_spent`) on the account screen (web and app), in the admin user-list API response and on the admin user page uses the same paid-only definition.
- Given an operator without `orders.payment`, then the payment controls are hidden and the endpoint responds 403.

**R5 — Payment providers fail closed.**
- Given a provider's secrets are set but `<PROVIDER>_LIVE` is not `1`, then `/api/payments/methods` reports it unavailable, checkout rejects it with `payment_method_unavailable` before creating an order, and no payment link is built.
- Given `<PROVIDER>_LIVE=1` and complete secrets, then the provider is offered; given the flag without complete secrets, it is not.
- Cash on delivery is always offered.

**R6 — No order without printable artwork.**
- Given a design side with content, when a required upload (the original logo files or the side's print master) fails on the web or in the app, then the item is not added, the customer sees a retry message in their language, and buy-now does not navigate to checkout.
- Given a side with no content, then nothing is uploaded for it and add-to-cart proceeds — "nothing to upload" is not a failure.
- Given the app adds a customised item, then the cart line carries front and back print and mockup keys and separate front and back logo keys.
- Given an add-to-cart or direct-order request whose design has content on a side but no print key for that side, then the Worker responds 422 `print_files_missing` and writes nothing.
- Given the configurator code, then no path shows an order-success message without an order id returned by the Worker; the unreachable direct-order branch is gone.

**R7 — A customer's cart is never silently discarded.**
- Given items in the server cart added on the web, when the customer checks out in the app, then those items stay in the cart, appear in the app's order summary and total, and are ordered with the app's items.
- Given the app retries a sync after a network failure, then no item is duplicated in the server cart.

### Standard requirements (delete a line only with a reason)

- [ ] Every new user-facing string exists in **uz, ru and en** (`assets/i18n.js`, `mobile/src/i18n/strings.ts`, and a stable error `code` for server messages).
- [ ] Web and mobile behave the same, or the gap is listed under Out.
- [ ] Works in light and dark theme on the customer site.
- [ ] Money is computed on the server; the client only displays it.
- [ ] Failures are visible to the founder (log, alert or admin state) — never silent.
- [ ] Changed static assets have their `?v=` bumped (see the cache contract in `_headers`).

## 6. Technical approach

**Pricing (R1).** New `backend/src/lib/pricing.ts` exports `artworkIdsIn()` (moved from `backend/src/routes/cart.ts:31-47`), `MAX_UNIT_PRICE` (proposed 10 000 000 UZS), `isMoney(n)` (`Number.isSafeInteger(n) && n >= 1 && n <= MAX_UNIT_PRICE`) for unit prices, and `priceFor(db, productId, designJson)`. Totals are checked as positive safe integers only, because a large cart can legitimately exceed `MAX_UNIT_PRICE`. `priceFor` loads the product with `getProductById` (`backend/src/db/queries.ts:29-33`) and requires `active = 1`, loads every referenced artwork in one `SELECT … WHERE id IN (…)`, rejects any that is missing or not `approved`, and returns `{ ok: true, unitPrice, basePrice, artworks: [{ id, designerUserId, markup }] }` or `{ ok: false, code, … }`. The same `artworks` array later feeds designer attribution, so the markup charged and the markup credited come from one read. Callers: `POST /api/cart` (`backend/src/routes/cart.ts:56-92`), `POST /api/cart/checkout` (re-prices every line before writing), and `POST /api/orders` (`backend/src/routes/public.ts:60-166`). `unitPrice`, `totalPrice` and a new optional `expectedTotal` become hints compared against the result.

**One writer (R3).** New `backend/src/lib/orders.ts` exports `createOrderFromItems(db, input)` and `attributeArtworkSales(…)`, which returns prepared statements (the share formula moves from `backend/src/db/queries.ts:2065`; the rate stays `DESIGNER_COMMISSION_PCT`, `backend/src/routes/designers.ts:28`). Statements inside a D1 batch cannot read each other's `last_row_id`, so the writer generates a `checkout_ref` (UUID) for the order and a `line_no` per line up front, and child rows reference their parents by sub-select on those. `anonymizeUser` already sends a `db.batch()` (`backend/src/db/queries.ts:2246`); the `checkout_ref` sub-select technique is new. The direct-order path writes one `order_items` line too; the admin already prefers lines when present (`backend/src/routes/admin.ts:340-342`, `admin/assets/order-detail.js:212-218`). Telegram notification and payment link run only after the batch succeeds.

**Payments (R4, R5).** `setOrderPaymentStatus` (`backend/src/db/queries.ts:334-349`) stays the single writer of `orders.payment_status`; it gains a batch variant that also inserts the `payment_transactions` row. New `PATCH /api/admin/orders/:id/payment` follows the pattern of `PATCH /api/admin/orders/:id/status` (`backend/src/routes/admin.ts:386-440`) behind a new `orders.payment` capability, added to `CAPABILITIES` (`backend/src/lib/permissions.ts:29-48`). The owner and manager presets derive from `ALL_CAPABILITIES` and receive it automatically (`backend/src/lib/permissions.ts:164-166`); the staff preset does not (`backend/src/lib/permissions.ts:167-176`). `providerConfigured()` (`backend/src/lib/payments.ts:35-42`) is split into "configured" (secrets present, for sandbox work) and "offered" (configured and `<PROVIDER>_LIVE === '1'`); the methods endpoint, checkout and `createPaymentUrl` use "offered". Env types in `backend/src/types.ts:39-45`.

**Printable artwork (R6, R7).** Web: `_uploadDataUrl` (`configurator.js:4449`) throws on failure and returns `null` only for empty input; `captureProofs` (`configurator.js:4543-4595`) propagates print-master failures while mockups and the GLB stay best-effort; `addToCart` (`configurator.js:4597-4665`) applies `_logoUploadIncomplete` (`configurator.js:4489-4491`). App: the 3D page renders each print master on a fresh transparent canvas with its existing `drawElement()` (`mobile/src/lib/scene-html.ts:198-223`), at the print rect, the web's geometry (`mobile/src/lib/print.ts:10-25`) and the web's `PRINT_SCALE` of 3 (`configurator.js:4521`), without the on-garment text shadow (`mobile/src/lib/scene-html.ts:221`). It cannot be cut from the baked texture canvas, which already contains the garment colour (`mobile/src/lib/scene-html.ts:225-232`). Mockups extend the existing `snapshot` (`mobile/src/lib/scene-html.ts:532-543`, a PNG from the current camera today) with a view and JPEG output; files upload through `uploadFile` (`mobile/src/api/client.ts:111-128`). The app cart tracks each line's server id and never deletes the server cart.

**Data model.** Migrations take the next free number at merge time (PRD-002 and PRD-003 add migrations too); the numbers below are as of writing.
- `0021_order_writer.sql`: `orders.checkout_ref TEXT` (unique where not null), `orders.idempotency_key TEXT` (unique per `user_id` where not null), `order_items.line_no INTEGER`, `order_items.base_price INTEGER`, `CREATE UNIQUE INDEX … ON artwork_sales(order_item_id, artwork_id)`.
- `0022_payment_transactions.sql`: `payment_transactions(id, order_id, provider, kind, amount, provider_txn_id, reference, note, admin_id, created_at)` with a unique index on `(provider, provider_txn_id)` where the id is not null and an index on `order_id`. It also records that `orders.paid_at` is milliseconds, as `setOrderPaymentStatus` writes it (the comment in `backend/migrations/0011_payments_address.sql:8` says seconds).

**API contract changes.** `POST /api/cart`: `productId` required; `unitPrice` optional hint; new 400 `product_required` / `invalid_money`, 409 `price_changed` / `artwork_unavailable` / `cart_full`, 422 `print_files_missing`. `POST /api/cart/checkout` and `POST /api/orders`: optional `expectedTotal` / `totalPrice` hints and optional `Idempotency-Key` header; 409 `price_changed` / `artwork_unavailable` / `item_unavailable`; `POST /api/orders` also returns 400 `product_required` / `invalid_money` and 422 `print_files_missing`; replayed responses carry `replayed: true`. New `PATCH /api/admin/orders/:id/payment`. `GET /api/payments/methods` keeps its shape.

## 7. Rollout and verification

1. **Pricing (T1 + T2, same day).** Deploy the Worker, then Pages with `configurator.js`, `assets/cart.js` and `assets/checkout.js` `?v=` bumped. The app half of T2 needs a new app build; if app customers are live, ship that build before or with the Worker, because the current build prices a repeated artwork per side and would get 409s it cannot explain. Verify: add a plain and a marketplace design on loomdesign.uz, then `SELECT product_id, unit_price FROM cart_items ORDER BY id DESC LIMIT 2` matches `products.price` (+ markup). Temporarily raise a test product's price in the admin, check out an existing line, see the "price changed" banner, restore the price. Rollback: `wrangler rollback` and revert the Pages commit.
2. **Order writer (T3).** Run the duplicate check `SELECT order_item_id, artwork_id, COUNT(*) FROM artwork_sales GROUP BY 1, 2 HAVING COUNT(*) > 1` and resolve any rows, apply the order-writer migration (`0021_order_writer.sql` as of writing), deploy the Worker, then Pages and the app build that send `Idempotency-Key`. Verify with a test COD order containing a marketplace artwork: one `artwork_sales` row per line and artwork, `line_no` and `base_price` filled. Cancel test orders with the note "test". Rollback: `wrangler rollback`; the migration is additive and the old code ignores the new columns.
3. **Payments (T4, T5).** Apply the payment-transactions migration (`0022_payment_transactions.sql` as of writing), deploy the Worker, then the admin assets (`admin/order.html`, `admin/dashboard.html`, `admin/assets/order-detail.js?v=` bumped). Verify: `https://api.loomdesign.uz/api/payments/methods` returns only `cod: true`; record "cash collected" on a test order and watch 30-day revenue move by its total; record "refunded" and watch it move back. Rollback: `wrangler rollback`; the table is additive.
4. **Printable artwork (T6, then T7 + T8).** Pages first (T6), then the app build (T7, T8) built by the founder, then the Worker's `print_files_missing` check last, once every client sends print keys. Verify each step with query (c) from §2 and the admin order page showing a downloadable print master instead of "реконструкция (приблизительно)". Rollback: revert the Pages commit; the Worker check can be rolled back alone.
5. **Close-out.** Run the four §2 queries on 2026-10-23, paste the results into the tracking issue, and set this doc to *Shipped*.

## 8. Risks and open questions

- **Q:** Delivery fee — none exists today: the order total is the sum of lines only (`backend/src/routes/cart.ts:26-28`) and the checkout shows subtotal = total (`assets/checkout.js:230-231`). Charge a fee, fold it into product prices, or offer free delivery above a threshold? — the founder decides by 2026-10-09 so any change can still land in M1.
- **Q:** What happens to a designer's share when a COD order is refused at the door? Today credit is recorded at order time and `payable` counts delivered orders only (`backend/src/db/queries.ts:2222`); refused orders have no representation. Void the credit, keep it, or pay part? — the founder decides before the first designer payout (M2, 2026-11-22).
- **Q:** Retire `POST /api/orders` instead of bringing it in line? Once T6 removes the configurator's unreachable direct-order branch, no client in this repo calls it (the storefront's "Buy now" goes through the cart). Retiring it would drop the direct-order parts of T1, T3 and T7; first confirm that no released app build calls it. — the founder decides before T1 starts.
- **Risk:** Extra 409s if a client's hint rule drifts from the Worker's (the app's per-side markup today). Mitigation: T2 aligns both clients to the distinct-artwork rule before T1's check is relied on.
- **Risk:** The unique index on `artwork_sales` fails to build if duplicates already exist. Mitigation: the duplicate check in step 2 of §7.
- **Risk:** Very large carts make a large batch. Mitigation: cap cart lines (proposed 20) so one checkout stays well inside D1's per-invocation limits.
- **Risk:** An app print master that differs from the web's for the same design. Mitigation: T7 compares both against the admin reconstruction for a reference design before release.

## 9. Tasks

Tracked as sub-issues of the tracking issue — that list is the source of truth. Summary for reading offline:

| # | Task | Req | Size |
|---|---|---|---|
| [#6](https://github.com/TIMURNASRIDDINOV/LOOM/issues/6) T1 | Add server pricing authority priceFor() to every order path | R1 | M |
| [#7](https://github.com/TIMURNASRIDDINOV/LOOM/issues/7) T2 | Show server prices in web and app; drop the 150 000 fallback | R2 | M |
| [#8](https://github.com/TIMURNASRIDDINOV/LOOM/issues/8) T3 | Write orders through one atomic, idempotent order writer | R3 | L |
| [#9](https://github.com/TIMURNASRIDDINOV/LOOM/issues/9) T4 | Record COD payments and count only paid orders as revenue | R4 | M |
| [#10](https://github.com/TIMURNASRIDDINOV/LOOM/issues/10) T5 | Offer a payment provider only when its LIVE flag is set | R5 | S |
| [#11](https://github.com/TIMURNASRIDDINOV/LOOM/issues/11) T6 | Block web add-to-cart when print files fail to upload | R6 | S |
| [#12](https://github.com/TIMURNASRIDDINOV/LOOM/issues/12) T7 | Send print and mockup files from the app and require them | R6 | L |
| [#13](https://github.com/TIMURNASRIDDINOV/LOOM/issues/13) T8 | Merge the app cart into the server cart instead of wiping it | R7 | M |

## Changelog

- 2026-09-23 — Drafted from the September audit.
- 2026-09-23 — Citations re-verified against the code; direct-order endpoint, app print-master approach and money bounds corrected.
- 2026-09-24 — Status set to Draft pending founder review; tracking issue and tasks created.
