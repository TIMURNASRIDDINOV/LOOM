# LOOM Project — Comprehensive Codebase Report

> Generated: 2026-05-08 | Branch: main | Commit: e4e48cc

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Tech Stack](#2-tech-stack)
3. [Frontend Status](#3-frontend-status)
4. [Backend Status](#4-backend-status)
5. [What's Working](#5-whats-working)
6. [What's Broken / Incomplete](#6-whats-broken--incomplete)
7. [Environment & Config](#7-environment--config)
8. [Dependencies](#8-dependencies)
9. [Known Errors](#9-known-errors)

---

## 1. Project Structure

```
LOOM/
├── index.html                         # Homepage — hero section, product carousel
├── catalog.html                       # Browse products dynamically loaded from API
├── configurator.html                  # 3D T-shirt design tool (Three.js)
├── login.html                         # User login page
├── register.html                      # User registration page
├── account.html                       # Authenticated user dashboard & order history
├── tshirt_3d-white_front_001.html     # Standalone 3D preview template
├── styles.css                         # Global stylesheet
├── ProductList.css                    # Product listing styles
├── products-catalog.css               # Catalog page styles
├── configurator.js                    # 3D configurator logic (Three.js, GLTFLoader)
├── products-catalog.js                # Fetches and renders product grid from API
├── google-sheets-order-module.js      # Legacy Google Sheets order integration (unused)
├── google-apps-script.js              # Google Apps Script automation (legacy, unused)
├── CNAME                              # GitHub Pages custom domain: looom.me
├── README.md                          # Project documentation
├── dev.md                             # Development notes
│
├── assets/
│   ├── config.js                      # API base URL config (localhost vs production)
│   ├── auth.js                        # Auth module: login, register, logout, token storage
│   ├── auth.css                       # Auth UI styles
│   ├── account.js                     # Account page logic: user profile, order history
│   └── models/
│       ├── t_shirt.glb                # 3D shirt model (GLB format for Three.js)
│       └── oversized-tshirt.obj       # Alternative 3D model (OBJ format, unused in UI)
│
├── admin/
│   ├── index.html                     # Admin redirect / entry point
│   ├── login.html                     # Admin login page
│   ├── dashboard.html                 # Stats: total orders, revenue, status breakdown
│   ├── products.html                  # Product list with search/filter
│   ├── product-edit.html              # Create / edit product form
│   ├── orders.html                    # Order list with pagination and status filter
│   ├── order.html                     # Order detail + status update form
│   └── assets/
│       ├── app.js                     # API client, auth helpers, formatters
│       ├── layout.js                  # Sidebar navigation & layout
│       ├── dashboard.js               # Stats fetching and display
│       ├── products.js                # Product CRUD operations
│       ├── product-edit.js            # Product form: create & PATCH
│       ├── orders.js                  # Order list with filtering
│       └── order-detail.js            # Order detail, status log, update form
│
├── backend/                           # Hono API on Cloudflare Workers
│   ├── package.json
│   ├── wrangler.toml                  # Workers config: D1, R2 bindings
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   # App entry: CORS, route mounting, error handler
│   │   ├── types.ts                   # TypeScript env bindings
│   │   ├── routes/
│   │   │   ├── auth.ts                # POST /register, POST /login, GET /me
│   │   │   ├── public.ts              # GET /products, POST /orders, POST /uploads
│   │   │   ├── admin.ts               # Admin login, logout, orders CRUD
│   │   │   └── admin-products.ts      # Admin product CRUD with R2 uploads
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts         # Bearer token validation for users
│   │   │   └── requireAdmin.ts        # Cookie-based admin auth
│   │   ├── lib/
│   │   │   ├── jwt.ts                 # HS256 JWT sign/verify via jose
│   │   │   ├── password.ts            # PBKDF2 password hashing (100k iterations)
│   │   │   ├── r2.ts                  # R2 upload validation helpers
│   │   │   └── telegram.ts            # Telegram order notification builder
│   │   └── db/
│   │       ├── schema.ts              # TypeScript types for DB rows
│   │       └── queries.ts             # D1 prepared statement query functions
│   └── migrations/
│       ├── 0001_initial.sql           # Schema creation: products, users, admins, orders
│       └── 0002_seed.sql              # Initial admin seed with placeholder password
│
├── cloudflare-worker/                 # Separate Telegram notification worker
│   ├── package.json
│   ├── wrangler.jsonc                 # Worker config: production & staging envs
│   └── src/
│       └── worker.js                  # Order → Telegram relay worker
│
├── products/                          # Product photography
│   └── *.jpg                          # 9 product images (different styles/colors)
│
├── images/
│   ├── backgroundphoto.jpg            # Homepage hero background
│   └── tshirtgif.mp4                  # Product showcase video
│
├── configuratorprodutcs/
│   └── tshirt_basic2d_white_001.png   # 2D shirt template for design canvas
│
└── .vscode/
    └── settings.json                  # VS Code workspace settings
```

**Lines of code:** HTML ~4,607 | JavaScript ~5,070 | TypeScript ~1,619

---

## 2. Tech Stack

### Backend

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Cloudflare Workers | — |
| Framework | Hono | ^4.5.0 |
| Language | TypeScript | ^5.5.0 |
| Database | Cloudflare D1 (SQLite) | — |
| Object Storage | Cloudflare R2 | — |
| JWT | jose | ^5.6.3 |
| Deploy Tool | Wrangler | ^3.67.0 |
| Types | @cloudflare/workers-types | ^4.20240718.0 |

### Frontend

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | Vanilla JS (ES2020) | No build step |
| 3D Engine | Three.js | r128, CDN |
| Styling | Tailwind CSS | CDN |
| Fonts | Google Fonts | CDN |
| Hosting | GitHub Pages | Custom domain via CNAME |

### External Services

| Service | Purpose |
|---------|---------|
| Cloudflare D1 | Relational database (SQLite) |
| Cloudflare R2 | File storage: 3D models, thumbnails, user logos |
| Telegram Bot API | Order notifications |
| GitHub Pages | Frontend hosting |

---

## 3. Frontend Status

### Pages

| Page | File | Status | Notes |
|------|------|--------|-------|
| Homepage | `index.html` | ✅ Complete | Product carousel, hero, CTA |
| Catalog | `catalog.html` | ✅ Complete | Dynamic loading, error/retry state |
| 3D Configurator | `configurator.html` | ✅ Complete | Text, image, color, size selection |
| Login | `login.html` | ✅ Complete | JWT auth, redirect |
| Register | `register.html` | ✅ Complete | Validation, auto-login |
| Account | `account.html` | ✅ Complete | Profile, order history |
| Admin Login | `admin/login.html` | ✅ Complete | Cookie-based admin auth |
| Admin Dashboard | `admin/dashboard.html` | ✅ Complete | Stats: revenue, orders, statuses |
| Admin Products | `admin/products.html` | ✅ Complete | Search, filter, create |
| Admin Product Edit | `admin/product-edit.html` | ✅ Complete | GLB/thumbnail upload, color picker |
| Admin Orders | `admin/orders.html` | ✅ Complete | Status filter, pagination, search |
| Admin Order Detail | `admin/order.html` | ✅ Complete | Status log, update form, logo view |

### Auth Module (`assets/auth.js`)

| Feature | Status |
|---------|--------|
| Register | ✅ Working |
| Login | ✅ Working |
| Logout | ✅ Working |
| Token storage (localStorage) | ✅ Working |
| User profile caching (sessionStorage) | ✅ Working |
| Auth nav dropdown rendering | ✅ Working |
| Auto-redirect on 401 | ✅ Working |

### 3D Configurator (`configurator.js`)

| Feature | Status | Notes |
|---------|--------|-------|
| Load 3D GLB model | ✅ Working | From `assets/models/t_shirt.glb` |
| Shirt color change | ✅ Working | White/Black |
| Add/edit text layer | ✅ Working | Font, size, color, bold, italic |
| Add/edit image/logo | ✅ Working | PNG/JPEG/SVG, up to 5 MB |
| Front/back switching | ✅ Working | Camera + canvas switch |
| Size selection | ✅ Working | S, M, L, XL, XXL |
| Upload logo to R2 | ✅ Working | POST /api/uploads |
| Submit order | ✅ Working | POST /api/orders |
| Telegram notification | ✅ Working | Via separate Worker |
| No error handler on 3D model load | ⚠️ Missing | No `.catch()` on GLTFLoader |

---

## 4. Backend Status

### All API Endpoints

#### Public Routes (`/api`)

| Method | Path | Auth | Status | Notes |
|--------|------|------|--------|-------|
| GET | `/` | None | ✅ | Health check |
| GET | `/api/products` | None | ✅ | Returns all active products |
| GET | `/api/products/:slug` | None | ✅ | Single product by slug |
| POST | `/api/orders` | Optional Bearer | ✅ | Creates order, sends Telegram |
| POST | `/api/uploads` | None | ✅ | Upload logo to R2 (5 MB max) |
| GET | `/api/me/orders` | Required Bearer | ✅ | User's own order history |

#### Auth Routes (`/api/auth`)

| Method | Path | Auth | Status | Notes |
|--------|------|------|--------|-------|
| POST | `/api/auth/register` | None | ✅ | Email+pass, returns JWT |
| POST | `/api/auth/login` | None | ✅ | Returns JWT (30d expiry) |
| GET | `/api/auth/me` | Required Bearer | ✅ | Returns user profile |

#### Admin Routes (`/api/admin`)

| Method | Path | Auth | Status | Notes |
|--------|------|------|--------|-------|
| POST | `/api/admin/setup` | None | ✅ | One-time admin password setup |
| POST | `/api/admin/login` | None | ✅ | Sets httpOnly cookie (12h) |
| POST | `/api/admin/logout` | None | ✅ | Deletes admin cookie |
| GET | `/api/admin/me` | Admin cookie | ✅ | Returns admin profile |
| POST | `/api/admin/refresh` | Admin cookie | ✅ | Extends session 12h |
| GET | `/api/admin/stats` | Admin cookie | ✅ | Revenue + order counts |
| GET | `/api/admin/orders` | Admin cookie | ✅ | Paginated, filterable list |
| GET | `/api/admin/orders/:id` | Admin cookie | ✅ | Order + status log |
| PATCH | `/api/admin/orders/:id/status` | Admin cookie | ✅ | Update status + note |
| GET | `/api/admin/media/:key` | Admin cookie | ✅ | Serve R2 uploads to admin |
| GET | `/api/admin/products` | Admin cookie | ✅ | Paginated product list |
| GET | `/api/admin/products/:id` | Admin cookie | ✅ | Single product |
| POST | `/api/admin/products` | Admin cookie | ✅ | Create product + upload GLB/thumbnail |
| PATCH | `/api/admin/products/:id` | Admin cookie | ✅ | Update product fields |
| DELETE | `/api/admin/products/:id` | Admin cookie | ✅ | Soft delete (active=0) |

#### File Routes (`/api/files`)

| Method | Path | Auth | Status | Notes |
|--------|------|------|--------|-------|
| GET | `/api/files/models/:key` | None | ✅ | Serve 3D models from R2 (public cache) |

### Database Schema

```sql
-- Products table
CREATE TABLE products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT UNIQUE NOT NULL,
  name_ru        TEXT NOT NULL,
  name_en        TEXT,
  description_ru TEXT,
  price          INTEGER NOT NULL,        -- in UZS
  glb_key        TEXT,                    -- R2 key in loom-models
  thumbnail_key  TEXT,
  base_colors    TEXT,                    -- JSON: ["#FFFFFF","#1F2937"]
  active         INTEGER NOT NULL DEFAULT 1,
  display_order  INTEGER DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Users table
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- pbkdf2$iterations$salt$hash
  name          TEXT,
  phone         TEXT,
  created_at    INTEGER NOT NULL
);

-- Admins table
CREATE TABLE admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Orders table
CREATE TABLE orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER REFERENCES users(id),     -- NULL for anonymous
  product_id     INTEGER REFERENCES products(id),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  address        TEXT,
  coordinates    TEXT,                             -- "lat,lng" or NULL
  comment        TEXT,
  design_json    TEXT NOT NULL,                    -- full designState as JSON
  logo_key       TEXT,                             -- R2 key
  total_price    INTEGER NOT NULL,                 -- in UZS
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- Status log
CREATE TABLE order_status_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by INTEGER REFERENCES admins(id),
  changed_at INTEGER NOT NULL,
  note       TEXT
);
```

**Order statuses:** `new` → `confirmed` → `producing` → `shipped` → `delivered` | `cancelled`

### Middleware

| Middleware | File | Method | Used On |
|-----------|------|--------|---------|
| `requireAuth` | `middleware/requireAuth.ts` | Bearer token (Authorization header) | `/api/me/orders`, `/api/auth/me` |
| `requireAdmin` | `middleware/requireAdmin.ts` | httpOnly cookie `admin_token` | All `/api/admin/*` routes |
| CORS | `index.ts` (Hono built-in) | Origin allowlist | All routes |

### Security Implementation

| Feature | Implementation |
|---------|---------------|
| Password hashing | PBKDF2-SHA256, 100k iterations, 16-byte salt |
| Timing-safe comparison | XOR-based byte comparison |
| JWT | HS256 via jose, 30d users / 12h admins |
| Admin sessions | httpOnly, secure, sameSite=Lax cookies |
| Input validation | Email regex, password length, slug format, file type/size |

---

## 5. What's Working

- **End-to-end order flow:** Customer opens catalog → configures 3D shirt → uploads logo → submits order → admin receives Telegram notification → admin updates status
- **3D configurator:** Color change, text/image layers, front/back view, size selection, canvas texture rendering (2048×2048)
- **Product catalog:** Dynamic loading from API, skeleton loaders, error/retry UI
- **User auth:** Register, login, logout, JWT token persistence, profile caching, auth nav dropdown
- **Admin panel:** Full CRUD for products (with GLB/thumbnail upload to R2), order management, status log, media preview
- **File handling:** R2 upload/serve for logos (5 MB), 3D models (20 MB), thumbnails (2 MB) with type validation
- **Telegram notifications:** Non-blocking async notifications on order creation; separate Cloudflare Worker with staging/production environments
- **Security:** Strong PBKDF2 hashing, HS256 JWT, httpOnly admin cookies, CORS origin allowlist
- **Database:** D1 SQLite with indexes on frequently queried columns (status, user_id, created_at)

---

## 6. What's Broken / Incomplete

### Critical

| Issue | Location | Description |
|-------|----------|-------------|
| Placeholder D1 database ID | `backend/wrangler.toml:16` | `database_id = "YOUR_D1_DATABASE_ID"` — deploy will fail without real ID |
| No rate limiting | `backend/src/routes/public.ts:9` | `POST /api/orders` and `POST /api/uploads` have a TODO but no implementation — vulnerable to spam/abuse |

### High Priority

| Issue | Location | Description |
|-------|----------|-------------|
| Hardcoded Telegram Worker URL | `configurator.js:46` | `https://loom-telegram-orders.timurnasriddinov56.workers.dev` is tied to personal account; not environment-configurable |
| No 3D model load error handler | `configurator.js` | `GLTFLoader` has no `.catch()` or `onError` callback — silent failure if model doesn't load |
| No DB query error handling | `backend/src/db/queries.ts` | D1 queries are not wrapped in try/catch; errors bubble to global handler with no context |
| Legacy modules left in repo | `google-sheets-order-module.js`, `google-apps-script.js` | Loaded in some pages; dead code from prior order system |
| `oversized-tshirt.obj` unused | `assets/models/oversized-tshirt.obj` | Referenced nowhere in frontend JS |

### Medium Priority

| Issue | Location | Description |
|-------|----------|-------------|
| No form validation on frontend | `login.html`, `register.html` | Validation only happens server-side; no inline UX feedback |
| No R2 upload retry logic | `configurator.js` | If logo upload fails mid-configurator, order can be submitted with broken `logo_key` |
| `GET /api/uploads` returns key, no URL | `backend/src/routes/public.ts` | Caller must construct URL; no validation that key is actually accessible |
| No pagination on `/api/me/orders` | `backend/src/routes/public.ts` | User with many orders gets all rows in one query |
| Admin setup endpoint always open | `backend/src/routes/admin.ts` | `/api/admin/setup` can be called by anyone; relies solely on DB state check |
| `null` in CORS allowed origins | `backend/src/index.ts:14` | `null` origin allowed (for file:// during dev) — should be removed in production |
| products-catalog.js hardcoded fallback | `products-catalog.js:18` | `http://localhost:8787` fallback despite `assets/config.js` being available |
| account.js hardcoded fallback | `assets/account.js` | Same localhost fallback, not reading from `window.LOOM_CONFIG` consistently |

### Low Priority / Tech Debt

| Issue | Location | Description |
|-------|----------|-------------|
| `tshirt_3d-white_front_001.html` | Root | Appears to be a dev/test file, likely not linked from nav |
| No CSP headers | Backend CORS config | No Content-Security-Policy headers set |
| No audit log for admin product changes | `backend/src/routes/admin-products.ts` | Product edits not logged; only order status is logged |
| `display_order` field unused in frontend | `products-catalog.js` | Products not sorted by `display_order` despite DB field existing |
| Design JSON not validated on submit | `backend/src/routes/public.ts` | `design_json` stored as-is string; no schema validation |
| Timezone hardcoded | `backend/src/lib/telegram.ts:21` | `'Asia/Tashkent'` — fine for now, but not configurable |

---

## 7. Environment & Config

### Backend Secrets (set via `wrangler secret put`)

| Variable | Purpose | Status |
|----------|---------|--------|
| `JWT_SECRET` | HS256 signing key for all tokens | Must be set |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token | Must be set |
| `TELEGRAM_CHAT_ID` | Telegram channel/group ID for notifications | Must be set |

### Backend Bindings (`wrangler.toml`)

| Binding | Type | Value | Status |
|---------|------|-------|--------|
| `DB` | D1Database | `loom-db` | ⚠️ `database_id` is placeholder |
| `LOOM_MODELS` | R2Bucket | `loom-models` | Must exist in account |
| `LOOM_UPLOADS` | R2Bucket | `loom-uploads` | Must exist in account |
| `ENVIRONMENT` | Var | `"production"` | Set |

### Cloudflare Worker (Telegram) Secrets

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token for sending messages |
| `TELEGRAM_CHAT_ID` | Target chat/channel ID |

### Frontend Config

```javascript
// assets/config.js
window.LOOM_CONFIG = {
  API_BASE: (localhost) ? 'http://localhost:8787' : 'https://api.looom.me'
}
```

**Files that read `LOOM_CONFIG.API_BASE`:**
- `configurator.js`
- `products-catalog.js`
- `admin/assets/app.js`
- `assets/account.js` *(partially — has own hardcoded fallback)*

### CORS Allowed Origins

```
https://looom.me
https://www.looom.me
https://admin.looom.me
http://localhost:8787     ← dev only
http://localhost:3000     ← dev only
null                      ← file:// protocol (dev only, SHOULD BE REMOVED in prod)
```

### Missing `.env.example`

No `.env.example` or `.dev.vars.example` file exists. Onboarding a new developer requires reading `wrangler.toml` and `types.ts` to know what secrets to set.

---

## 8. Dependencies

### Backend (`backend/package.json`)

| Package | Version | Used | Notes |
|---------|---------|------|-------|
| `hono` | ^4.5.0 | ✅ Core framework | Up to date |
| `jose` | ^5.6.3 | ✅ JWT sign/verify | Up to date |
| `@cloudflare/workers-types` | ^4.20240718.0 | ✅ Dev types | Could update |
| `typescript` | ^5.5.0 | ✅ Build | Up to date |
| `wrangler` | ^3.67.0 | ✅ Deploy tool | Up to date |

### Cloudflare Worker (`cloudflare-worker/package.json`)

| Package | Version | Used | Notes |
|---------|---------|------|-------|
| `wrangler` | ^3.0.0 | ✅ Deploy tool | Older minor than backend |

### Frontend (CDN, no package.json)

| Library | Version | Loaded Via | Notes |
|---------|---------|-----------|-------|
| Three.js | r128 | CDN | Pinned — not latest (current: r167) |
| GLTFLoader | r128 | CDN | Matches Three.js |
| OrbitControls | r128 | CDN | Matches Three.js |
| Tailwind CSS | v3 | CDN | Play CDN (not for production use) |
| Google Fonts | — | CDN | Montserrat |

**Concerns:**
- **Three.js r128 is significantly outdated** — released 2021, current is r167. Breaking changes in loader paths.
- **Tailwind CDN** (`cdn.tailwindcss.com`) is explicitly marked "not for production" by Tailwind team — should be replaced with a build step or Tailwind CLI output.
- **No lock files** for frontend CDN deps — version could drift if CDN URLs change.

### Unused / Legacy Files

| File | Reason Unused |
|------|--------------|
| `google-sheets-order-module.js` | Replaced by Hono backend; legacy Google Sheets order flow |
| `google-apps-script.js` | Google Apps Script automation; no longer the order pipeline |
| `assets/models/oversized-tshirt.obj` | OBJ format, not loaded anywhere in frontend JS |

---

## 9. Known Errors

### Backend

#### Global error handler — masks all unhandled errors

```typescript
// backend/src/index.ts:54-57
app.onError((err, c) => {
  console.error('Unhandled error:', err.message, err.stack)
  return c.json({ error: 'Internal server error' }, 500)
})
```
Every unhandled exception returns a generic 500. Without structured logging or Sentry, errors in production are only visible in `wrangler tail`.

#### Telegram notification failure — silently ignored

```typescript
// backend/src/lib/telegram.ts:98-101
if (!res.ok) {
  const body = await res.text()
  console.error('Telegram notification failed:', body)
}
```
If Telegram fails (bot banned, chat ID wrong, rate limited), orders are created successfully but admin never receives a notification. No fallback mechanism.

#### JWT verification — all errors return null silently

```typescript
// backend/src/lib/jwt.ts:29-40
} catch {
  return null  // expired, invalid sig, malformed — all treated identically
}
```
No distinction between expired tokens (could suggest refresh) and invalid/tampered tokens (should trigger security alert).

#### D1 queries — no error wrapping

```typescript
// backend/src/db/queries.ts
// All queries use .prepare().bind().first()/.all() with no try/catch
// A DB failure propagates to onError() with no query context in the log
```

### Frontend

#### Missing Three.js load error handler

```javascript
// configurator.js — GLTFLoader call has no onError callback
loader.load(modelUrl, (gltf) => { ... })
// If model fails to load: silent failure, blank 3D canvas, no user feedback
```

#### Unhandled promise in logo upload flow

If `POST /api/uploads` fails during the configurator flow, the order submission continues with an empty or stale `logo_key`. No explicit check that upload succeeded before proceeding to submit.

#### Silent catch in auth module

```javascript
// assets/auth.js:14
try { return JSON.parse(cached) } catch {}
// assets/auth.js:38-41
} catch { return null }
```
Auth failures are swallowed and return `null`; callers that don't check for `null` will proceed unauthenticated silently.

#### Admin panel `fetch` without error boundary

```javascript
// admin/assets/app.js:19-23
async function apiJSON(path, options = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status })
  return data
}
```
Error is thrown but not all callers wrap in try/catch. An uncaught rejection in a page's `init()` will silently leave the page empty.

### Cloudflare Worker (Telegram)

#### Generic catch swallows error type

```javascript
// cloudflare-worker/src/worker.js:322-334
catch (error) {
  console.error("Error:", error);
  return new Response(JSON.stringify({ success: false, error: error.message || "Internal error" }), { status: 500 })
}
```
All errors map to 500. If the backend's `waitUntil` fires this Worker and it fails, the order notification is lost with no retry.

---

## Summary

LOOM is a production-grade custom apparel design platform with a clean architecture. The core end-to-end flow (browse → design → order → admin notification → status update) is fully functional. The main gaps before a robust production launch are:

| Priority | Item |
|----------|------|
| 🔴 Critical | Fill in real `database_id` in `wrangler.toml` |
| 🔴 Critical | Implement rate limiting on `/api/orders` and `/api/uploads` |
| 🟠 High | Add error handler to GLTFLoader in `configurator.js` |
| 🟠 High | Replace hardcoded Telegram Worker URL with env-driven config |
| 🟠 High | Remove `null` from CORS allowed origins in production |
| 🟡 Medium | Add `.dev.vars.example` for developer onboarding |
| 🟡 Medium | Replace Tailwind CDN with a build-time CSS output |
| 🟡 Medium | Update Three.js from r128 to current (r167) |
| 🟡 Medium | Remove legacy `google-sheets-order-module.js` and `google-apps-script.js` |
