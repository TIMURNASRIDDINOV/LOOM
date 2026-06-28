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
| GET | `/api/files/models/:key` | Serve GLB/thumbnail (public, immutable cache) |

---

## Auth (Email/Password)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | `{ email, password, name?, phone? }` | Register user, returns `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | Login, returns `{ token, user }` |
| GET | `/api/auth/me` | — | Current user (Bearer or cookie) |

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

### Telegram Webhook

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/telegram/webhook` | Telegram bot webhook. Requires `X-Telegram-Bot-Api-Secret-Token` header. |

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
