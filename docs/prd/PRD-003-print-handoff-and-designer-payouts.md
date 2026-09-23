# PRD-003 — Print-partner handoff and designer payouts

| | |
|---|---|
| **Status** | Draft — awaiting founder review |
| **Owner** | @TIMURNASRIDDINOV |
| **Tracking issue** | [#24](https://github.com/TIMURNASRIDDINOV/LOOM/issues/24) — tasks live there as sub-issues |
| **Milestone** | M2 · Payme + payouts |
| **Last updated** | 2026-09-23 |

## 1. Problem

Attribution works: `artwork_sales` freezes the commission at sale time (`backend/migrations/0018_artwork_sales.sql`), the designer's share is computed from the markup stored on the artwork row (`backend/src/routes/cart.ts:255-265`), and the admin production sheet converts design_json into centimetres on a named 30 × 40 cm platen. Everything after attribution is missing, on both sides of the business.

**The print partner cannot be given a file that meets a DTG spec.**
- The print master is rendered at `PRINT_SCALE = 3` and the comment claims "~235 dpi" (`configurator.js:4521`). That figure was worked out for the legacy 928 px rect. The live front rect is 769.0 px wide (`configurator.js:52`), so the shipped master is 2307 × 3076 px, about **195 DPI** over 30 × 40 cm. DTG shops ask for 300.
- Every raster upload larger than 2048 px (`TEX_SIZE`, `configurator.js:12`) is shrunk before it reaches the master (`configurator.js:4990-4998`). A photo printed across the full 30 cm platen therefore has at most **~173 DPI** of real detail, whatever the master's pixel count.
- The master is encoded with a blocking `toDataURL` for both sides, one after the other, before anything uploads (`configurator.js:4537`, `configurator.js:4547-4550`). The PNG carries no physical size, so the partner has to be told the print dimensions separately. Going to 300 DPI makes each master about 2.36× larger in pixels, so the time it holds up the customer's page has to be fixed in the same change.
- The configurator saves the designer's full-resolution file key as `artworkKey`, and a comment explains it exists so the print shop can pull the original (`configurator.js:5037-5040`, serialised at `configurator.js:4419`). The admin never reads it back. The spec table shows a designer row only (`admin/assets/order-detail.js:674-677`), and that row reads `el.author` while the configurator writes `artworkAuthor` (`configurator.js:4418`), so the designer's name shows as "—".
- Nothing is organised around a production day. The orders page has a status select, a customer search box and a refresh button, and nothing more (`admin/orders.html:26-41`). Rows have no selection (`admin/assets/orders.js:55-65`). Each print file is a separate per-order download with a generic name, `print-front.png` (`admin/assets/order-detail.js:572`). Nothing answers the question "which approved orders have not gone to the printer yet?"

**The designer ledger is open-loop and will double-pay.**
- `payable` is recalculated on every request as the sum of shares on delivered orders, and nothing subtracts what has been paid (`backend/src/db/queries.ts:2222`). The route itself says the transfer "happens outside the system for now" (`backend/src/routes/admin-artworks.ts:72-77`). The first payout Tim makes will still show as owed the next morning.
- LOOM never collects a payout destination. The apply form asks only for a handle and a bio (`account.html:665-676`). The finance table's «Контакт» column shows a Telegram username or phone number (`admin/artworks.html:87`, `admin/assets/artworks.js:204`).
- The ledger lists only active designers (`backend/src/db/queries.ts:2228`). Account deletion sets `status = 'deleted'` and `is_designer = 0` (`backend/src/db/queries.ts:2243-2256`), so a deleted designer's unpaid balance drops out of the table.
- Nothing can undo a sale. `ORDER_STATUSES` has no refund or return state (`backend/src/db/schema.ts:3-10`), and the only callers of `setOrderPaymentStatus` set `paid` (`backend/src/routes/payments.ts:56`, `backend/src/routes/payments.ts:83`). Settled earnings ignore payment entirely (`backend/src/db/queries.ts:2115`). A COD order refused at the door, or a paid order later refunded, keeps counting as money owed. The only tool the operator has is «Отменён», which also messages the customer.

**The supply side gets no feedback, and moderation does not scale.**
- A sale is recorded and no one is told (`backend/src/routes/cart.ts:255-267`). The only message a designer ever receives is the approve/reject notice (`backend/src/routes/admin-artworks.ts:131-155`).
- The market is newest-first only (`backend/src/db/queries.ts:1943`). Tags are stored (`backend/src/routes/designers.ts:242`) but never shown to buyers or used for filtering (`assets/market.js:38-62`).
- The web designer cabinet shows only the total `earned` (`assets/designer.js:113`). The API already returns `earned_settled` (`backend/src/routes/designers.ts:204`), and only the app shows it (`mobile/app/(tabs)/publish.tsx:269`).
- Uploads carry no rights statement the designer has to accept, on web or in the app (`account.html:714-748`, `mobile/app/(tabs)/publish.tsx:209-233`). Handle validation covers format and uniqueness (`backend/src/routes/designers.ts:149-161`); no names are reserved for LOOM or its staff yet.
- Taking a work down at the designer's request goes through the reject path (`admin/assets/artworks.js:43`). That path requires a rejection note (`backend/src/routes/admin-artworks.ts:110-113`) and messages the designer "Работа отклонена" (`backend/src/routes/admin-artworks.ts:136`). The privacy policy promises withdrawal on request (`privacy.html:139`).
- Moderation is one confirm dialog per work (`admin/assets/artworks.js:107`), with a free-text reason only (`admin/assets/artworks.js:138`).

## 2. Goal and success metric

Every approved order reaches the print partner as a 300 DPI, self-describing file bundle without per-order clicking, and every designer's payable balance is exactly what LOOM still owes them.

- **Metric:** (a) share of new web order items whose print masters are 300 DPI with physical size embedded; (b) ledger drift at each payout close, meaning the difference between the sum of `payable` shown in admin and settled earnings minus recorded payouts, checked against the transfers actually made; (c) operator time to hand a day's approved orders to the partner.
- **Target:** (a) 100% of web order items created after T1 deploys, excluding items recorded with a documented DPI fallback; (b) 0 UZS drift at every monthly close, starting with the first payout in M2; (c) at most 5 minutes for 20 orders, from opening the print queue to having the ZIP and CSV.
- **How it is measured:** (a) `wrangler d1 execute loom-db --remote --command "SELECT COUNT(*) AS items, SUM(json_extract(i.design_json,'$.printDpi') >= 300) AS at300 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.created_at >= <T1 deploy epoch ms>"`, plus a monthly spot check of one downloaded master with `sips -g dpiWidth -g pixelWidth`; (b) at each close, export `designer_payouts` for the month and match every row to the card/bank statement, then confirm that for every designer settled minus non-voided payouts equals the admin «К выплате» figure; (c) the operator times the first three production days after T3 ships and notes the result on the tracking issue.

## 3. Users and scenarios

- **Operator (Tim):** approves proofs, prepares the day's print run, pays designers.
- **Print partner:** receives files and a manifest and prints them. They never log in to LOOM.
- **Designer:** uploads work, watches sales, expects to be paid correctly and on a known schedule.
- **Customer:** designs on the web configurator. They care that add-to-cart stays fast and that the shirt that arrives is sharp.

Scenarios:
1. **Morning print run.** Tim opens «Очередь печати» and sees the 14 orders approved since yesterday. He selects all and downloads one ZIP of 300 DPI masters and marketplace originals with a CSV manifest, sends it to the partner, and moves the orders to «Производство» in one action.
2. **Monthly payout.** Tim opens the finance table. Designer @ozod shows 420 000 UZS payable and a Humo card on file. Tim transfers the money, records the payout with the bank reference, and the balance drops to 0 and stays there. @ozod gets a Telegram message and sees the payout in his cabinet.
3. **Refused at the door.** A COD courier reports a refusal on a delivered marketplace order. Tim clicks «Отменить начисление» on the order and gives a reason. The designer's payable drops, the customer receives no message, and the order history shows why.

## 4. Scope

**In:**
- A 300 DPI print master from full-resolution sources, with physical size embedded and the add-to-cart main-thread cost kept in check (web configurator).
- The designer's original file and each element's effective print resolution, surfaced on the admin order page.
- An admin print queue: approved orders not yet in production, multi-select, one-ZIP download, a CSV manifest for the partner, and a bulk move to production.
- Reversals: earnings stop accruing on refused, refunded or unpaid orders.
- A closed-loop payout ledger with payout destinations, «mark paid», voids, and balances kept for banned and deleted designers.
- Designer-facing earnings (payable, pending, paid, payout timing and history) on web and in the app.
- A Telegram message to the designer on each sale, a popular-first sort, and clickable tags on market.html.
- A rights attestation stored on every upload, reserved handles, and a withdraw action distinct from reject.
- Moderation throughput: bulk approve, preset rejection reasons, search.

**Out (and why):**
- **Server-side price derivation and crediting orders placed without the cart.** These belong to PRD-001 (server-authoritative money). This PRD depends on them: a designer's accrual is only correct if the server derives every charged price from `products.price` plus approved artwork markups, using the same artwork-status rule for charge and credit (PRD-001 R1 treats any artwork that is not approved, `withdrawn` included, as unavailable).
- **Automated payouts through a payment-provider payout API.** A manual transfer recorded in the ledger is enough at current volume. Revisit when payouts exceed about 30 a month.
- **300 DPI masters for native-app orders.** The app is not in the stores yet. Today it sends design_json and one logo key only (`mobile/app/studio.tsx:104-111`), and admin shows an approximate reconstruction for those orders. PRD-001 (R6, T7) makes the app upload print masters cut from its texture canvas; bringing those to this 300 DPI spec is a separate task when the app ships. Until then app items carry no `printDpi`, T2's DPI readout shows their real resolution, and they are not sent to the partner as print-ready.
- **Rendering the master on the server or in admin.** This is listed as an open question in §8. T1 keeps rendering in the configurator.
- **Unifying the four copies of print geometry** (web, admin, two in the app). This is a separate refactor. T1 changes resolution only, never placement.
- **Editing the payout destination in the native app.** Web account page only until the app ships. The app links to it.
- **Self-service withdrawal by the designer.** It stays support-mediated, as `privacy.html:139` promises. The operator action lands here.
- **Bulk reject and translated rejection notes.** Operator-written notes stay free text, as they are today.
- **Tax withholding on payouts.** Open question in §8. The ledger records gross amounts.

## 5. Requirements

**R1 — The print master meets a 300 DPI DTG file spec**
- Given a web design with content on a side, when the customer adds it to the cart or places an order, then that side's uploaded master is 3543 × 4724 px (30 × 40 cm at 300 DPI) with a transparent background and a `pHYs` chunk of 11811 px/m, and design_json records `printDpi: 300`.
- Given a customer image larger than 2048 px, when the master is rendered, then the image is drawn from the original file rather than the 2048 px editing copy, and the element in design_json records the source pixel size it was drawn from (`srcW`, `srcH`).
- Given a marketplace artwork, when the master is rendered, then it is drawn from the designer's original referenced by `artworkKey`. If that file cannot be fetched within 10 s, the editing copy is used and `srcW`/`srcH` say so.
- Given a master whose encoded size would exceed the upload limit, when it is rendered, then it is re-rendered at 240 DPI and then 200 DPI. The DPI actually shipped is both embedded in the file and recorded in `printDpi`, and add-to-cart still succeeds.
- Given a mid-range phone, when add-to-cart runs, then no single main-thread task from print-master work exceeds 200 ms (Chrome Performance panel, 4× CPU throttle), and the «Готовим макеты…» spinner keeps animating.
- Given the source code, then no comment states a DPI different from the one computed.

**R2 — The operator can print a marketplace order from the designer's original**
- Given an order with marketplace artwork, when the operator opens the order page, then each such element shows the designer's handle, the source size in px, and a «Скачать оригинал» button. The button downloads the original through the admin session as `order-<id>-<item>-artwork-<artworkId>.<ext>`.
- Given an older order whose design_json has no `artworkKey`, when the page loads, then the original still resolves from the artwork row.
- Given any image element, then the spec table shows its printed size in cm and its effective DPI. Anything under 150 DPI is flagged.
- Given a print master, then its caption shows the DPI computed from the file, and its download is named `order-<id>-<item>-<side>.png`.

**R3 — A day's approved orders reach the partner as one bundle**
- Given orders whose proof is approved and whose status is «Новый» or «Подтверждён», when the operator opens «Очередь печати», then those orders are listed oldest-approved first, each with its items and the files available.
- Given a selection, when the operator presses «Скачать пакет», then one ZIP downloads. It has a folder per order item holding each side's master and each marketplace original, plus `manifest.csv` at the root. If any file fails to download, the operator is shown which ones, and the manifest marks them `MISSING`. Nothing is dropped silently.
- Given the manifest, then it has one row per item side with order, item, product, quantity, colour, size, side, file name, print size in cm, DPI and original file name. It contains no customer name, phone or address, and it opens in Excel with Cyrillic intact.
- Given a completed export, when the operator presses «Передать в производство», then each selected order moves to «Производство» through the existing status route. The proof gate and the customer notification behave exactly as they do today.

**R4 — Designer earnings accrue only on money LOOM keeps**
- Given a delivered order that the customer refused or returned, when the operator confirms «Отменить начисление» with a reason, then that order's sales are marked reversed and the designer's earned, payable and sold figures drop. The order status is unchanged and the customer receives nothing.
- Given a non-COD order that is delivered but not paid, then its share counts as pending, not payable.
- Given an order whose payment status becomes `refunded`, then its sales are reversed in the same write.
- Given a reversal of a sale that was already paid out, then the designer's payable goes negative, shows as an overpayment, and is deducted from the next payout.

**R5 — Payouts are recorded, and payable = settled earnings − paid**
- Given a designer with payable P, when an admin with the payout capability records a payout of A ≤ P with a method and reference, then a `designer_payouts` row is written and payable is P − A immediately and on every later load.
- Given the same payout request is submitted twice, then exactly one payout row exists.
- Given A > P, then the request is refused with the stable code `payout_exceeds_payable`.
- Given a payout recorded by mistake, when it is voided with a reason, then payable is restored and the row stays visible as voided. The ledger is append-only.
- Given a designer account that is banned or deleted, then it stays in the ledger with its balance and a status badge until that balance is zero.
- Given a designer who saves a payout destination on the account page, then the admin payout dialog shows it in full, every other surface masks it to the last four characters, and no public endpoint returns it.
- Given a recorded payout, then the designer gets a Telegram message (if Telegram is linked) and sees the payout in their history.

**R6 — Designers see what they are owed and when it will be paid**
- Given a designer on the web account page or in the app, then they see payable, pending (awaiting delivery or payment), paid, and total earned, and payable equals the admin ledger figure for them.
- Given the earnings block, then one sentence states the payout schedule. It comes from a single string in uz, ru and en.
- Given past payouts or sales, then the designer sees their payout history and recent sales, with reversed sales labelled.

**R7 — Designers hear about sales, and buyers can find proven work**
- Given a checkout that contains a designer's work, when the order is created, then the designer gets one Telegram message for that order (if Telegram is linked and order notifications are on). The message names the work, the quantity and the share, and says the share becomes payable after delivery. The send is recorded, and checkout never waits on it or fails because of it.
- Given market.html, when the buyer picks «Популярные», then works are ordered by units sold, excluding cancelled and reversed sales, with newest first as the tie-break. The choice is kept in the URL.
- Given a work with tags, then its tags render as links. Clicking one filters the market to works carrying that exact tag (case-insensitive) and shows a control to clear the filter.

**R8 — Marketplace trust basics are in the product**
- Given a designer submitting a work on web or in the app, when they submit, then they must have ticked a rights statement that starts unticked. The server refuses a submission without it (code `rights_attestation_required`), stores the time and statement version on the artwork row, and the moderation card shows both.
- Given a handle that imitates LOOM or staff (for example anything starting with `loom`, or `admin`, `support`, `official`), when someone applies with it, then the request is refused with code `handle_reserved`.
- Given an approved work the designer asked to take down, when the operator chooses «Снять по просьбе дизайнера», then its status becomes `withdrawn`, no note is required, and the designer gets a neutral confirmation instead of "Работа отклонена". Rejection remains the path for violations.
- Given a withdrawn work already in a buyer's cart, when the buyer checks out, then the checkout answers 409 `artwork_unavailable` for it (PRD-001 R1), so the markup is neither charged nor credited.

**R9 — Moderation keeps up with supply**
- Given several pending works, when the operator selects them and confirms once, then all are approved and each designer is notified as today. Any failures are listed by work.
- Given the rejection dialog, then four preset reasons are offered, and each fills the note with text the operator can still edit.
- Given the moderation queue, when the operator types a handle, name or title, then the list filters to matches.

### Standard requirements (delete a line only with a reason)

- [ ] Every new user-facing string exists in **uz, ru and en** (`assets/i18n.js`, `mobile/src/i18n/strings.ts`, and a stable error `code` for server messages).
- [ ] Web and mobile behave the same, or the gap is listed under Out.
- [ ] Works in light and dark theme on the customer site.
- [ ] Money is computed on the server; the client only displays it.
- [ ] Failures are visible to the founder (log, alert or admin state) — never silent.
- [ ] Changed static assets have their `?v=` bumped (see the cache contract in `_headers`).

## 6. Technical approach

**Print path (web, M1).**
- Replace `PRINT_SCALE` (`configurator.js:4521`) with a target DPI. The output size is computed from `PLATEN_CM` (`configurator.js:25`) as round(30 / 2.54 × 300) × round(40 / 2.54 × 300) = 3543 × 4724 px. The per-view scale becomes pxW / rect.w, which is 4.607 on the live 769.0 px front rect: the audit's "PRINT_SCALE ≥ 4.61" rounded to the exact 300 DPI width. Computing from the platen keeps the file size fixed for every mesh, and keeps the canvas at 16.74 MP, under the 16.78 MP canvas-area ceiling of iOS Safari.
- The upload handler `handleImageFile` (`configurator.js:4966`) keeps the untouched `File` next to the 2048 px editing copy. `_renderPrintCanvas` (`configurator.js:4522`) decodes the original with `createImageBitmap` and paints through the existing `drawElementIn` (`configurator.js:1139`). Placement depends only on `scalePct` and the aspect ratio, so a larger bitmap lands in exactly the same place.
- A marketplace artwork added from market.html already arrives as the designer's full file (`applyPendingArtwork`, `configurator.js:1467`), so the kept original covers it. A design restored from the bag re-fetches the original by `artworkKey` from the artwork file route, which allows cross-origin GET (`backend/src/index.ts:40-41`).
- Encoding moves to the asynchronous `canvas.toBlob`. A `pHYs` chunk is spliced in after `IHDR`, which adds 21 bytes and needs no re-encode. The Blob is uploaded directly, next to `_uploadDataUrl` (`configurator.js:4449`), which removes the base64 round trip for masters. The new upload follows PRD-001 T6's failure contract: a failed print-master upload blocks add-to-cart.
- design_json gains the additive fields `printDpi` and `srcW`/`srcH`, and `v` stays 2 (`configurator.js:4435`).

**Admin order page (M1).**
- `buildSpecTable` (`admin/assets/order-detail.js:650`) reads `artworkKey` and `artworkAuthor`, and downloads originals through the existing admin-session media route (`backend/src/routes/admin.ts:509`).
- `getArtworkSalesByOrder` (`backend/src/db/queries.ts:2177`) also returns the artwork's `image_key`, `width` and `height`, as a fallback for older orders.

**Print queue (admin, M2).**
- New `getProductionQueue` next to `getAdminOrders` (`backend/src/db/queries.ts:406`) and a route `GET /api/admin/production-queue` gated on `orders.view`.
- A new page `admin/production.html` with `admin/assets/production.js`, and a nav entry in `admin/assets/layout.js:50`.
- A small store-only ZIP writer, `admin/assets/zip.js`, with no dependency. PNG and JPEG files are already compressed.
- The bulk move to production reuses `PATCH /api/admin/orders/:id/status` (`backend/src/routes/admin.ts:386`) unchanged.

**Earnings and ledger (backend, M2).**
- Earnings are defined once in `queries.ts`:
  - *counted* = not reversed and order not cancelled;
  - *settled* = counted, delivered, and COD or paid;
  - *pending* = counted and not settled.

  `getDesignerStats` (`backend/src/db/queries.ts:2099`), `getDesignerPayouts` (`backend/src/db/queries.ts:2214`), `getDesignerSales` (`backend/src/db/queries.ts:2144`) and `getArtworkSalesCounts` (`backend/src/db/queries.ts:2017`) all use that definition.
- Migrations are additive only, and each is numbered at merge time with the next free number (0021 at the time of writing):
  - `artwork_sales` + `reversed_at`, `reversed_by_admin_id`, `reversal_reason`;
  - a new `designer_payouts` table (designer, amount, method, reference, note, paid_at, created_by_admin_id, a unique request_id, voided_at, voided_by_admin_id, void_reason, created_at);
  - `users` + `payout_method`, `payout_destination`, `payout_updated_at`;
  - `artworks` + `rights_attested_at`, `rights_version`, and the `withdrawn` status value (status is free TEXT, so no table rebuild is needed).
- A new capability `designers.payout` in `backend/src/lib/permissions.ts`, granted to the owner by default.

**API contract changes.**
- `GET /api/designer/stats` adds `paid`, `payable`, `pending` and `payouts[]`, and keeps `earned_settled` for app builds already installed.
- `GET /api/artworks` accepts `sort=popular` and `tag=`.
- `POST /api/designer/artworks` requires `rights_attested: true`.
- New admin routes for payouts (create, void, history), sale reversal, withdraw, batch review and the production queue.

**Reused, not rebuilt.**
- `sendTelegramMessage` and `insertNotification`, following the moderation pattern at `backend/src/routes/admin-artworks.ts:131-155`.
- `confirmDialog`, `requireCap`, the `mediaUrl` helper in the order-detail route, and `loadMedia` (`admin/assets/order-detail.js:373`).

## 7. Rollout and verification

**M1 (before the first COD orders are printed):**
1. **T1 (Pages):** bump `configurator.js?v=` in `configurator.html:55`. Verify by placing a COD test order on loomdesign.uz, downloading the master from admin, and checking that `sips -g pixelWidth -g pixelHeight -g dpiWidth` returns 3543 × 4724 at about 300 DPI. Test on a real iPhone as well as desktop.
2. **T2 (Worker, then admin assets):** deploy the Worker first. The new fields are additive and the old admin ignores them. Then bump `order-detail.js?v=` in `admin/order.html:214`. Verify on a real marketplace order that the downloaded original matches the artwork's pixel size.

**M2:**
1. **D1 migrations:** `wrangler d1 migrations apply loom-db --remote`. They are additive, so the currently deployed Worker keeps working.
2. **Worker:** the backend parts of T3, T4, T5, T7 and T8, with T4 before T5. Verify T4 by reversing a test order's sales and watching payable drop in the admin finance table. Verify T5 by recording a 1 000 UZS payout against a test designer, reloading, confirming the balance holds, then voiding it.
3. **Pages and admin assets:** T3, T6, T7, T8, with every changed asset's `?v=` bumped.
4. **App:** T6 and T8 strings and flows go into the next EAS build. The server keeps `earned_settled` so older builds still render.

**M3:** T9 is admin assets and the Worker only.

**Rollback:**
- Worker: `wrangler rollback`.
- Pages and admin: revert the commit and redeploy.
- Migrations: never rolled back. The columns are nullable or defaulted and unused by older code.
- Ledger: a payout recorded in error is voided, never deleted.

## 8. Risks and open questions

- **Risk: iOS canvas ceiling.** 3543 × 4724 = 16.74 MP sits just under iOS Safari's 16.78 MP canvas limit. The master must never be sized from a mesh rect or above 300 DPI. T1 includes a real-device check and a fallback if canvas allocation fails.
- **Risk: file size.** A full-platen photographic design at 300 DPI can exceed the 15 MB upload limit (`backend/src/lib/r2.ts:10`). T1 falls back to 240/200 DPI and records it, and it does not raise the general upload limit. T1 measures three reference designs; if photos routinely fall back, the next question decides the design.
- **Q: Should the 300 DPI master be rendered in admin from design_json plus originals instead of on the customer's phone?** That would mean no customer main-thread cost, no large upload, and native-app orders covered, but customers would have to upload originals. Tim decides by 2026-10-09, after T1's measurements.
- **Q: Payout schedule and minimum** (for example monthly by the 10th, minimum 50 000 UZS). Tim decides before T6's copy ships, by 2026-10-23.
- **Q: Which payout methods, and whether to store full card numbers or only a wallet phone number.** Tim decides before T5 starts.
- **Q: What happens to the unpaid balance of a deleted account.** Either keep the destination until the balance is settled, or blank it immediately and pay on request through support. Tim decides before T5 merges.
- **Q: Once PRD-001 R4 records cash collection for COD orders, should *settled* require `payment_status = 'paid'` for COD as well?** That would make a refusal at the door drop out of payable without a manual reversal. T4 ships with COD settled on delivery; Tim decides before T4 merges.
- **Q: Tax obligations on designer payouts in Uzbekistan** (self-employed status, withholding). Tim and an accountant decide before the first payout.
- **Q: Does the print partner ship orders, and so need recipient data?** The manifest leaves it out by default. Tim confirms at partner signing.
- **Q: What language should designer Telegram messages use?** Accounts store no language today. The default is one message in uz then ru. Tim can revisit in M3.
- **Q: Should the marketplace minimum rise above 1500 px on the long side** (`backend/src/routes/designers.ts:232`)? That minimum is about 127 DPI across the full platen. Tim decides in M3, using T2's DPI flags as evidence.
- **Risk: the partner's RIP ignores `pHYs`.** The manifest states the physical size explicitly, so the file is never the only source of that information.

## 9. Tasks

Tracked as sub-issues of the tracking issue — that list is the source of truth. Summary for reading offline:

| # | Task | Req | Size |
|---|---|---|---|
| [#25](https://github.com/TIMURNASRIDDINOV/LOOM/issues/25) T1 | Render the print master at 300 DPI from full-resolution sources (M1) | R1 | L |
| [#26](https://github.com/TIMURNASRIDDINOV/LOOM/issues/26) T2 | Add designer-original download and print DPI to the order spec (M1) | R2 | S |
| [#27](https://github.com/TIMURNASRIDDINOV/LOOM/issues/27) T3 | Add a print queue with bulk download and partner CSV to admin | R3 | L |
| [#28](https://github.com/TIMURNASRIDDINOV/LOOM/issues/28) T4 | Stop accruing designer shares on refused, refunded or unpaid orders | R4 | M |
| [#29](https://github.com/TIMURNASRIDDINOV/LOOM/issues/29) T5 | Record designer payouts and compute payable as settled minus paid | R5 | L |
| [#30](https://github.com/TIMURNASRIDDINOV/LOOM/issues/30) T6 | Show designers payable, pending, paid and payout timing | R6 | S |
| [#31](https://github.com/TIMURNASRIDDINOV/LOOM/issues/31) T7 | Notify designers of sales and add popular sort and tag filters | R7 | M |
| [#32](https://github.com/TIMURNASRIDDINOV/LOOM/issues/32) T8 | Store rights attestation per upload, reserve handles, add withdraw | R8 | M |
| [#33](https://github.com/TIMURNASRIDDINOV/LOOM/issues/33) T9 | Add bulk approve, preset rejection reasons and search to moderation (M3) | R9 | M |

## Changelog

- 2026-09-23 — Drafted from the September audit.
- 2026-09-23 — Checked against the code: line references corrected, and dependencies on PRD-001 (withdrawn artwork at checkout, app print masters, refund writes, upload failure contract) made explicit.
- 2026-09-24 — Status set to Draft pending founder review; tracking issue and tasks created.
