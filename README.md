# LOOM — Design It. Wear It.

**LOOM is a 3D custom-apparel platform for Uzbekistan.** Anyone can design a garment in a real-time 3D configurator — add text, upload a logo, pick a color — place the order in minutes, and have it produced and delivered. No design skills, no Photoshop, no minimum order.

> **Status:** Launch-ready MVP — fully built and deployed end-to-end, preparing for first-user launch.
> **Live:** [loomdesign.uz](https://loomdesign.uz) · **Admin:** [loomdesign.uz/admin](https://loomdesign.uz/admin/) · **API:** `api.loomdesign.uz`

---

## The Problem

Ordering custom apparel in Uzbekistan today is **manual, slow, and intimidating**:

- Customers send a logo over Telegram or Instagram, wait for a human to reply, exchange screenshots, and never actually *see* the final product until it's printed.
- There's no self-service way to visualize your design on the real garment before paying.
- Print shops run on chat threads and spreadsheets — no online catalog, no order tracking, no scale.
- Existing global tools (Printful, Custom Ink) don't serve the local market: no UZS pricing, no Telegram login, no local production, no Russian/Uzbek UX.

The result: customization is treated as a one-off favor, not a product. The market is large and underserved, but no one has productized it for the region.

---

## The Solution

LOOM turns custom apparel into a **self-serve digital product**.

1. **Browse** a clean catalog of base garments.
2. **Design** in a live 3D configurator — rotate the garment, add text in custom fonts, upload a logo (PNG/JPEG/SVG), reposition and resize it, change colors, and see exactly what you'll get.
3. **Order** in a few taps — log in with one tap via Telegram (no password), drop a pin on the delivery map, done.
4. **Fulfil** — the order, with the full design spec, lands in an admin dashboard and is routed to a production partner.
5. **Track** — customers follow their order through every status; admins manage everything from one panel.

**The "aha" moment is the 3D preview** — customers design *with confidence* because they see the real product before paying. That single feature converts a hesitant chat inquiry into a finished order.

---

## How LOOM Makes Money

A **hybrid revenue model** that needs zero inventory:

| Stream | How it works |
|---|---|
| **Production margin** | LOOM partners with a printing house. They produce and fulfil; LOOM adds its margin on top of the production price. No upfront inventory, no equipment, no warehouse. |
| **Designer marketplace commission** | Independent designers list their designs on LOOM; when a design sells, LOOM takes a commission. This turns the catalog into a self-growing, community-supplied asset. |

This keeps LOOM **asset-light and high-margin** — we own the demand, the design experience, and the customer relationship, while a partner owns the machines.

---

## Market

- **Primary market:** Uzbekistan — direct-to-consumer (D2C). The product is built for it natively: prices in **UZS**, **one-tap Telegram login** (Telegram is the dominant messaging app locally), Russian-language UI, and integrated local delivery mapping.
- **Why now:** Uzbekistan's e-commerce and online-payment adoption is growing fast, Telegram is ubiquitous, and there is no local, productized custom-apparel experience. LOOM is positioned to define the category.
- **Expansion path:** the same platform extends to B2B/bulk (corporate merch, teams, events) and to the wider Central Asian market with no architectural changes.

---

## Why LOOM Wins

- **Real-time 3D, in the browser** — no app install, no plugins. Most local competitors offer flat mockups or nothing at all.
- **Built for the market, not adapted to it** — Telegram auth, UZS, local maps, RU UI from day one.
- **Asset-light model** — production is outsourced; the marketplace grows the catalog for free.
- **Lean, edge-native tech** — the entire platform runs on serverless edge infrastructure with **near-zero fixed cost** and global scalability built in (see [dev.md](dev.md)). LOOM can serve its first customer and its hundred-thousandth on the same architecture.
- **Already built** — this is not a deck-only idea. The full product — storefront, 3D configurator, dual authentication, payments-ready order system, and a complete admin back office — is live today.

---

## Product (What's Already Built)

A complete, production-deployed platform — not a prototype:

**Customer storefront**
- Real-time **3D product configurator** (Three.js) — text, image, and color customization with live preview
- Dynamic product catalog served from the API
- One-tap **Telegram / phone login** (passwordless) *and* classic email/password
- User account: order history, profile, avatar, saved delivery address with map picker
- Full order lifecycle: `new → confirmed → producing → shipped → delivered`
- Dark / light / system theming

**Admin back office**
- Dashboard with revenue, order stats, and **visitor analytics** (device/OS/browser/30-day trend)
- Order management — filter, paginate, update status, full audit history
- Product management — upload 3D models & images, set colors, pricing, visibility
- User management — search, roles, ban/unban, activity log
- **Telegram notifications** — message customers directly with call-to-action buttons

**Operations**
- Cloudflare R2 file storage for 3D models, logos, and avatars
- IP-based rate limiting, audit logging, and secure dual authentication
- Automatic order alerts to the team via the Telegram Bot API

---

## Technology at a Glance

LOOM runs **entirely on Cloudflare's global edge network** — a deliberate choice that makes the company cheap to run and effortless to scale.

| Layer | Technology |
|---|---|
| Frontend | HTML5 / CSS3 / Vanilla JS, **Three.js** for 3D |
| Backend | **Hono** (TypeScript) on **Cloudflare Workers** |
| Database | **Cloudflare D1** (SQLite at the edge) |
| File storage | **Cloudflare R2** |
| Rate limiting | **Cloudflare KV** |
| Auth | JWT (Jose, HS256) + httpOnly cookies |
| Integrations | **Telegram Bot API**, Nominatim & Yandex Maps |

**Why this matters for an investor:** there are no servers to pay for at idle, no DevOps team to hire, and the platform is globally distributed by default. Fixed infrastructure cost at launch is effectively **zero**, and the architecture scales to high traffic without a rewrite. Full technical deep-dive in **[dev.md](dev.md)**.

---

## Traction & Status

- ✅ **Full platform built and deployed** — storefront, 3D configurator, admin panel, and API are all live.
- ✅ **Solo-built in ~10 months** by the founding team's lead developer (~96 commits), demonstrating fast, capital-efficient execution.
- 🚀 **Pre-launch** — finalizing the production-partner contract and payment integration ahead of first-user launch.
- 🎯 **Next milestone:** sign the printing-house partner, integrate a local payment gateway (Payme/Click), and onboard the first paying customers and designers.

---

## Team

| | Name | Role |
|---|---|---|
| 👨‍💻 | **Nasriddinov Temurbek** | Founder & Lead Developer — designed and built the entire full-stack platform |
| 🤝 | **Abdurashidov Humoyun** | Co-founder |
| 📈 | **Abduvosiqova Iroda** | Marketing & Growth |

A lean, technical founding team that has already shipped a complete product — exactly the kind of execution an accelerator can multiply.

---

## Roadmap

**Now → Launch (0–3 months)**
- Sign printing-house production partner
- Integrate local payment gateway (Payme / Click)
- Onboard first customers; soft-launch marketing

**Growth (3–9 months)**
- Open the **designer marketplace** (listings + commission payouts)
- Add product variants (size, material) and distinct 3D models per product type
- Self-service order tracking and email/Telegram status notifications

**Scale (9+ months)**
- B2B / bulk ordering for companies, teams, and events
- Expand catalog and production-partner network
- Regional expansion across Central Asia

---

## The Ask

LOOM is applying to **[accelerator name]** to accelerate the move from launch-ready product to revenue:

- **Go-to-market** support to acquire the first cohort of customers and designers
- **Partnerships** with production houses and local payment providers
- **Capital** to fund the team's transition from build to growth

We've proven we can **build**. We're here to learn how to **scale**.

---

## For Developers

LOOM is a full-stack TypeScript application. To run it locally or understand the architecture:

- **Architecture, scalability & security deep-dive:** [dev.md](dev.md)
- **Quickstart:**

```bash
# Backend (Cloudflare Worker)
cd backend
npm install
cp .dev.vars.example .dev.vars      # add your secrets
npm run dev                         # → http://localhost:8787

# Frontend (static — no build step)
python3 -m http.server 8000         # → http://localhost:8000
```

Point the frontend at your API by editing `assets/config.js`. Full setup, environment variables, API reference, and the data model are documented in **[dev.md](dev.md)**.

---

<p align="center"><strong>LOOM</strong> — Design It. Wear It. · <a href="https://loomdesign.uz">loomdesign.uz</a></p>
