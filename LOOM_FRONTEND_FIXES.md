# LOOM Frontend Fixes Report
**Date:** 2026-05-08  
**Engineer:** Claude (automated)

---

## 1. Fixes Applied

### Fix 1 — `products-catalog.js` — Config consistency (Phase 2A)
**File:** `products-catalog.js`  
**Lines:** 15–19 → collapsed to 3 lines

**Before:**
```js
function getApiBase() {
  if (window.LOOM_CONFIG) return window.LOOM_CONFIG.API_BASE
  const h = window.location.hostname
  return (h === 'localhost' || h === '127.0.0.1') ? 'http://localhost:8787' : 'https://api.looom.me'
}
```

**After:**
```js
function getApiBase() {
  return window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me'
}
```

**Why:** The old code had a localhost fallback that would silently use `http://localhost:8787` if `window.LOOM_CONFIG` was not loaded. The new code always reads from the config object and falls back to the production URL — never to localhost.

---

### Fix 2 — `assets/account.js` — Config consistency (Phase 2B)
**File:** `assets/account.js`  
**Lines:** 70–72 → collapsed to 1 line

**Before:**
```js
const API = window.LOOM_CONFIG ? window.LOOM_CONFIG.API_BASE
  : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:8787' : 'https://api.looom.me');
```

**After:**
```js
const API = window.LOOM_CONFIG?.API_BASE ?? 'https://api.looom.me';
```

**Why:** Same issue as products-catalog.js — eliminated localhost fallback risk.

---

### Fix 3 — Script tag order verified (Phase 2C)
All HTML files confirmed correct:

| File | Order |
|------|-------|
| `index.html` | `config.js` → `auth.js` ✅ |
| `catalog.html` | `config.js` → `auth.js` → `products-catalog.js` ✅ |
| `configurator.html` | `config.js` → `auth.js` ✅ |
| `account.html` | `config.js` → `auth.js` → `account.js` ✅ |
| `login.html` | `config.js` → `auth.js` ✅ |

No reordering was needed.

---

### Fix 4 — `configurator.js` — 3D model error handler enhanced (Phase 3)
**File:** `configurator.js`  
**Lines:** ~596–600

The `onError` callback already existed and called `createPlaceholderShirt()` (which renders a 3D geometric fallback shape — better UX than a blank canvas). Enhanced to use `console.error` instead of `console.warn` and to immediately hide the loading overlay:

**Before:**
```js
function (err) {
  console.warn("GLB load failed, using placeholder geometry:", err);
  createPlaceholderShirt();
  hideLoadingOverlay();
},
```

**After:**
```js
function (err) {
  console.error('[LOOM] 3D model failed to load:', err);
  const loadingEl = document.getElementById('loading-overlay');
  if (loadingEl) loadingEl.style.display = 'none';
  createPlaceholderShirt();
  hideLoadingOverlay();
},
```

**Note:** The existing placeholder shirt fallback was kept — it's better UX than drawing text on a 2D canvas. The user sees a 3D shirt shape instead of a blank screen.

---

### Fix 5 — `configurator.js` — Telegram Worker URL from config (Phase 4)
**File:** `configurator.js`  
**Lines:** 44–46

**Before:**
```js
const WORKER_URL =
  "https://loom-telegram-orders.timurnasriddinov56.workers.dev";
```

**After:**
```js
const WORKER_URL =
  window.LOOM_CONFIG?.TELEGRAM_WORKER_URL
  ?? "https://loom-telegram-orders.timurnasriddinov56.workers.dev";
```

---

### Fix 6 — `assets/config.js` — Added TELEGRAM_WORKER_URL (Phase 4)
**File:** `assets/config.js`

**Before:**
```js
window.LOOM_CONFIG = {
  API_BASE: (h === 'localhost' || h === '127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://api.looom.me',
}
```

**After:**
```js
window.LOOM_CONFIG = {
  API_BASE: (h === 'localhost' || h === '127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://api.looom.me',
  TELEGRAM_WORKER_URL: 'https://loom-telegram-orders.timurnasriddinov56.workers.dev',
}
```

---

### Fix 7 — `configurator.js` — Logo upload guard (Phase 5)
**File:** `configurator.js`  
**Lines:** ~2044–2055

**Before:** On upload failure, code silently logged a warning and continued to `POST /api/orders` with `logoKey = null`.

**After:** On upload failure:
1. Shows Russian-language toast error to user
2. Re-enables submit button  
3. Restores button text / hides loader
4. Returns early — order submission is blocked

```js
if (!uploadRes.ok) {
  showToast("Ошибка загрузки логотипа. Пожалуйста, попробуйте снова перед отправкой заказа.", "error");
  btn.disabled = false;
  if (txt) txt.style.display = "block";
  if (loader) loader.style.display = "none";
  return;
}
```

Same guard applied in the `catch` block for network errors.

---

## 2. Files Deleted

| File | Reason |
|------|--------|
| `google-sheets-order-module.js` | Legacy Google Sheets order pipeline — not loaded by any HTML file |
| `google-apps-script.js` | Legacy Google Apps Script — not loaded by any HTML file |
| `assets/models/oversized-tshirt.obj` | Mentioned only in a `console.info` string; never actually loaded. `t_shirt.glb` is the active model |
| `tshirt_3d-white_front_001.html` | Orphaned HTML page — not linked from any nav, page, or JS file |

All deletions were confirmed by `grep` before removal.

---

## 3. Browser Test Results

> **Note:** Chrome browser extension was disconnected — tests performed via curl, API verification, and source code inspection. Interactive browser tests (3D render, login form submit, console errors) could not be run.

| Test | Result | Evidence |
|------|--------|----------|
| **TEST 1 — Homepage loads** | ✅ PASS | HTTP 200; 14 matches for `product-list-root`/`carousel`/`hero` |
| **TEST 2 — Catalog API call** | ✅ PASS | HTTP 200; `config.js` loads before `products-catalog.js`; API returns `{"products":[]}` |
| **TEST 2 — No localhost URL in catalog** | ✅ PASS | `getApiBase()` cleaned, no localhost string in `products-catalog.js` |
| **TEST 3 — Configurator page loads** | ✅ PASS | HTTP 200; `config.js` present; `t_shirt.glb` is the model path |
| **TEST 3 — 3D error fallback** | ✅ PASS | `onError` callback exists — shows placeholder geometry, not blank canvas |
| **TEST 4 — Login page loads** | ✅ PASS | HTTP 200; `config.js` → `auth.js` load order confirmed |
| **TEST 4 — Login posts to api.looom.me** | ✅ PASS | `auth.js` uses `window.LOOM_CONFIG.API_BASE` exclusively |
| **TEST 5 — Account page loads** | ✅ PASS | HTTP 200; `config.js` → `account.js` load order confirmed |
| **TEST 5 — No localhost URL in account** | ✅ PASS | `account.js` API call cleaned to use config |
| **TEST 6 — admin.looom.me loads** | ✅ PASS | HTTP 200 (after 301 redirect to `www.looom.me/admin/`) |

---

## 4. Issues Found During Testing

### Issue — `catalog.html` loads `dist/index.js`
`catalog.html` line 683 loads `<script src="dist/index.js">`. This file does not exist in the repository. This causes a silent 404 on every catalog page load.

**Suggested fix:** Check if `dist/index.js` was a compiled React bundle that is no longer needed. If the React components have been replaced by `products-catalog.js`, remove this script tag from `catalog.html`.

### Issue — Catalog shows empty (no products seeded)
`GET https://api.looom.me/api/products` returns `{"products":[]}`. The catalog renders "Каталог пуст." Users see an empty page.

**Suggested fix:** Add products via the admin panel at `https://www.looom.me/admin/` once admin credentials are known.

### Issue — `configurator.js` WORKER_URL used before `config.js` is guaranteed to have loaded
`WORKER_URL` is set at the module's top-level (line 44), which executes immediately when the script is parsed — before `DOMContentLoaded`. If `config.js` hasn't run yet, `window.LOOM_CONFIG` will be undefined and the nullish coalescing fallback will be used. Since `config.js` is loaded synchronously before `configurator.js` in the HTML, this is safe in practice, but fragile.

**Suggested fix (optional):** Move `WORKER_URL` resolution inside `handleOrderSubmit()` or read it lazily, similar to how `getApiBase()` is structured as a function.

---

## 5. Remaining Items

| Item | Priority | Steps |
|------|----------|-------|
| Add products via admin panel | 🔴 High | Log in to `https://www.looom.me/admin/`, add at least 1 product with a GLB model |
| Remove or fix `dist/index.js` reference in catalog.html | 🟡 Medium | Check if React bundle is still needed; if not, remove `<script src="dist/index.js">` from `catalog.html` |
| Browser extension reconnect | 🟡 Medium | Reconnect Chrome extension to verify 3D canvas render, login flow, and console errors interactively |
| Update Telegram bot token/chat ID | 🟡 Medium | If placeholder values were used during deployment, update with real values via `wrangler secret put` |
| Verify R2 upload end-to-end | 🟢 Low | Test logo upload with a real PNG file through the configurator order flow |
