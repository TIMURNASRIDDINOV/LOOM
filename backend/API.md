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
| POST | `/api/orders` | Place order (rate-limited 5/min/IP) |
| GET | `/api/me/orders` | User's orders (Bearer or `user_token` cookie) |
| GET | `/api/me/orders/:id` | One of the user's orders (Bearer or `user_token` cookie): `{ order, items[], status_log[] }`. `order` is the row as in the list; `items[]` are its line items (`product_name`, `design_json`, `unit_price`, `quantity`, mockup and print keys); `status_log[]` is `{ old_status, new_status, changed_at, note }` oldest first, epoch ms. An order is logged only when an admin changes its status, so a new order can have an empty log: use `order.created_at` for the `new` step. `401` signed out; `404` when the order does not exist or belongs to someone else (the two are not told apart). |

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
| GET | `/api/files/instagram/:name` | Serve an Instagram post image (`instagram/<uuid>.jpg` in `loom-uploads`; public, immutable). Meta fetches it from this URL at publish time. |
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
removes the background and returns one image that the customer can put on a
garment.

**One run returns exactly one image** (founder decision, 2026-10-20).
`variants` stays an array, but it always has length 1, so the response shape
and the report call `{ runId, variant }` stay stable; `variant` is always `0`.
The server wait limit behind `timeout` is 60 s. The model is set in LOOM-254.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/lab/status` | optional | Server switch, sign-in state and the caller's balance |
| POST | `/api/lab/generate` | Bearer | `{ prompt, style }` — one run; returns its one variant |
| GET | `/api/lab/history` | Bearer | The caller's successful runs, newest first |
| POST | `/api/lab/report` | Bearer | `{ runId, variant, reason? }` — report one variant |

"Bearer" means `Authorization: Bearer <token>` or the `user_token` cookie, as
for `/api/me/orders`. Times are epoch ms (UTC), as in the rest of the API.

### Balance

Founder decision, 2026-10-20.

- Every customer starts with 3 free runs. The balance is for life: it never
  resets and never expires.
- Every order placed from the mobile app adds 5 runs when its status becomes
  `delivered`. Each order adds its bonus once, even if the status leaves
  `delivered` and comes back. Orders placed anywhere else (the website) add
  nothing. LOOM-254 defines how an order is marked as placed from the app.
- A run spends 1 when `POST /api/lab/generate` returns `200`. "Qayta chizish"
  (regenerate) is a new run and spends 1.
- Any other response spends nothing: every refusal and every failure in the
  error table below. The app labels refused and failed runs "Limitdan
  hisoblanmadi" (not counted).
- If the app stops waiting (Cancel on the generating screen, or a lost
  connection), the Worker still finishes the run. A run that succeeds spends 1
  and appears in `GET /api/lab/history`.
- Parallel generate calls never take the balance below 0.
- `lab_global_cap` is the shared daily AI budget of all customers
  (`DAILY_NEURON_CAP`, `DAILY_USD_CAP` in `src/lib/ai-models.ts`). It is
  separate from the customer's balance and spends nothing.

### GET /api/lab/status

Auth optional. A missing or invalid token means signed out; this route never
returns `401`.

```json
{ "enabled": true, "signedIn": true, "remaining": 3 }
```

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | boolean | The caller can generate now. `false` while the Worker var `LAB_ENABLED` is off; accounts the founder allows for testing still get `true`. |
| `signedIn` | boolean | A valid user token came with the request. |
| `remaining` | integer \| null | Runs left in the caller's balance, `0` or more. `null` when signed out. |

Signed out: `{ "enabled": true, "signedIn": false, "remaining": null }`.
Switch off: `{ "enabled": false, "signedIn": true, "remaining": 3 }`.

The quota chip shows `remaining`, the runs left (not the runs used). There is
no upper bound to show. With `enabled: false` the app hides
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
that limit, for example 90 s. If the image or its cutout fails, the run fails
and spends nothing.

Response `200`:

```json
{
  "runId": "3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42",
  "createdAt": 1792489200000,
  "prompt": "so‘zana uslubidagi anor naqshi",
  "style": "minimal",
  "variants": [
    { "url": "https://api.loomdesign.uz/api/uploads/lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "uploadKey": "lab/3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42/0.png", "width": 3500, "height": 4700, "lowQuality": false }
  ],
  "remaining": 2
}
```

| Variant field | Meaning |
|---------------|---------|
| `url` | Absolute URL of the PNG, transparent background. It is `GET /api/uploads/:key`, so it needs the caller's token (React Native: `<Image source={{ uri, headers }}>`). |
| `uploadKey` | The caller's own upload key. Use it wherever a key from `POST /api/uploads` is accepted (studio art, `POST /api/cart`, checkout). "Kiyimga qo‘yish" calls `setArt({ uri: url, uploadKey, price: 0 })`. Treat the value as opaque. |
| `width`, `height` | Pixel size of that PNG. |
| `lowQuality` | `true` when the PNG is below the print-size target (about 3500 × 4700 px for a full front print; LOOM-256 sets it). The variant can still go on a garment; the app shows the "past sifat" badge. Until LOOM-256 ships, expect `true`. |

A variant is addressed by its 0-based position in `variants`, which is always
`0`.

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

Each run has the shape of the generate response without `remaining`. No runs:
`{ "runs": [], "page": 1, "hasMore": false }`.

### POST /api/lab/report

Auth: Bearer. Ships with LOOM-255, which also stores the reports and shows them
in admin.

```json
{ "runId": "3f2c9a4e-6b1d-4f0a-9c55-2d8e7a1b0c42", "variant": 0, "reason": "Boshqa brendning logotipi" }
```

| Field | Rule |
|-------|------|
| `runId` | Required. A run of the caller. |
| `variant` | Required integer, the 0-based position in that run's `variants` (always `0`). |
| `reason` | Optional string, at most 500 characters. |

Response `201`: `{ "ok": true }`. Reporting the same variant again also returns
`{ "ok": true }`. A report never changes `remaining`. This route does not
check `LAB_ENABLED`.

### Errors

Every Lab error has the body `{ error, code }` plus the extra fields in the
table. `code` is stable; the app maps it to its own uz / ru / en copy. `error`
is English text for logs, not for display.

```json
{ "error": "Lab balance used up", "code": "lab_limit_reached", "remaining": 0 }
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
| `lab_limit_reached` | 429 | generate | `remaining` (`0`) | no | W27 Limit: runs used up; place an order in the app, +5 after delivery; links to Catalog and Studio. No reset time. |
| `lab_global_cap` | 429 | generate | — | no | W29 style: try again later, not counted |
| `generation_failed` | 502 | generate | — | no | W29 Failed, retry |
| `cutout_failed` | 502 | generate | — | no | W29 Failed, retry |
| `lab_disabled` | 503 | generate | — | no | hide the Lab |
| `timeout` | 504 | generate | — | no | W29 Failed, retry |

- `generate` checks in this order: sign-in, `LAB_ENABLED`, request body, the
  customer's balance, the global cap, the prompt policy, then the image model.
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

### Instagram posts (PRD-213)

Capabilities: `instagram.edit` (create, edit, upload, reject, back to draft) and
`instagram.approve` (approve, retry, kill switch). The owner has both, the
manager preset has `instagram.edit` only, staff have neither. Nothing here
calls Meta; the publishing cron (LOOM-271) takes only `approved` posts, and
only while `publish_paused` is false.

Statuses: `draft` → `approved` → `publishing` → `published` | `failed`, plus
`rejected`. `publishing` and `published` belong to the cron and are never
edited (409 `ig_locked`). Times are UTC ISO 8601.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/instagram/posts` | `?status=` — newest 200 posts. Each item has `langs` as an array and `caption`, the composed text Instagram gets (uz, blank line, ru, blank line, en; switched-off or empty languages skipped). |
| POST | `/api/admin/instagram/posts` | `{ caption_uz?, caption_ru?, caption_en?, langs?: ['uz','ru','en'], media_key?, publish_at? }` — always created as `draft`, `source = 'manual'`. 201 `{ post }`. |
| PATCH | `/api/admin/instagram/posts/:id` | Same fields, any subset. Changing the content of an `approved` post sends it back to `draft` and clears `approved_by`. 400 `ig_caption_input` / `ig_langs` / `ig_media_key` / `ig_publish_at`. |
| POST | `/api/admin/instagram/posts/:id/approve` | `draft` → `approved`, records `approved_by` / `approved_at`. 422 with `code`: `ig_no_media`, `ig_publish_at_past`, `ig_no_language`, `ig_caption_too_long` (> 2,200 characters composed), `ig_too_many_hashtags` (> 30), `ig_too_many_mentions` (> 20). |
| POST | `/api/admin/instagram/posts/:id/retry` | `failed` → `draft`; resets attempts, error and container id. Needs `instagram.approve`. |
| POST | `/api/admin/instagram/posts/:id/reject` | `draft` / `approved` / `failed` → `rejected`. |
| POST | `/api/admin/instagram/posts/:id/draft` | `approved` / `rejected` → `draft`. |
| POST | `/api/admin/instagram/media` | multipart `file`: JPEG up to 8 MB (by content, not name). Stored as `instagram/<uuid>.jpg`. 201 `{ key, url }`; 413 `ig_media_too_large`; 415 `ig_media_type`. |
| GET | `/api/admin/instagram/settings` | `{ publish_paused, updated_by, updated_at, token_configured, ads_configured, ads_targeting }`. `token_configured` and `ads_configured` are booleans only — tokens never leave the Worker. `ads_targeting` is the stored ad targeting (or `null`), readable before Meta is connected. |
| PUT | `/api/admin/instagram/settings` | `{ publish_paused: boolean }` — the kill switch; defaults to paused after migration 0024. Needs `instagram.approve`. |

A move whose starting status no longer holds answers 409 `ig_bad_status`.

Publishing is the Worker cron (`*/5 * * * *`, `lib/instagram-publish.ts`), not a route. While `publish_paused` is on it makes no Meta request. Otherwise it takes up to 5 `approved` posts with `approved_by` set and `publish_at <= now`, moves each to `publishing`, then sets `published` (`ig_media_id`, `permalink`, `published_at`) or, on a 4xx / `ERROR` / `EXPIRED` / third failed attempt, `failed` with `error` and one Telegram message. 5xx, timeouts and rate limits return the post to `approved` with `attempts + 1`. A token error (code 190) switches `publish_paused` on and leaves the post `approved`.

#### Ads (LOOM-276)

All three need `instagram.approve`. Ads promote a `published` post: campaign → ad set (lifetime budget, targeting from `ads_targeting`, Instagram placements) → ad using the post itself, **every one created with `status: PAUSED`**. Nothing in the code switches an ad on; the owner does that in Ads Manager. Without the Worker secrets `META_AD_ACCOUNT_ID`, `META_ADS_ACCESS_TOKEN`, `META_PAGE_ID` (and `IG_USER_ID`) the ads routes answer 503 `ig_ads_not_configured`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/instagram/ads` | Newest 50 ads: each row plus `status_seen` (Meta's `effective_status`, refreshed on read), `spend_usd` to date, `budget_usd`. `month: { spent_usd, committed_usd, cap_usd, cap_max_usd }`, `targeting`, and `meta_error` when Meta could not be read (rows still listed). |
| POST | `/api/admin/instagram/ads` | `{ post_id, budget_usd, days }` — `budget_usd` ≥ 1 (lifetime), `days` 1–30. 201 `{ ad }`. 423 `ig_ads_paused` while `publish_paused` is on (no Meta call). 422 `ig_ads_over_cap` when this month's spend (Meta insights) + budgets of ads not yet ended + the new budget would exceed the cap (no create call); 422 `ig_ads_currency` unless the ad account is in USD; 409 `ig_ads_post_not_published`. 502 `ig_ads_meta` when a create fails: the row keeps the ids made so far and `error`, everything made stays paused, and one Telegram message is sent. |
| PUT | `/api/admin/instagram/ads/settings` | `{ ads_monthly_cap_usd?, ads_targeting? }`. The cap is 0–60 USD; above 60 is refused (the ceiling is `ADS_CAP_MAX_USD` in `lib/instagram-ads.ts`, a stored value above it still counts as 60). `ads_targeting`: `{ countries: ['UZ'], age_min: 18–65, age_max, genders: [] \| [1] \| [2], interests: [{ id, name }] }`. |

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
