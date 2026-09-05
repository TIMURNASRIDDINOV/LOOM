# LOOM — Technical Overview

*Engineering companion to the [README](README.md). Written to give a technical reviewer — or an accelerator's technical due-diligence — a clear picture of how LOOM is built, why the architecture is lean and scalable, and where the engineering is headed.*

---

## TL;DR for Reviewers

- **Full-stack TypeScript product, already deployed end-to-end** — storefront, real-time 3D configurator, dual authentication, complete order system, and an admin back office.
- **Runs entirely on Cloudflare's global edge** (Workers + D1 + R2 + KV). **No origin servers, no idle cost, global by default.**
- **Built and shipped by a solo lead developer in ~10 months (~96 commits)** — strong evidence of capital-efficient execution.
- **Scales without a rewrite** — the same serverless architecture serves the first customer and the hundred-thousandth.

---

## Development Stage

**Launch-ready MVP.**

Every primary flow works end-to-end in production: catalog → 3D configurator → order placement → email/Telegram auth → user account → full admin panel. The platform is deployed and operational. The remaining pre-launch work is **commercial** (signing the production partner, integrating a payment gateway) rather than foundational — the core engineering is done.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│   Customer Storefront (static)               │
│   loomdesign.uz                              │
│   Vanilla JS + Three.js + Tailwind           │
│   No build step · globally cached on edge    │
└───────────────────┬──────────────────────────┘
                    │ fetch() + CORS
┌───────────────────▼──────────────────────────┐
│   API (Cloudflare Worker)                    │
│   api.loomdesign.uz · Hono + TypeScript      │
│                                              │
│   ├─ D1   — SQLite database at the edge       │
│   ├─ R2   — 3D models, logos, avatars         │
│   ├─ KV   — rate limiting counters            │
│   └─ Telegram Bot API — auth + notifications  │
└───────────────────┬──────────────────────────┘
                    │
┌───────────────────▼──────────────────────────┐
│   Admin Back Office (static SPA)             │
│   loomdesign.uz/admin/                       │
│   Cookie-authenticated · separate bundle     │
└──────────────────────────────────────────────┘
```

**Key data flows**
- **Authenticated user requests** → `Authorization: Bearer <JWT>` (email/password) *or* `user_token` httpOnly cookie (Telegram).
- **Admin requests** → `admin_token` httpOnly cookie, validated by middleware.
- **Telegram bot** → webhook `POST /api/telegram/webhook`, verified by a secret header.
- **File serving** → the Worker streams R2 objects with long-lived immutable cache headers.
- **Rate limiting** → KV counters keyed per IP, enforced globally across edge isolates.

---

## Why This Architecture Wins

These are the technical points worth making in a pitch:

| Property | Why it matters commercially |
|---|---|
| **Edge-native, serverless** | No servers to provision or pay for at idle. Fixed infrastructure cost at launch is effectively **zero**; cost grows only with real usage. |
| **Globally distributed by default** | Code and database run in 300+ Cloudflare locations. Low latency for every user with no extra engineering. |
| **Scales without a rewrite** | The same Workers + D1 + R2 + KV stack handles the first order and a six-figure order volume. No "we'll re-architect when we grow" risk. |
| **No DevOps overhead** | Deploys are a single command; there is no Kubernetes, no servers to patch, no on-call infrastructure. A small team can run the whole platform. |
| **Lean dependency surface** | The backend has **five** production/dev dependencies, all actively used. Less to audit, less to break, faster to onboard a new engineer. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| 3D rendering | Three.js (r128) |
| Styling | Tailwind CSS (CDN) + custom CSS |
| Backend framework | [Hono](https://hono.dev/) v4.5 |
| Language | TypeScript 5.5 |
| Compute | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite at the edge) |
| File storage | Cloudflare R2 |
| Rate limiting | Cloudflare KV |
| Auth tokens | Jose v5.6 (HS256 JWTs) |
| Integrations | Telegram Bot API, Nominatim (geocoding), Yandex Maps |
| Tooling | Wrangler v3.67 |

---

## Repository Layout

```
LOOM/
├── index.html / catalog.html / configurator.html   # storefront pages
├── login.html / register.html / account.html       # auth & account
├── configurator.js          # the 3D design engine (Three.js + Canvas)
├── products-catalog.js      # catalog rendering + API calls
│
├── assets/                  # shared frontend logic
│   ├── auth.js              # login/register + Telegram polling
│   ├── account.js           # account page
│   ├── config.js            # API_BASE endpoint config (only env switch)
│   ├── map-picker.js        # delivery-address map picker
│   └── track.js             # page analytics
│
├── admin/                   # admin back office (static SPA)
│   ├── *.html               # dashboard, orders, products, users, notifications
│   └── assets/*.js          # API client, charts, CRUD logic, theming
│
└── backend/                 # Cloudflare Worker (the API)
    ├── wrangler.toml        # Workers / D1 / R2 / KV bindings
    ├── src/
    │   ├── index.ts         # app entry, CORS, route mounting
    │   ├── routes/          # public, auth, telegram-auth, admin, admin-*
    │   ├── middleware/      # requireAuth, requireAdmin
    │   ├── lib/             # jwt, password, r2, telegram, rate-limit
    │   └── db/              # schema types + prepared-statement queries
    └── migrations/          # versioned SQL schema migrations
```

---

## Data Model

Cloudflare D1 (SQLite at the edge), binding `DB`, database `loom-db`.

| Table | Purpose |
|---|---|
| `products` | Catalog — slug, name (RU/EN), price (UZS), R2 model/image keys, colors |
| `users` | Registered customers — email, PBKDF2 hash, profile, Telegram ID, role, status |
| `admins` | Admin accounts (kept separate from customers) |
| `orders` | Orders with the full `design_json` spec, status, address, coordinates |
| `order_status_log` | Immutable audit trail of every status change |
| `auth_sessions` | Short-lived Telegram phone-auth sessions |
| `user_sessions` | Login session tracking |
| `user_activity_log` | Per-user event log (login, order, role change, …) |
| `notifications_sent` | Telegram notifications with delivery status |
| `page_visits` | Visitor analytics — page, device, OS, browser, referrer |

---

## API Surface

A REST API on a single Worker. Highlights:

**Public** — `GET /api/products`, `GET /api/products/:slug`, `POST /api/orders` (rate-limited), `POST /api/uploads` (rate-limited), `GET /api/files/models/:key`

**User auth** — `POST /api/auth/register`, `/login`, `GET /api/auth/me`, `PATCH /api/auth/profile`, `/password`, `POST /api/auth/avatar`

**Telegram auth** — `POST /api/auth/telegram/start` (returns bot deep-link), `GET /api/auth/telegram/status` (poll), `POST /api/telegram/webhook`

**Admin** (cookie-authenticated) — dashboard stats, paginated orders with filters, order status updates, product CRUD, user management, and Telegram notification sending.

> Full endpoint-by-endpoint reference lives alongside the route modules in `backend/src/routes/`.

---

## Security Posture

Security was designed in, not bolted on:

- **Parameterized queries everywhere** — all D1 access uses prepared statements; no string-concatenated SQL.
- **Strong password hashing** — PBKDF2, 100,000 iterations, per-user random salt.
- **Signed, scoped tokens** — JWTs signed with HS256 and a 64+ character secret; admin sessions use short-lived httpOnly cookies (not reachable from JS).
- **Verified webhooks** — Telegram callbacks are authenticated with a secret header token.
- **Abuse protection** — KV-based rate limiting on order and upload endpoints, enforced globally across edge isolates.
- **Locked-down CORS** — production origins are explicitly allow-listed.
- **Unguessable file keys** — R2 object keys are generated UUIDs.

---

## Performance & Scalability

- **Edge co-location** — Workers and D1 run in the same Cloudflare PoP, so database round-trips stay fast.
- **Aggressive asset caching** — 3D models and images are served from R2 with long-lived immutable cache headers, so each asset is fetched once per client.
- **Stateless compute** — Workers hold no per-instance state, so the platform scales horizontally without sticky sessions or session servers.
- **Lightweight frontend** — no framework runtime and no build step; pages are static and globally cached.

The current architecture comfortably handles launch-scale traffic; the optimization roadmap below covers the steps that keep it smooth as volume grows.

---

## Engineering Roadmap

Planned technical investments, sequenced by launch priority:

**Pre-launch (commercial-critical)**
- **Payment integration** — wire up a local gateway (Payme / Click); add `payment_status` / `payment_id` to `orders`.
- **Production-partner handoff** — structured export/forwarding of the order's `design_json` to the printing partner.

**Post-launch (growth)**
- **Designer marketplace** — accounts, uploads, moderation (`admin/artworks.html`), public listings and per-sale attribution (`artwork_sales`, migration 0018) are live in the mobile app and API; the remaining piece is the **payout rail** (transfer of `designer_share` to designers).
- **Dynamic 3D models** — load each product's own GLB by `glb_key` instead of a shared mesh; add models for hoodies, caps, bags.
- **Product variants** — size and material options across schema, configurator, and order form.
- **Self-service order tracking** — anonymous lookup by order ID + phone; status-change notifications via Telegram/email.

**Scaling & hardening**
- **Asset pipeline** — Draco-compress GLB models to cut configurator load time on mobile.
- **Configurator modularization** — split the 3D engine into ES modules (Three.js setup, canvas/texture, UI, API) for maintainability.
- **Frontend type safety** — introduce a lightweight TypeScript + bundler step for the storefront and admin.
- **CI/CD** — GitHub Actions to deploy the backend automatically on merge.
- **i18n** — wire the existing `name_en` schema fields into a language toggle (RU ↔ EN).

---

## Local Development

### Prerequisites
- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account with Workers, D1, R2, and KV
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Backend
```bash
cd backend
npm install
cp .dev.vars.example .dev.vars      # fill in secrets (see below)
npm run dev                         # Worker at http://localhost:8787
```

### Database migrations
```bash
npm run migrate:local               # base schema (local D1)
npm run migrate:prod                # base schema (production D1)
# Later migrations are applied explicitly by file, e.g.:
wrangler d1 execute loom-db --local --file migrations/0005_visitors.sql
```

### Frontend
No build step — serve the repo root with any static server:
```bash
python3 -m http.server 8000         # → http://localhost:8000
```
Switch environments by editing `API_BASE` in `assets/config.js`.

---

## Environment Variables

Set via `backend/.dev.vars` locally, or `wrangler secret put` in production.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | 64+ char random string for signing user JWTs (HS256) |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Admin group/channel ID for order alerts |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Secret sent by Telegram as a webhook header |
| `BOT_USERNAME` | Yes | Bot username without `@` (set in `wrangler.toml [vars]`) |
| `ENVIRONMENT` | Yes | `production` or `development` (controls CORS) |

```bash
cd backend
wrangler secret put JWT_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run set-webhook                 # register the Telegram webhook
```

---

## Deployment

**Backend → Cloudflare Workers**
1. Create D1, R2, and KV resources (dashboard or Wrangler) and set their IDs in `wrangler.toml`.
2. Set all secrets with `wrangler secret put`.
3. `npm run deploy`
4. `npm run set-webhook` to register the Telegram webhook.

**Frontend → Cloudflare Pages**
Static files deploy on push — no build step. Live at [loomdesign.uz](https://loomdesign.uz); the admin panel is served from `/admin/`.

---

<p align="center"><em>For the product and business story, see the <a href="README.md">README</a>.</em></p>
