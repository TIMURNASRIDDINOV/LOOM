# DEV.md — LOOM Internal Developer Guide

---

## Current Development Stage

**Beta → Production**

The core product is fully functional and live at https://looom.me. All primary flows work end-to-end: catalog, 3D configurator, order placement, email/phone auth, user account, and the full admin panel. The platform is being actively used. Remaining gaps are around polish, missing product assets (GLB models), payment integration, and a few migration inconsistencies.

---

## Architecture Overview

```
┌──────────────────────────────────────────┐
│   Frontend (Static — GitHub Pages)       │
│   looom.me                               │
│   Vanilla JS + Three.js + Tailwind       │
│   ↓ fetch() calls to API                 │
└──────────────────────────────────────────┘
              ↓ CORS
┌──────────────────────────────────────────┐
│   Backend (Cloudflare Workers)           │
│   api.looom.me                           │
│   Hono v4.5 + TypeScript                 │
│   ↓                                      │
│   ├─ D1 Database (SQLite at the edge)    │
│   ├─ R2 Storage (models + uploads)       │
│   ├─ KV Namespace (rate limiting)        │
│   └─ Telegram Bot API                    │
└──────────────────────────────────────────┘
              ↓ 301 redirect
┌──────────────────────────────────────────┐
│   Admin Panel (SPA — same static host)   │
│   www.looom.me/admin/                    │
│   admin.looom.me → redirects there       │
│   Vanilla JS, separate asset bundle      │
└──────────────────────────────────────────┘
```

**Data flows:**
- Frontend → `Authorization: Bearer <JWT>` for authenticated user requests
- Admin panel → `admin_token` httpOnly cookie for all admin requests
- Telegram bot → webhook POST to `/api/telegram/webhook` (secret header validated)
- File serving → Worker proxies R2 objects through `/api/files/models/:key`
- Rate limiting → KV counters keyed by `orders:<ip>` and `uploads:<ip>`

---

## Completed Work

### Backend
- [x] Hono v4.5 TypeScript Worker on Cloudflare Workers
- [x] D1 database with all 10 tables across 5 migrations
- [x] All prepared statements via `safeQuery()` wrapper (no string concatenation)
- [x] PBKDF2 password hashing (100k iterations, random salt)
- [x] JWT sign/verify (Jose, HS256, 30-day user tokens, 12-hour admin tokens)
- [x] Email/password registration and login
- [x] Phone/Telegram auth flow (session → deep-link → webhook → cookie)
- [x] Telegram webhook with secret token verification
- [x] Admin auth (separate cookie, `requireAdmin` middleware)
- [x] User middleware (`requireAuth` — supports both Bearer and cookie)
- [x] Full product CRUD (admin)
- [x] Full order management (place, list, filter, paginate, status update)
- [x] Order status audit log
- [x] User management (ban, promote, update, activity log)
- [x] Avatar upload to R2
- [x] Logo upload to R2 with validation
- [x] GLB/thumbnail file serving from R2 (1-year immutable cache)
- [x] Telegram notifications to individual users (admin-triggered)
- [x] Dashboard stats: revenue, order counts, top products, recent orders
- [x] Visitor analytics tracking (page, device, OS, browser, referrer)
- [x] KV-based rate limiting (global across Worker isolates)
- [x] CORS: production origins locked down, dev origins included in dev mode
- [x] Admin subdomain redirect (`admin.looom.me` → `www.looom.me/admin/`)
- [x] Uzbek phone number normalization (handles +998, 998, 0998, international)
- [x] One-time admin setup endpoint (`/api/admin/setup`)

### Frontend — Public Site
- [x] Homepage: hero, product carousel (first 3 from API), features section
- [x] Product catalog with API fetch and skeleton loaders
- [x] 3D configurator: Three.js, front/back views, color picker
- [x] Text layer: add, reposition, resize, rotate, font selection
- [x] Image layer: upload PNG/JPEG/SVG, scale, reposition
- [x] Real-time texture generation via Canvas API
- [x] Order form submission with full `design_json`
- [x] Email/password login and registration
- [x] Phone/Telegram login with polling
- [x] User account: order history, profile, address, avatar
- [x] Map picker for delivery address (Nominatim + Yandex Maps)
- [x] JWT stored in localStorage, sent as Bearer token
- [x] Dark / light / system theme toggle

### Frontend — Admin Panel
- [x] Admin login with cookie-based session
- [x] Dashboard: stat cards, revenue chart, order pie chart, visitor breakdown
- [x] Order list: search, filter by status, pagination
- [x] Order detail: customer info, design JSON preview, status update form, history log
- [x] Product list and soft-delete
- [x] Product create/edit: GLB upload, thumbnail, colors, price, display order
- [x] User list: search, filter by role/status
- [x] User detail: activity log, order history, ban/promote/reset password
- [x] Telegram notification sender with button label + URL
- [x] Notification history with sent/failed status
- [x] Sidebar navigation, responsive layout
- [x] Dark / light / system theme (persisted in localStorage)

---

## In Progress / Partially Complete

- **3D model per product** — Only `t_shirt.glb` exists. The product schema supports `glb_key` per product, and the admin panel can upload GLBs, but no other models have been created yet. Non-shirt products will render the shirt mesh.
- **Migration script coverage** — `package.json` scripts (`migrate:local`, `migrate:prod`) only run migrations 0001–0003. Migrations 0004 and 0005 must be applied manually.
- **English language** — Schema has `name_en` column. The API returns it. Frontend does not yet use it; all UI is Russian-only.
- **`cloudflare-worker/`** — A secondary standalone Worker (`worker.js`) for relaying orders to Telegram exists but its relationship to the main backend is unclear. It may be a legacy prototype.

---

## Missing Features

- **Payment gateway** — No payment provider is integrated. Orders are placed and manually confirmed.
- **Order confirmation emails** — No email sending; notifications are Telegram-only.
- **Public order tracking** — Users must log in to see their orders. No anonymous tracking by order ID.
- **Size / material variants** — Products have no variant system; a customer can only pick a color.
- **Product search / filter on catalog page** — The catalog shows all active products in one grid; no search, category, or price filter.
- **Password reset via email** — Admins can reset user passwords from the admin panel, but users have no self-service "forgot password" flow.
- **Automated migration runner** — No tool to detect and apply unapplied migrations in sequence.
- **CI/CD for backend** — Frontend deploys automatically on push; backend requires a manual `npm run deploy`.

---

## Bugs / Technical Debt

### Bugs

1. **Migration prefix conflict** — `0004_profile_visitors.sql` and `0004_roles_avatars.sql` both start with `0004_`. Wrangler's `d1 execute` doesn't glob-run migrations — each must be specified by name — but any tool that auto-discovers by prefix will break. Rename one file to `0004b_` or `0005_` and renumber downstream files.

2. **`migrate:local` / `migrate:prod` scripts are incomplete** — They reference only 0001–0003. Any new developer running `npm run migrate:local` will miss the later schema additions (roles, avatars, visitors tables).

3. **`configurator.js` imports `t_shirt.glb` by hardcoded path** — If a product's `glb_key` is different, the configurator likely still loads the static local file. The 3D model per product is not dynamically loaded based on the selected product.

### Technical Debt

4. **`configurator.js` is ~2000 lines** — Single monolithic file with Three.js setup, Canvas composition, UI event handling, and API calls all mixed together. Refactoring into modules would improve maintainability.

5. **No TypeScript on the frontend** — All public-site and admin JS is plain ES6. There are no type checks, linting, or build tooling for frontend code. Typos in API field names go undetected until runtime.

6. **Legacy unused files** — `google-apps-script.js`, `google-sheets-order-module.js` are present in the repo but referenced nowhere. They suggest an older architecture where orders went to Google Sheets instead of D1.

7. **`wrangler.toml` has `BOT_USERNAME = ""`** — This is a required variable left blank in the config file. It must be set before deployment but there is no validation that catches an empty string at startup.

8. **No input sanitization for `design_json`** — The full design state (including user-supplied text) is stored as raw JSON. The text content is not sanitized before storage or display. Admin-side display should escape HTML when rendering design data.

9. **Admin `setup` endpoint is permanently open** — `POST /api/admin/setup` has no auth requirement by design (first-admin bootstrap), but it is not disabled or rate-limited after the first admin is created. A second call with different credentials would create a second admin account.

10. **`user-profile.ts` route** — This file exists as a separate route module but is not mounted in `index.ts`. Profile update functionality may be duplicated with or missing from `auth.ts`.

11. **`cloudflare-worker/` directory** — Contains a second standalone Worker. Its relationship to the main backend is unclear; it appears to be a legacy Telegram order relay that predates the current architecture. It should be removed or clearly documented.

---

## Important Files

| File | Role |
|---|---|
| `backend/src/index.ts` | App entry point — all routes mounted here, CORS configured |
| `backend/src/routes/public.ts` | Orders, product listing, uploads — the main customer-facing API |
| `backend/src/routes/auth.ts` | Email/password auth: register, login, me, profile, password |
| `backend/src/routes/telegram-auth.ts` | Phone/Telegram auth flow + webhook handler |
| `backend/src/routes/admin.ts` | Admin login, stats, order management |
| `backend/src/routes/admin-products.ts` | Product CRUD with R2 file handling |
| `backend/src/routes/admin-users.ts` | User management, notifications |
| `backend/src/db/queries.ts` | All D1 database queries (prepared statements) |
| `backend/src/lib/jwt.ts` | JWT sign/verify wrapper around Jose |
| `backend/src/lib/password.ts` | PBKDF2 hashing and verification |
| `backend/src/lib/telegram.ts` | Telegram message builder and sender |
| `backend/src/middleware/requireAuth.ts` | User auth middleware (Bearer + cookie) |
| `backend/src/middleware/requireAdmin.ts` | Admin auth middleware (cookie) |
| `backend/wrangler.toml` | All Cloudflare resource bindings |
| `backend/migrations/0001_initial.sql` | Core schema: products, users, admins, orders |
| `backend/migrations/0003_phone_auth.sql` | Auth sessions, activity log, notifications |
| `assets/config.js` | `API_BASE` URL — only change needed to switch environments |
| `configurator.js` | Entire 3D design tool: Three.js + Canvas + order submission |
| `assets/auth.js` | Token storage, login/register calls, Telegram polling |
| `admin/assets/app.js` | Admin API client, auth helpers, formatters (currency, phone) |
| `admin/assets/layout.js` | Sidebar, navigation, theme toggle |
| `admin/assets/dashboard.js` | Dashboard charts (Chart.js) |

---

## Dependencies Audit

### Backend (`backend/package.json`)

| Package | Version | Used | Notes |
|---|---|---|---|
| `hono` | ^4.5.0 | Yes | Core web framework |
| `jose` | ^5.6.3 | Yes | JWT sign/verify |
| `@cloudflare/workers-types` | ^4.20240718.0 | Yes (dev) | TypeScript types for CF bindings |
| `typescript` | ^5.5.0 | Yes (dev) | TypeScript compiler |
| `wrangler` | ^3.67.0 | Yes (dev) | Deploy and local dev |

All backend dependencies are actively used. No bloat.

### Frontend (CDN-loaded, no package.json)

| Library | Source | Used | Notes |
|---|---|---|---|
| Three.js r128 | CDN | Yes | 3D configurator |
| Tailwind CSS | CDN | Yes | Utility classes across all pages |
| Chart.js | CDN | Yes | Admin dashboard charts |
| Nominatim API | Fetch | Yes | Map geocoding |
| Yandex Maps | CDN | Yes (account.html) | Delivery map display |
| Google Fonts | CDN | Yes | Typography |

No unused CDN libraries detected in active pages.

---

## Security Review

### Strengths

- All D1 queries use prepared statements — no SQL injection risk
- PBKDF2 with 100,000 iterations + random salt for passwords
- JWT signed with HS256 and a 64+ char secret
- Admin auth uses httpOnly cookies — not accessible to JS
- Telegram webhook validated via secret header token
- Rate limiting on order and upload endpoints (KV-based, global)
- CORS locked to specific origins in production
- R2 file keys are generated UUIDs — not guessable

### Risks

1. **`/api/admin/setup` is permanently open** — No guard prevents creating additional admin accounts after setup. Add a check: if any admin row exists, return 403.

2. **`design_json` text content not sanitized** — User-supplied text in orders is stored verbatim and displayed in the admin panel. If the admin panel ever renders it as innerHTML (rather than textContent), it is an XSS vector. Audit all admin-side rendering of `design_json` fields.

3. **`BOT_USERNAME` is blank in `wrangler.toml`** — An empty string here could cause Telegram deep-links to be malformed. No startup validation catches this.

4. **Phone numbers stored in plaintext** — `users.phone` is not hashed or masked. If D1 is ever compromised, all phone numbers are exposed. (Low risk in the current architecture, but worth noting.)

5. **No refresh token mechanism** — User JWTs are valid for 30 days with no revocation path. If a token is stolen, it is valid until expiry. Adding a `jti` (JWT ID) column to `user_sessions` and validating it on each request would allow session revocation.

6. **Admin password reset writes new hash directly** — The admin can reset any user's password without requiring the current password. This is intentional for admin use, but there is no audit log entry written for password resets (only for bans and role changes).

---

## Performance Review

### Current State

- **Cloudflare Workers + D1** — Excellent global latency. D1 is co-located with the Worker in the same Cloudflare PoP after the first request.
- **R2 file serving** — Served through the Worker with 1-year `Cache-Control: immutable` headers. Browser caches GLB models after first load.
- **Configurator startup** — Loads the `t_shirt.glb` model on page load. At ~5–15 MB for a GLB file, this is the largest network fetch on the site.
- **Rate limiting** — KV is eventually consistent; under very high burst traffic, a few extra requests may slip through before the counter propagates. Acceptable for this use case.

### Bottlenecks

1. **`t_shirt.glb` size** — If the GLB file is large (>5 MB), configurator initial load is slow on mobile. Compress with `gltf-pipeline` or `draco` compression.

2. **`configurator.js` canvas re-render** — Every text/image drag calls `updateTexture()` which redraws the full canvas. For complex designs with many layers this could drop below 60fps. Debouncing the texture update on drag events would help.

3. **No pagination on `/api/admin/users`** — If the user table grows large, the admin user list query fetches all rows. A `LIMIT/OFFSET` pattern should be added before user count grows beyond a few thousand.

4. **Visitor analytics writes on every page view** — `POST /api/files/track` fires on every page load. With high traffic this generates a large number of small D1 writes. Consider batching or moving to a dedicated analytics service.

---

## Suggested Next Tasks

### 1. Immediate Fixes (do first)

- [ ] **Rename conflicting migration** — Rename `0004_roles_avatars.sql` to `0006_roles_avatars.sql` and update `package.json` scripts to run all migrations 0001–0006 in order
- [ ] **Guard `/api/admin/setup`** — Add a check: if any row exists in `admins`, return 403
- [ ] **Mount `user-profile.ts`** — Verify whether it is mounted in `index.ts`; if not, either mount it or remove it and confirm its logic is covered by `auth.ts`
- [ ] **Fill `BOT_USERNAME` in `wrangler.toml`** — Or add a startup check that panics if it's empty
- [ ] **Remove legacy files** — Delete `google-apps-script.js`, `google-sheets-order-module.js`, and the `cloudflare-worker/` directory (or document it clearly)

### 2. MVP Completion

- [ ] **Payment integration** — Integrate Payme or Click (Uzbek payment rails); store `payment_status` and `payment_id` on the `orders` table
- [ ] **Self-service password reset** — Add `POST /api/auth/forgot-password` that sends a Telegram message with a reset link
- [ ] **Complete migration scripts** — Update `migrate:local` and `migrate:prod` in `package.json` to include all migrations in numbered order
- [ ] **Dynamic GLB loading in configurator** — Read the product's `glb_key` from the URL or page state, fetch it from the API, and load it instead of the hardcoded path
- [ ] **Add 3D models for other product types** — Commission or create GLB files for hoodie, sweatshirt, cap

### 3. Nice-to-Have Improvements

- [ ] **Public order tracking** — `GET /api/orders/:id?phone=...` — no login required, returns status only
- [ ] **Product variants** — Add size and material options to the order form and schema
- [ ] **Catalog search and filter** — Filter by product type, price range on the catalog page
- [ ] **Email notifications** — Order confirmation + status update emails via Cloudflare Email Workers or Resend
- [ ] **English UI** — Wire `name_en` from the API into the frontend with a language toggle
- [ ] **Compress GLB models** — Run `gltf-pipeline -i t_shirt.glb -o t_shirt_draco.glb --draco.compressMeshes` and update the loader
- [ ] **Split `configurator.js`** — Separate Three.js setup, canvas/texture logic, UI events, and API calls into ES modules
- [ ] **Frontend type safety** — Introduce a lightweight TypeScript + esbuild or Vite build step for the frontend
- [ ] **CI/CD for backend** — Add a GitHub Actions workflow that runs `wrangler deploy` on push to `main`

---

## AI Handoff Context

**What this product is:** LOOM is a custom apparel e-commerce platform for the Uzbek market. Users design garments using a 3D configurator, place orders, and track them. Admins manage everything through a separate panel.

**Stack at a glance:** Static HTML/JS/CSS frontend → Hono TypeScript backend on Cloudflare Workers → D1 (SQLite), R2 (files), KV (rate limiting) → Telegram Bot API.

**The frontend has no build step.** All files are served as-is. `assets/config.js` controls which API the frontend talks to. Change `API_BASE` to switch environments.

**The backend is a single Cloudflare Worker** in `backend/`. All routes are in `backend/src/routes/`. Database queries are in `backend/src/db/queries.ts`. Run `npm run dev` in `backend/` to start a local Worker on port 8787.

**Auth has two paths:**
- Email/password: register/login → JWT → stored in localStorage → sent as `Authorization: Bearer <token>`
- Phone/Telegram: session → deep-link → user taps in Telegram → webhook updates session → frontend polls → `user_token` httpOnly cookie set

**Admin auth is separate:** Cookie-based (`admin_token`), validated by `requireAdmin` middleware. Admin accounts live in the `admins` table, not the `users` table.

**The most critical file to understand the product is `backend/src/routes/public.ts`** — it handles product listing, order placement, and file uploads.

**The most complex frontend file is `configurator.js`** — it is ~2000 lines of Three.js + Canvas API. The 3D model is loaded from `assets/models/t_shirt.glb`. The design state (`designState`) is serialized to JSON and sent with the order.

**Known gotchas:**
- Migrations 0004 and 0005 are not included in the `npm run migrate:*` scripts — run them manually
- `0004_profile_visitors.sql` and `0004_roles_avatars.sql` have conflicting numeric prefixes — both must be applied
- `BOT_USERNAME` in `wrangler.toml` is blank and must be filled before deploying
- `user-profile.ts` route may not be mounted in `index.ts` — verify before editing profile-update logic
