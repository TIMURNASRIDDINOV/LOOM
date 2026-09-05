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

### Uploads

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/uploads` | Upload logo/image to R2 (rate-limited 10/min/IP) |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files/models/:key` | Serve GLB/thumbnail (public, immutable cache, `Access-Control-Allow-Origin: *`) |
| GET | `/api/files/artwork/:key` | Serve designer artwork from `loom-uploads` (public, immutable, CORS `*`) |
| GET | `/api/files/avatars/:key` | Serve a user avatar (public, 24 h cache) |
| POST | `/api/files/track` | Funnel analytics event (`session_id`, `page`, `event`, device fields). Allow-listed events only. |

### Designer marketplace

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/artworks` | — | Approved artwork, newest first. Each item carries `image_url`, `image_key` (R2 key for the print shop), `author`, `markup`, `sold`. |
| GET | `/api/designers/:handle` | — | A designer's public page: `handle`, `name`, `bio`, `avatar_url`, `since`, `works[]`, `units_sold`. |
| POST | `/api/designer/apply` | Bearer | `{ handle, bio? }` — opt in as a designer (also edits handle/bio). |
| GET | `/api/designer/artworks` | Bearer | The designer's own works in every moderation state, with `sold` counts. |
| POST | `/api/designer/artworks` | Bearer | `{ title, image_key, tags?, width?, height?, markup }` — submit for moderation. `image_key` comes from `POST /api/uploads`. |
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
| POST | `/api/auth/logout` | — | Clear `user_token` cookie |

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

## Admin

All endpoints require `admin_token` cookie (set by `/api/admin/login`).

### Auth

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/admin/setup` | `{ email, password }` | One-time admin setup |
| POST | `/api/admin/login` | `{ email, password }` | Login, sets `admin_token` cookie |
| POST | `/api/admin/logout` | — | Clear cookie |
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

The admin page is `admin/artworks.html` («Каталог → Работы дизайнеров»).

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

All error responses use `{ error: string }` shape **except** `POST /api/admin/products` which uses `{ ok: false, error: { code, message, field? } }`.

Common HTTP status codes:
- `400` Bad request / validation error
- `401` Unauthorized (missing or invalid auth)
- `403` Forbidden (wrong role)
- `404` Not found
- `409` Conflict (e.g., duplicate slug)
- `422` Unprocessable (e.g., user has no Telegram linked)
- `429` Rate limited
- `500` Internal server error
