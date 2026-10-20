# LOOM Backend API

Base URL: `https://api.loomdesign.uz`

All request/response bodies are `application/json` unless noted. Admin endpoints require the `admin_token` httpOnly cookie set by `/api/admin/login`.

---

## Public

### Products

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List active products |
| GET | `/api/products/:slug` | Get product by slug |

### Orders

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/cart/checkout` | Place a cart order; requires `Idempotency-Key` and a verified user |
| GET | `/api/me/orders` | User's orders (Bearer or `user_token` cookie) |

### Uploads

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/uploads` | Upload PNG/JPEG/GLB to R2. Signed-in users only (Bearer or cookie); rate-limited 30/min per IP and per user. Returns `{ key }`. |
| GET | `/api/uploads/:key` | The uploader's own file (Bearer or cookie) |
| POST | `/api/uploads/model` | Reserve the key of a 3D review model (`logos/<uuid>.glb`) so a cart item can carry it before the bytes arrive. Signed-in; counts toward the uploads rate limit. Returns `{ key }`. |
| PUT | `/api/uploads/:key` | Fill a reserved `.glb` key with the raw GLB bytes, once. Uploader only; 404 if not theirs, 409 if already stored, 400 if not a GLB. |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/models/:key` | Serve GLB/thumbnail (public, immutable cache, `Access-Control-Allow-Origin: *`) |
| GET | `/api/files/artwork/:key` | Serve designer artwork from `loom-uploads` (public, immutable, CORS `*`). Only keys that belong to an artwork row. |
| GET | `/api/files/avatars/:key` | Serve a user avatar (public, 24 h cache) |
| POST | `/api/files/track` | Funnel analytics event (`session_id`, `page`, `event`, device fields). Allow-listed events only. |

### Designer marketplace

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/artworks` | — | Approved artwork, newest first. Each item carries `image_url`, `image_key` (R2 key for the print shop), `author`, `markup`, `sold`. |
| GET | `/api/designers/:handle` | — | A designer's public page: `handle`, `name`, `bio`, `avatar_url`, `since`, `works[]`, `units_sold`. |
| POST | `/api/designer/apply` | Bearer | `{ handle, bio? }` — opt in as a designer (also edits handle/bio). |
| GET | `/api/designer/artworks` | Bearer | The designer's own works in every moderation state, with `sold` counts. |
| POST | `/api/designer/artworks` | Bearer | `{ title, image_key, tags?, width?, height?, markup }` — submit for moderation. `image_key` comes from `POST /api/uploads` by the same user. |
| GET | `/api/designer/stats` | Bearer | `works_*` counts, `units_sold`, `earned`, `earned_settled` (delivered orders), `commission_pct`, recent `sales[]`. |

**Sales attribution.** A `design_json` image element may carry `artworkId`. At
`POST /api/cart/checkout` every such element is resolved against `artworks`
(approved only) and a row is written to `artwork_sales` with the designer's
share frozen at `markup × qty × (100 − commission) / 100`. Migration 0018.

### Payments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/payments/methods` | `{ cod, payme, click, uzum }` — which methods the Worker can complete (a provider is `true` once its merchant secrets are set). |
| POST | `/api/payments/{payme,click,uzum}/webhook` | Provider callbacks; flip `orders.payment_status`. |

---

## Auth (Email/Password)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{ email, password, name?, phone? }` | Register user, returns `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | Login, returns `{ token, user }` |
| GET | `/api/auth/me` | — | Current user (Bearer or cookie). Includes `orders_count`, `total_spent`, `phone_verified`, `telegram_user_id`, and the designer fields `is_designer`, `designer_handle`, `designer_bio`. |
| PATCH | `/api/auth/profile` | `{ name?, phone?, location_preset? }` | Update profile; `location_preset` is `{ address, lat?, lng? }` or `null` |
| POST | `/api/auth/avatar` | multipart `avatar` | Upload avatar (PNG/JPG/WebP ≤ 2 MB) |
| DELETE | `/api/auth/account` | — | Delete the account: personal fields anonymised, identities and cart removed, pending artwork withdrawn. Orders stay as anonymised records. The user's JWTs stop working immediately (`code: account_deleted`). |

### Social sign-in (Google / Discord / Facebook)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/oauth/providers?platform=android\|ios\|web` | Providers with credentials on the Worker, with the client id for that platform |
| POST | `/api/auth/oauth/:provider` | `{ code, redirect_uri, code_verifier?, platform }` — exchange the PKCE code, returns `{ token, user }` |

---

## Auth (Phone / Telegram)

### Flow

1. `POST /api/auth/telegram/start` → receive `session_id` + `telegram_deep_link`
2. Open deep link, user sends `/start <session_id>` in Telegram
3. Bot asks user to share phone number
4. User taps "Share" → contact update sent to webhook
5. Poll `GET /api/auth/telegram/status?session_id=…` every 2 s
6. When `status === "verified"`, `user_token` httpOnly cookie is set automatically

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/telegram/start` | `{ phone }` | Start auth session. Phone must be E.164 (`+998…`). Returns `{ session_id, telegram_deep_link, expires_at }` |
| GET | `/api/auth/telegram/status` | `?session_id=…` | Poll status. Returns `{ status }` where status is `pending\|verified\|failed\|expired`. Sets `user_token` cookie on `verified`. |
| POST | `/api/auth/logout` | Bearer or cookie | Clear `user_token` cookie and sign the account out on every device |

### Telegram Mini App

The storefront doubles as a Telegram Mini App: the bot's menu button opens
loomdesign.uz inside Telegram's WebView with signed `initData`, and
`assets/tma.js` logs the visitor in without a password or SMS.

**Flow (linked account):** Mini App posts `initData` → HMAC signature checked
against the bot token → user looked up by `telegram_user_id` → instant login.

**Flow (first visit):** same call returns `need_contact` + a `session_id`
(an `auth_sessions` row with `purpose='webapp'` and no phone yet). The Mini
App shows Telegram's native "share phone" popup (`requestContact`); the shared
contact arrives on the bot webhook, which fills in the phone, upserts the user
and verifies the session. The Mini App polls `/api/auth/telegram/status` like
the classic flow.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/telegram/webapp` | `{ init_data }` | Validate Mini App `initData` (24 h max age). Returns `{ status: "ok", token }` + `user_token` cookie for linked users, `{ status: "need_contact", session_id, expires_at }` otherwise. `401` on bad signature, `403` for banned accounts. |

The token is returned **in the body** as well as the cookie because in
Telegram-Web the Mini App runs in an iframe on web.telegram.org, where the
`SameSite=Lax` cookie is third-party and never sent — the frontend stores it
as a Bearer token (`LOOM_AUTH.setToken`). For the same reason
`/api/auth/telegram/status` also returns `token` when the session's purpose
is `webapp`.

**Security controls on this flow** (each has a regression test; removing any one
of the first two re-opens a confirmed account-takeover):

- A `purpose='webapp'` session is bound to its Telegram user at creation and can
  never be rebound: `/start` refuses webapp sessions and sessions that already
  have a `telegram_user_id`, and `setAuthSessionTelegramUser` only updates rows
  where it `IS NULL`. Without this, an attacker could forward their own
  `t.me/<bot>?start=<session_id>` link and have the victim who taps it verify the
  attacker's session with their own contact.
- Onboarding never takes over an account owned by another Telegram user
  (`upsertTelegramWebappUser` matches on `telegram_user_id`, or on a phone whose
  row is unlinked). `users.phone` is user-editable and unverified, so matching on
  phone alone would let it be squatted.
- The body token is single-use: the first `verified` poll marks the session
  `used`, so a leaked `session_id` is not a 30-day bearer-token dispenser.
- The contact webhook prefers a pending website login/reset session whose phone
  matches the shared contact, so a Mini App session opened on a later page load
  cannot swallow the login the user is actively polling.

**Setup (one-shot):** `BOT_TOKEN=<token> npm run set-menu-button` points the
bot's menu button at the Mini App URL (`APP_URL`, default
`https://loomdesign.uz`). Optionally also create a named app via BotFather
(`/newapp`) to get a shareable `t.me/<bot>/<name>` direct link.

### Telegram Webhook

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/telegram/webhook` | Telegram bot webhook. Requires `X-Telegram-Bot-Api-Secret-Token` header. Handles `/start <session_id>` + shared contacts for both the classic login flow and Mini App onboarding (`purpose='webapp'`). |

---

## LOOM Lab (customer)

> **Status: contract.** None of these routes exist on the Worker yet. They
> return `404` until LOOM-254 ships status, generate and history, and LOOM-255
> ships report and `prompt_refused`. The app (LOOM-250) and the Worker build
> against this section. If the implementation must change it, change this
> section in the same PR.

A customer describes a print in words. The Worker draws it with an AI model,
removes the background and returns a few variants that the customer can put on
a garment.

**Set by the founder in LOOM-254, not here:** the per-customer daily limit
(`limit`), the number of variants per run, the model, and the server wait limit
behind `timeout` (60 s unless the founder changes it). The examples use a limit
of 5 and 4 variants. The app must render any variant count from 1 to 4.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/lab/status` | optional | Server switch, sign-in state and today's quota |
| POST | `/api/lab/generate` | Bearer | `{ prompt, style }` — one run; returns its variants |
| GET | `/api/lab/history` | Bearer | The caller's successful runs, newest first |
| POST | `/api/lab/report` | Bearer | `{ runId, variant, reason? }` — report one variant |

"Bearer" means `Authorization: Bearer <token>` or the `user_token` cookie, as
for `/api/me/orders`. Times are epoch ms (UTC), as in the rest of the API.

### Daily limit

- A customer can complete `limit` runs per day. The day resets at 00:00 UTC
  (05:00 in Tashkent). `resetsAt` is that instant; the app shows it in local time
  and relies only on `resetsAt`, so LOOM-254 can move the reset.
- A run counts once when `POST /api/lab/generate` returns `200`, whatever the
  number of variants. "Qayta chizish" (regenerate) is a new run.
- Any other response does not count: every refusal and every failure in the
  error table below. The app labels refused and failed runs "Limitdan
  hisoblanmadi" (not counted).
- If the app stops waiting (Cancel on the generating screen, or a lost
  connection), the Worker still finishes the run. A run that succeeds counts
  and appears in `GET /api/lab/history`.
- `lab_global_cap` is the shared daily AI budget of all customers
  (`DAILY_NEURON_CAP`, `DAILY_USD_CAP` in `src/lib/ai-models.ts`). It is
  separate from the customer's own limit and resets at the same time.

### GET /api/lab/status

Auth optional. A missing or invalid token means signed out; this route never
returns `401`.

```json
{ "enabled": true, "signedIn": true, "remainingToday": 3, "limit": 5, "resetsAt": 1792540800000 }
```

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | boolean | The caller can generate now. `false` while the Worker var `LAB_ENABLED` is off; accounts the founder allows for testing still get `true`. |
| `signedIn` | boolean | A valid user token came with the request. |
| `remainingToday` | integer \| null | Runs left today, `0` … `limit`. `null` when signed out. |
| `limit` | integer | Runs per customer per day. |
| `resetsAt` | integer | Epoch ms of the next reset (00:00 UTC). |

Signed out: `{ "enabled": true, "signedIn": false, "remainingToday": null, "limit": 5, "resetsAt": 1792540800000 }`.
Switch off: `{ "enabled": false, "signedIn": true, "remainingToday": 5, "limit": 5, "resetsAt": 1792540800000 }`.

The quota chip ("Bugun 3 / 5 bepul") takes `remainingToday` and `limit`; runs
used today = `limit − remainingToday`. With `enabled: false` the app hides
every Lab entry. With `signedIn: false`, "Chizish" opens `/login`.

### POST /api/lab/generate

Auth: Bearer.

```json
{ "prompt": "so‘zana uslubidagi anor naqshi", "style": "minimal" }
```

| Field | Rule |
|-------|------|
| `prompt` | Required string, 1–500 characters after trimming. Any language (uz, ru, en). |
| `style` | Required. One of `minimal` (Minimal chiziq), `uzbek` (O‘zbek naqshi), `street` (Ko‘cha uslubi), `retro` (Retro), `3d` (3D). |

The call is synchronous: the Worker answers when the run is done, at most the
server wait limit later (then `timeout`). Set the app's request timeout above
that limit, for example 90 s. If some images fail but at least one variant is
ready, the run succeeds with fewer variants and counts.

Response `200`:

```json
{
  "runId": "3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42",
  "createdAt": 1792489200000,
  "prompt": "so‘zana uslubidagi anor naqshi",
  "style": "minimal",
  "variants": [
    { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "width": 3500, "height": 4700, "lowQuality": false },
    { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/1.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/1.png", "width": 3500, "height": 4700, "lowQuality": false },
    { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/2.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/2.png", "width": 1024, "height": 1024, "lowQuality": true },
    { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/3.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/3.png", "width": 3500, "height": 4700, "lowQuality": false }
  ],
  "remainingToday": 2,
  "limit": 5,
  "resetsAt": 1792540800000
}
```

| Variant field | Meaning |
|---------------|---------|
| `url` | Absolute URL of the PNG, transparent background. It is `GET /api/uploads/:key`, so it needs the caller's token (React Native: `<Image source={{ uri, headers }}>`). |
| `uploadKey` | The caller's own upload key. Use it wherever a key from `POST /api/uploads` is accepted (studio art, `POST /api/cart`, checkout). "Kiyimga qo‘yish" calls `setArt({ uri: url, uploadKey, price: 0 })`. Treat the value as opaque. |
| `width`, `height` | Pixel size of that PNG. |
| `lowQuality` | `true` when the PNG is below the print-size target (about 3500 × 4700 px for a full front print; LOOM-256 sets it). The variant can still go on a garment; the app shows the "past sifat" badge. Until LOOM-256 ships, expect `true` on most variants. |

A variant is addressed by its 0-based position in `variants`. History returns
the same order.

### GET /api/lab/history

Auth: Bearer. Query `?page=1` (20 runs per page). Lists the caller's runs that
returned `200`, newest first. Refused and failed runs are not listed. This route
does not check `LAB_ENABLED`.

```json
{
  "runs": [
    {
      "runId": "3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42",
      "createdAt": 1792489200000,
      "prompt": "so‘zana uslubidagi anor naqshi",
      "style": "minimal",
      "variants": [
        { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "width": 3500, "height": 4700, "lowQuality": false }
      ]
    },
    {
      "runId": "9b7d1e20-5a43-4c8e-8f61-0e2c4d6a8b13",
      "createdAt": 1792249500000,
      "prompt": "ingichka chiziqlarda Toshkent xaritasi",
      "style": "minimal",
      "variants": [
        { "url": "https://api.loomdesign.uz/api/uploads/lab/9b7d1e20-5a43-4c8e-8f61-0e2c4d6a8b13/0.png", "uploadKey": "lab/9b7d1e20-5a43-4c8e-8f61-0e2c4d6a8b13/0.png", "width": 1024, "height": 1024, "lowQuality": true }
      ]
    }
  ],
  "page": 1,
  "hasMore": false
}
```

Each run has the shape of the generate response without `remainingToday`,
`limit` and `resetsAt`. The first example is shortened to one variant. No runs:
`{ "runs": [], "page": 1, "hasMore": false }`.

### POST /api/lab/report

Auth: Bearer. Ships with LOOM-255, which also stores the reports and shows them
in admin.

```json
{ "runId": "3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42", "variant": 2, "reason": "Boshqa brendning logotipi" }
```

| Field | Rule |
|-------|------|
| `runId` | Required. A run of the caller. |
| `variant` | Required integer, the 0-based position in that run's `variants`. |
| `reason` | Optional string, at most 500 characters. |

Response `201`: `{ "ok": true }`. Reporting the same variant again also returns
`{ "ok": true }`. A report never changes `remainingToday`. This route does not
check `LAB_ENABLED`.

### Errors

Every Lab error has the body `{ error, code }` plus the extra fields in the
table. `code` is stable; the app maps it to its own uz / ru / en copy. `error`
is English text for logs, not for display.

```json
{ "error": "Daily Lab limit reached", "code": "lab_limit_reached", "limit": 5, "remainingToday": 0, "resetsAt": 1792540800000 }
```

```json
{ "error": "Prompt refused", "code": "prompt_refused" }
```

| Code | HTTP | Route | Extra fields | Counted | App screen |
|------|------|-------|--------------|---------|------------|
| `invalid_request` | 400 | generate, report | — | no | inline message (bad `prompt`, `style`, `variant` or `reason`) |
| `sign_in_required` | 401 | generate, history, report | — | no | `/login` |
| `not_found` | 404 | report | — | no | error toast; the variant stays |
| `prompt_refused` | 422 | generate | — | no | W28 Refused |
| `lab_limit_reached` | 429 | generate | `limit`, `remainingToday` (`0`), `resetsAt` | no | W27 Limit, reset time in local time |
| `lab_global_cap` | 429 | generate | `resetsAt` | no | no artboard yet; W27 layout with its own copy |
| `generation_failed` | 502 | generate | — | no | W29 Failed, retry |
| `cutout_failed` | 502 | generate | — | no | W29 Failed, retry |
| `lab_disabled` | 503 | generate | — | no | hide the Lab |
| `timeout` | 504 | generate | — | no | W29 Failed, retry |

- `generate` checks in this order: sign-in, `LAB_ENABLED`, request body, the
  customer's limit, the global cap, the prompt policy, then the image model.
  A refusal at any earlier step calls no image model.
- On generate, history and report a missing or invalid token gives
  `sign_in_required`. The
  account codes of the shared sign-in check (`account_deleted`,
  `session_revoked`, `account_banned`) can still appear. Treat every `401` as
  signed out.
- A `5xx` response without a JSON `code` (for example a gateway `502` page) is
  handled as `generation_failed`. No response at all is the app's offline state.

---

## Admin

All endpoints require `admin_token` cookie (set by `/api/admin/login`).

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/admin/setup` | `{ email, password }` | One-time admin setup |
| POST | `/api/admin/login` | `{ email, password }` | Login, sets `admin_token` cookie |
| POST | `/api/admin/logout` | cookie | Clear cookie and invalidate the admin's issued tokens |
| POST | `/api/admin/refresh` | — | Extend session |
| GET | `/api/admin/me` | — | Current admin info |

### Stats

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/admin/stats` | — | Orders + user stats |

Response includes: `ordersByStatus`, `revenueLast30Days`, `ordersLast7Days`, `topProducts`, `ordersPerDay`, `recentOrders`, `totalUsers`, `newUsersLast7Days`, `newUsersLast30Days`

### Configurator funnel

GET `/api/admin/analytics/funnel` requires an admin session and `analytics.view`.
Optional `from` and `to` are inclusive UTC dates (`YYYY-MM-DD`, at most 366 days);
the default is the last 30 calendar days including today. Invalid dates return
400 with code `funnel_range`. Responses use `Cache-Control: no-store`.

Returns `from`, `to`, `timezone`, `totals: { web, app }`, and zero-filled `daily`
rows with `day`, `platform`, `opens`, `carts`, `checkouts`, `placed`, `orders`.
The first four counts are distinct sessions following the steps in order,
grouped by the session's first open day within the range. `orders` counts
matching server-confirmed orders, excluding cancellations and known test #54.
See [funnel QA and counting contract](scripts/funnel.md).

### Orders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/orders` | List orders (`?status=&q=&page=&limit=`) |
| GET | `/api/admin/orders/:id` | Order detail with status log |
| PATCH | `/api/admin/orders/:id/status` | `{ status, note? }` — update status |
| GET | `/api/admin/media/:key` | Serve uploaded logo (private) |

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/users` | List users (`?q=&role=&status=&page=&limit=`) |
| GET | `/api/admin/users/:id` | User detail with order/spend stats |
| PATCH | `/api/admin/users/:id` | `{ role?, status? }` — ban/unban, promote/demote |
| GET | `/api/admin/users/:id/orders` | User's orders |
| GET | `/api/admin/users/:id/activity` | User activity log |

### Designer artwork moderation

Capabilities: `artworks.view` (read), `artworks.review` (approve / reject). Staff
get `artworks.view` by default; managers and the owner get both.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/artworks` | `?status=pending\|approved\|rejected&page=&limit=` — moderation queue with `image_url`, `author`, `sold`; also returns the global `pending` count |
| POST | `/api/admin/artworks/:id/review` | `{ decision: 'approve' \| 'reject', note? }` — `note` is required for a rejection. Approving publishes the work to `/api/artworks`; either decision notifies the designer in Telegram (if linked) and logs `artwork_approved` / `artwork_rejected` in their activity. |

| GET | `/api/admin/designers/payouts` | Payout ledger: one row per active designer with `works_approved`, `units_sold`, `earned` (non-cancelled), `payable` (delivered orders), `pending` (in progress), `last_sale_at`; plus `totals` and `commission_pct`. |

`GET /api/admin/orders/:id` also returns `designerSales[]` — the marketplace
artwork on that order with the credited designer and their frozen share.

The admin page is `admin/artworks.html` («Каталог → Работы дизайнеров»); the
payout ledger sits below the moderation queue on the same page.

### Products

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/products` | List products (`?active=&q=&page=&limit=`) |
| GET | `/api/admin/products/:id` | Product detail |
| POST | `/api/admin/products` | Create product (multipart/form-data). Returns `{ ok: true, product }` or `{ ok: false, error: { code, message, field? } }` |
| PATCH | `/api/admin/products/:id` | Update product (multipart/form-data) |
| DELETE | `/api/admin/products/:id` | Soft-delete (set active=0) |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/notifications` | Send Telegram message to a user. Body: `{ user_id, message, button_label?, button_url? }` |
| GET | `/api/admin/notifications` | List sent notifications (`?page=&limit=`) |

---

## Error Responses

All error responses use `{ error: string }` shape **except** `POST /api/admin/products` which uses `{ ok: false, error: { code, message, field? } }`, and the LOOM Lab routes (`/api/lab/*`), which always add a stable `code` and sometimes extra fields — see [LOOM Lab → Errors](#errors).

Common HTTP status codes:
- `400` Bad request / validation error
- `401` Unauthorized (missing or invalid auth)
- `403` Forbidden (wrong role)
- `404` Not found
- `409` Conflict (e.g., duplicate slug)
- `422` Unprocessable (e.g., user has no Telegram linked)
- `429` Rate limited
- `500` Internal server error

## Checkout attempts

`POST /api/cart/checkout` is the only order writer; `POST /api/orders` is removed. Send one `Idempotency-Key` (8–128 ASCII letters/digits, `.`, `_`, `:`, `-`) per checkout attempt and reuse it after a timeout. Keys are scoped to the signed-in user. The same key returns the original order even after the cart is cleared. A valid `sessionId` (1–64 ASCII letters/digits, `.`, `_`, `:`, `-`) is required on new orders and stored on the order. The checkout batch records `order_placed` with that session; clients send `cfg_order` only for the place-order click. `platform` is `web` (default) or `app`. Header, items, artwork attribution and removal of the submitted cart rows use one D1 batch. A changed price or cart requires review before an order is created.

Apply migration `0023_atomic_checkout.sql` locally for QA. The founder must apply it before deploying this Worker and coordinate web/app clients, which now supply the required header. Existing order rows are retained.
