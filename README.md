# LOOM — Custom Apparel Design Platform

LOOM is a full-stack e-commerce platform for ordering custom-designed apparel online. Users browse products, customize them in a real-time 3D configurator (adding text and images), then place an order. Admins manage orders, products, and users through a dedicated dashboard.

**Live site:** https://looom.me  
**API:** https://api.looom.me  
**Admin panel:** https://www.looom.me/admin/

---

## Core Features

- **3D Product Configurator** — Real-time Three.js preview with front/back views; add text (custom fonts, size, rotation) and images (PNG, JPEG, SVG) onto the garment
- **Product Catalog** — Dynamic product grid fetched from the API with skeleton loaders
- **Order System** — Full lifecycle: `new → confirmed → producing → shipped → delivered / cancelled`
- **Email/Password Auth** — JWT-based; tokens valid 30 days; PBKDF2 password hashing (100k iterations)
- **Phone/Telegram Auth** — Passwordless login: user taps a bot deep-link, shares their contact, frontend polls for completion
- **User Account** — Order history, profile settings, avatar upload, address + map picker (Nominatim/Yandex Maps)
- **Admin Dashboard** — Revenue, order stats, visitor analytics, pie chart, 30-day trend chart
- **Admin Order Management** — List/filter/paginate orders, update status with notes, view status-change history
- **Admin Product CRUD** — Upload GLB models and thumbnails, manage colors, pricing, visibility
- **Admin User Management** — Search users, ban/unban, promote roles, view activity log, reset password
- **Admin Notifications** — Send Telegram messages to individual users with optional CTA button
- **File Storage** — Cloudflare R2 for 3D models, user-uploaded logos, and avatars
- **Rate Limiting** — Global IP-based via Cloudflare KV (5 orders/min, 10 uploads/min)
- **Visitor Analytics** — Page-level tracking: device type, OS, browser, referrer
- **Dark / Light / System Theme** — Both the admin panel and public site support theme toggle

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| 3D Rendering | Three.js r128 |
| Styling | Tailwind CSS (CDN), custom CSS |
| Backend | [Hono](https://hono.dev/) v4.5 on Cloudflare Workers |
| Language | TypeScript 5.5 |
| Database | Cloudflare D1 (SQLite at the edge) |
| File Storage | Cloudflare R2 |
| Rate Limiting | Cloudflare KV |
| Auth tokens | Jose v5.6 (HS256 JWTs) |
| External API | Telegram Bot API (phone auth + order notifications) |
| Maps | Nominatim (geocoding), Yandex Maps (display) |
| Hosting | GitHub Pages / Cloudflare Pages (frontend), Cloudflare Workers (backend) |
| Deploy tool | Wrangler v3.67 |

---

## Project Structure

```
LOOM/
├── index.html                  # Homepage (hero, carousel, features)
├── catalog.html                # Product browser
├── configurator.html           # 3D design tool
├── login.html                  # User login
├── register.html               # User registration
├── account.html                # User dashboard (orders, settings)
├── styles.css                  # Global public styles
├── configurator.js             # Three.js 3D configurator (2000+ lines)
├── products-catalog.js         # Catalog rendering + API calls
│
├── assets/
│   ├── auth.js                 # Login / register / token management
│   ├── auth.css                # Auth UI styles
│   ├── account.js              # Account page logic
│   ├── config.js               # API_BASE endpoint config
│   ├── login-modal.js          # Inline login modal component
│   ├── map-picker.js           # Map location picker (Nominatim)
│   ├── track.js                # Page analytics tracking
│   └── models/
│       └── t_shirt.glb         # 3D shirt model
│
├── products/                   # Static product images (JPG/PNG)
├── images/                     # Hero and marketing images
│
├── admin/
│   ├── index.html              # Redirects to dashboard
│   ├── login.html              # Admin login
│   ├── dashboard.html          # Stats overview
│   ├── orders.html             # Order list
│   ├── order.html              # Order detail
│   ├── products.html           # Product list
│   ├── product-edit.html       # Create / edit product form
│   ├── users.html              # User list
│   ├── user-detail.html        # User detail
│   ├── notifications.html      # Send Telegram notifications
│   └── assets/
│       ├── app.js              # API client, formatters, auth helpers
│       ├── layout.js           # Sidebar, theme toggle
│       ├── dashboard.js        # Charts and stat cards
│       ├── orders.js           # Order list CRUD
│       ├── order-detail.js     # Order status updates
│       ├── products.js         # Product management
│       ├── product-edit.js     # Product form handling
│       ├── users.js            # User management
│       ├── user-detail.js      # User detail + operations
│       ├── notifications.js    # Notification sending
│       └── admin-map-picker.js # Map picker for admin forms
│
├── backend/
│   ├── package.json
│   ├── wrangler.toml           # Workers / D1 / R2 / KV bindings
│   ├── .dev.vars.example       # Local secret template
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts            # App entry, CORS, route mounting
│   │   ├── types.ts            # Cloudflare binding types
│   │   ├── routes/
│   │   │   ├── public.ts       # Products, orders, uploads
│   │   │   ├── auth.ts         # Email/password auth
│   │   │   ├── telegram-auth.ts# Phone/Telegram auth + webhook
│   │   │   ├── admin.ts        # Admin auth, stats, order mgmt
│   │   │   ├── admin-products.ts
│   │   │   ├── admin-users.ts
│   │   │   ├── user-profile.ts # Profile update, avatar
│   │   │   └── files.ts        # R2 file serving + analytics
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts  # Bearer token validation
│   │   │   └── requireAdmin.ts # Admin cookie validation
│   │   ├── lib/
│   │   │   ├── jwt.ts          # Sign / verify (Jose)
│   │   │   ├── password.ts     # PBKDF2 hash / verify
│   │   │   ├── r2.ts           # R2 upload helpers
│   │   │   ├── telegram.ts     # Telegram message builder
│   │   │   └── rate-limit.ts   # KV rate limiter
│   │   └── db/
│   │       ├── schema.ts       # TypeScript row types
│   │       └── queries.ts      # D1 prepared statements
│   └── migrations/
│       ├── 0001_initial.sql    # Core tables
│       ├── 0002_seed.sql       # Admin seeding
│       ├── 0003_phone_auth.sql # Sessions, activity, notifications
│       ├── 0004_profile_visitors.sql
│       ├── 0004_roles_avatars.sql  # filename conflict with above
│       └── 0005_visitors.sql
│
└── cloudflare-worker/          # Standalone Telegram order-relay worker
    └── src/worker.js
```

---

## Installation

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account with Workers, D1, R2, and KV enabled
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Backend

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars
# Fill in .dev.vars with your secrets (see Environment Variables section)
```

### Frontend

No build step. Edit `assets/config.js` to point at your API:

```js
window.LOOM_CONFIG = {
  API_BASE: 'http://localhost:8787'   // local dev
  // API_BASE: 'https://api.looom.me' // production
}
```

---

## Running the Project

### Backend

```bash
cd backend
npm run dev       # Hono Worker at http://localhost:8787
```

### Apply database migrations (first time)

```bash
# Local D1
npm run migrate:local

# Production D1
npm run migrate:prod

# Migrations 0004+ must be applied manually:
wrangler d1 execute loom-db --local --file migrations/0004_roles_avatars.sql
wrangler d1 execute loom-db --local --file migrations/0005_visitors.sql
```

### Frontend

Serve the root directory with any static HTTP server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

Open `http://localhost:8000`

### Deploy to production

```bash
# Backend
cd backend && npm run deploy    # → api.looom.me

# Frontend
git push origin main            # GitHub Pages / Cloudflare Pages auto-deploys
```

---

## Environment Variables

Set via `backend/.dev.vars` for local dev, or `wrangler secret put` for production.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | 64+ char random string for signing user JWTs (HS256) |
| `TELEGRAM_BOT_TOKEN` | Yes | Token from BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Admin group/channel ID for order notifications |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | 32+ char string; Telegram sends this as a header on webhook calls |
| `BOT_USERNAME` | Yes | Bot username without `@` (set in `wrangler.toml` `[vars]`) |
| `ENVIRONMENT` | Yes | `production` or `development` (controls CORS allowed origins) |

**Set production secrets:**

```bash
cd backend
wrangler secret put JWT_SECRET
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

**Register Telegram webhook:**

```bash
cd backend && npm run set-webhook
```

---

## API Endpoints

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/products` | List all active products |
| `GET` | `/api/products/:slug` | Get single product by slug |
| `POST` | `/api/orders` | Place an order (5/min/IP rate limit) |
| `POST` | `/api/uploads` | Upload a logo to R2 (10/min/IP rate limit) |
| `GET` | `/api/files/models/:key` | Stream file from R2 (GLB, images) |

### User Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create account (email + password) |
| `POST` | `/api/auth/login` | Login, receive JWT |
| `GET` | `/api/auth/me` | Get current user (Bearer token or cookie) |
| `PATCH` | `/api/auth/profile` | Update name, phone, location |
| `PATCH` | `/api/auth/password` | Change password |
| `POST` | `/api/auth/avatar` | Upload avatar image |

### Phone / Telegram Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/telegram/start` | Create auth session, returns bot deep-link |
| `GET` | `/api/auth/telegram/status` | Poll session status |
| `POST` | `/api/auth/logout` | Clear `user_token` cookie |
| `POST` | `/api/telegram/webhook` | Telegram bot webhook (internal use) |

### Admin (require `admin_token` cookie)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/setup` | One-time first-admin creation (no auth required) |
| `POST` | `/api/admin/login` | Admin login |
| `GET` | `/api/admin/stats` | Dashboard statistics |
| `GET` | `/api/admin/orders` | Paginated order list with filters |
| `GET` | `/api/admin/orders/:id` | Order detail + status log |
| `PATCH` | `/api/admin/orders/:id/status` | Update order status |
| `GET` | `/api/admin/products` | Product list |
| `POST` | `/api/admin/products` | Create product (multipart/form-data) |
| `PATCH` | `/api/admin/products/:id` | Update product |
| `DELETE` | `/api/admin/products/:id` | Soft-delete product |
| `GET` | `/api/admin/users` | User list with filters |
| `GET` | `/api/admin/users/:id` | User detail with stats |
| `PATCH` | `/api/admin/users/:id` | Ban, promote, update user |
| `POST` | `/api/admin/notifications` | Send Telegram notification to user |
| `GET` | `/api/admin/notifications` | Notification history |

---

## Database

**Engine:** Cloudflare D1 (SQLite at the edge)  
**Binding name:** `DB`  
**Database name:** `loom-db`

| Table | Purpose |
|---|---|
| `products` | Catalog (slug, name RU/EN, price in UZS, R2 keys, colors JSON) |
| `users` | Registered users (email, PBKDF2 hash, profile, Telegram ID, role, status) |
| `admins` | Admin accounts (separate table from users) |
| `orders` | Orders with full `design_json`, status, address, coordinates |
| `order_status_log` | Immutable audit trail of every status change |
| `auth_sessions` | Telegram phone-auth sessions (UUID, status, JWT, 10-min expiry) |
| `user_sessions` | Login session tracking |
| `user_activity_log` | Per-user event log (login, order placed, banned, etc.) |
| `notifications_sent` | Sent Telegram notifications with status and error details |
| `page_visits` | Visitor analytics (page, device, OS, browser, referrer) |

---

## Deployment

### Backend → Cloudflare Workers

1. Create D1, R2, and KV resources via Cloudflare dashboard or Wrangler
2. Update IDs in `wrangler.toml`
3. Set all secrets with `wrangler secret put`
4. Run `npm run deploy`
5. Run `npm run set-webhook` to register the Telegram webhook

### Frontend → GitHub Pages / Cloudflare Pages

Push to `main`. The static files deploy automatically — no build step required.

---

## Known Issues

- **Migration filename conflict** — `0004_profile_visitors.sql` and `0004_roles_avatars.sql` share the same numeric prefix; both must be applied manually and in the right order
- **`migrate:local` / `migrate:prod` scripts only cover 0001–0003** — migrations 0004 and 0005 must be run manually
- **Single 3D model** — Only `t_shirt.glb` exists; all product types use the same mesh
- **No payment integration** — Orders are confirmed and fulfilled manually; no payment gateway is connected
- **Legacy files** — `google-apps-script.js` and `google-sheets-order-module.js` are unused but present in the repo

---

## Future Improvements

- Distinct 3D GLB models per product type (hoodie, cap, bag, etc.)
- Payment gateway integration (Payme, Click, or Stripe)
- Email notifications for order status changes
- Public order-tracking page (by order ID, no login required)
- Product variant support (size, material)
- English language UI (schema already has `name_en` columns)
- Automated migration runner that handles all files in sequence
- CI/CD pipeline for backend deployments
- Mobile app or PWA
