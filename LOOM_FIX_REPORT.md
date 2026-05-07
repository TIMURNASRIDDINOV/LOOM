# LOOM Backend Fix Report

> Generated: 2026-05-08 | All code changes applied | TypeScript: ✅ PASS (0 errors)

---

## Phase 1 — Files Read

All required files were read in full before any changes were made:

- `backend/wrangler.toml`
- `backend/src/index.ts`
- `backend/src/routes/public.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/admin-products.ts`
- `backend/src/routes/auth.ts`
- `backend/src/db/queries.ts`
- `backend/src/lib/jwt.ts`
- `backend/src/lib/telegram.ts`
- `backend/src/middleware/requireAuth.ts`
- `backend/src/middleware/requireAdmin.ts`
- `backend/src/types.ts` *(additional — needed to fix TypeScript error)*

---

## Phase 2 — Fixes Applied

### FIX 1 — Rate Limiting ✅

**File:** `backend/src/routes/public.ts`

**What changed:**
- Added module-level `rateLimitStore: Map<string, { count, resetAt }>` at the top of the file
- Added `isRateLimited(key, maxRequests, windowMs)` helper function
- `POST /api/orders`: limited to **5 requests per minute per IP** → returns `429`
- `POST /api/uploads`: limited to **10 requests per minute per IP** → returns `429`
- IP extracted from `CF-Connecting-IP` (Cloudflare header), falls back to `X-Forwarded-For`, then `'unknown'`

**Why:** The TODO comment in the original file flagged this as missing. Without rate limiting, any actor can flood the orders table or R2 uploads bucket.

**New code added:**
```typescript
interface RateLimitEntry { count: number; resetAt: number }
const rateLimitStore = new Map<string, RateLimitEntry>()

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  if (entry.count >= maxRequests) return true
  entry.count++
  return false
}
```

**Note:** This is an in-process Map — it resets when the Worker isolate restarts and doesn't coordinate across multiple isolates. For stronger global enforcement, replace with Cloudflare KV counters with TTL.

---

### FIX 2 — Remove `null` from CORS Origins ✅

**File:** `backend/src/index.ts`

**What changed:**
- Removed `'null'` (the `file://` origin) from the allowed origins list — permanently
- Extracted origins into `PROD_ORIGINS` and `DEV_ORIGINS` constants
- CORS middleware now reads `c.env.ENVIRONMENT` at request time to decide which set to use
- When `ENVIRONMENT === "production"`: only `PROD_ORIGINS` allowed
- When `ENVIRONMENT !== "production"`: `PROD_ORIGINS + DEV_ORIGINS` allowed

**Why:** The `null` origin bypasses same-origin restrictions for any locally-opened HTML file, allowing any page saved to disk to make authenticated requests with cookies. In production, only known domains should be accepted.

**New CORS setup:**
```typescript
const PROD_ORIGINS = ['https://looom.me', 'https://www.looom.me', 'https://admin.looom.me']
const DEV_ORIGINS  = ['http://localhost:8787', 'http://localhost:3000']

app.use('*', (c, next) => {
  const allowed = c.env.ENVIRONMENT === 'production'
    ? PROD_ORIGINS
    : [...PROD_ORIGINS, ...DEV_ORIGINS]
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : PROD_ORIGINS[0]),
    ...
  })(c, next)
})
```

---

### FIX 3 — D1 Query Error Wrapping ✅

**File:** `backend/src/db/queries.ts`

**What changed:**
- Added `safeQuery<T>(label, fn)` helper at the top of the file
- Wrapped **every single exported query function** with `safeQuery(...)`
- On error: logs `[DB Error] <functionName>: <message>` via `console.error`
- Re-throws as `new Error('Database error in <functionName>')` — preserves error identity while giving the global handler meaningful context

**Why:** Previously, D1 failures propagated silently to the global `onError` handler with no indication of which query failed, making production debugging via `wrangler tail` very difficult.

**Helper:**
```typescript
async function safeQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[DB Error] ${label}:`, msg)
    throw new Error(`Database error in ${label}`)
  }
}
```

**Functions wrapped:** `getActiveProducts`, `getProductById`, `getProductBySlug`, `getUserByEmail`, `getUserById`, `createUser`, `getAdminByEmail`, `getAdminById`, `countAdmins`, `createAdmin`, `updateAdminPassword`, `createOrder`, `getOrderById`, `getOrdersByUserId`, `getAdminOrders`, `getOrderStatusLog`, `updateOrderStatus`, `getAdminProducts`, `createProduct`, `updateProduct`, `softDeleteProduct`, `getAdminStats`, `insertOrderStatusLog`

---

### FIX 4 — JWT Error Type Distinction ✅

**File:** `backend/src/lib/jwt.ts`

**What changed:**
- The `catch` block now inspects `err.code`
- `ERR_JWT_EXPIRED` → `console.warn('[JWT] Token expired')` — expected user behaviour, not a security concern
- Any other error code → `console.error('[JWT] Invalid or tampered token — code: ...')` — could indicate an attack attempt
- Both paths still return `null` (no behaviour change for callers)

**Why:** Previously all JWT failures looked identical in logs. Now `wrangler tail` clearly shows expired sessions vs potential token tampering.

```typescript
} catch (err: unknown) {
  const code = (err as { code?: string })?.code
  if (code === 'ERR_JWT_EXPIRED') {
    console.warn('[JWT] Token expired')
  } else {
    console.error('[JWT] Invalid or tampered token — code:', code ?? 'unknown')
  }
  return null
}
```

---

### FIX 5 — Lock `/api/admin/setup` ✅

**File:** `backend/src/routes/admin.ts`

**What changed:**
- The setup handler now queries `countAdmins()` first
- If **no admins exist**: allows creating the first admin (original flow for fresh deployments)
- If **admins exist**: checks if the provided email has `password_hash = 'PLACEHOLDER_USE_SETUP_ENDPOINT'`
  - If yes: allows setting the password (the seeded admin placeholder flow)
  - If no (admin has a real password, OR unknown email): returns `403 "Setup already completed"`
- This means once any admin has a real password set, the `/setup` endpoint is **permanently locked** to new invocations

**Why:** The original code had a subtle gap — if you supplied an email that didn't exist but there were 0 admins, it would create a new admin. After any admin exists with a real password, the endpoint now refuses all attempts.

```typescript
const total = await countAdmins(c.env.DB)
if (total === 0) {
  // fresh deployment — allow creating first admin
  ...
}
// admins exist — only allow if this email still has placeholder
const existing = await getAdminByEmail(c.env.DB, normalizedEmail)
if (!existing || existing.password_hash !== 'PLACEHOLDER_USE_SETUP_ENDPOINT') {
  return c.json({ error: 'Setup already completed' }, 403)
}
```

---

### FIX 6 — D1 database_id ⚠️ REQUIRES MANUAL STEP

**File:** `backend/wrangler.toml`

**Status:** The placeholder `"YOUR_D1_DATABASE_ID"` is still in the file. Wrangler deploy requires Cloudflare authentication which is not configured on this machine (no `wrangler login` session, no `CLOUDFLARE_API_TOKEN` env var).

**Manual steps to complete this fix:**
```bash
# Step 1: Authenticate
cd backend
node_modules/.bin/wrangler login

# Step 2: Find your D1 database ID
node_modules/.bin/wrangler d1 list
# — if "loom-db" is listed, copy its ID
# — if not listed, create it:
node_modules/.bin/wrangler d1 create loom-db

# Step 3: Edit wrangler.toml — replace:
#   database_id = "YOUR_D1_DATABASE_ID"
# with the real ID from step 2

# Step 4: Apply migrations to production
node_modules/.bin/wrangler d1 migrations apply loom-db --remote

# Step 5: Deploy
node_modules/.bin/wrangler deploy
```

---

### FIX 7 — Pagination on `/api/me/orders` ✅

**Files:** `backend/src/routes/public.ts`, `backend/src/db/queries.ts`

**What changed:**
- `getOrdersByUserId` now accepts `page` and `limit` parameters (defaults: page=1, limit=20)
- Added a `COUNT(*)` query to return total
- Added `LIMIT ? OFFSET ?` to the SELECT query
- Route handler reads `?page=` query param (default: 1)
- Response shape changed from `{ orders }` to `{ orders, page, limit, total }`

**Why:** A user with many orders previously got all rows in a single unbounded query. Now the response is paginated and includes total count for frontend pagination UI.

---

### FIX 8 — Telegram Failure Logging ✅

**File:** `backend/src/lib/telegram.ts`

**What changed:**
- Error log now includes the order ID for traceability: `[Telegram] Notification failed for order #${order.id} — HTTP ${res.status}: <body>`
- Added `// TODO: store in failed_notifications table for retry` comment as specified

**Why:** The original log message gave no context about which order failed, making it impossible to manually resend notifications.

---

### FIX 9 — `.dev.vars.example` Created ✅

**File:** `backend/.dev.vars.example` *(new file)*

**Content:**
```
JWT_SECRET=your-secret-here-min-32-chars-long-random-string
TELEGRAM_BOT_TOKEN=123456789:ABCDEFghijklmnopqrstuvwxyz0123456
TELEGRAM_CHAT_ID=-100123456789
```

**Why:** No `.dev.vars.example` existed, making developer onboarding require reading `wrangler.toml` and `types.ts` to discover all required secrets.

---

### TypeScript Bonus Fix ✅

**File:** `backend/src/types.ts`

**What changed:**
- Added `ENVIRONMENT: string` to the `Bindings` type

**Why:** FIX 2 reads `c.env.ENVIRONMENT` in `index.ts`. TypeScript error `TS2339: Property 'ENVIRONMENT' does not exist on type 'Bindings'` was produced until this was added. The `[vars] ENVIRONMENT = "production"` line in `wrangler.toml` defines it as a binding.

---

## Phase 3 — Build Status

```
TypeScript check: ✅ PASS (0 errors, 0 warnings)
Command: node_modules/.bin/tsc --noEmit
```

**Deploy status:** ❌ BLOCKED — No Cloudflare authentication configured on this machine.

See manual steps under FIX 6 for the complete deploy sequence.

---

## Phase 4 — Live Test Results

**Status:** ❌ BLOCKED — External network (api.looom.me, workers.dev) is not reachable from this environment.

Once you deploy following the FIX 6 steps, run these curl commands to verify each fix:

### Test 1 — Health Check
```bash
curl https://api.looom.me/
# Expected: {"service":"LOOM Backend","version":"0.2.0","status":"ok"}
```

### Test 2 — Products List
```bash
curl https://api.looom.me/api/products
# Expected: {"products":[...]}
```

### Test 3 — Auth: Register
```bash
curl -X POST https://api.looom.me/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser_loom@mailnull.com","password":"TestPass123!"}'
# Expected: {"token":"...","user":{...}}
```

### Test 4 — Auth: Login
```bash
curl -X POST https://api.looom.me/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser_loom@mailnull.com","password":"TestPass123!"}'
# Expected: {"token":"...","user":{...}}
```

### Test 5 — Auth: Get Profile
```bash
TOKEN="<token from test 4>"
curl https://api.looom.me/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"id":...,"email":"testuser_loom@mailnull.com",...}
```

### Test 6 — Rate Limit on Orders (FIX 1)
```bash
for i in {1..6}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST https://api.looom.me/api/orders \
    -H "Content-Type: application/json" \
    -d '{"customerName":"Test","customerPhone":"+1234567890","designJson":"{}","totalPrice":100000}'
done
# Expected: Requests 1–5: 400 (validation or 201), Request 6: 429
```

### Test 7 — Rate Limit on Uploads (FIX 1)
```bash
for i in {1..11}; do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST https://api.looom.me/api/uploads \
    -F "file=@/dev/null"
done
# Expected: Requests 1–10: 400, Request 11: 429
```

### Test 8 — Admin Setup Locked (FIX 5)
```bash
curl -X POST https://api.looom.me/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"x@x.com","password":"anything1"}'
# Expected: {"error":"Setup already completed"} with 403
```

### Test 9 — Admin Login
```bash
curl -c cookies.txt -X POST https://api.looom.me/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@looom.me","password":"<your-admin-password>"}'
# Expected: {"ok":true} and admin_token cookie set
```

### Test 10 — Admin Stats (FIX 3)
```bash
curl -b cookies.txt https://api.looom.me/api/admin/stats
# Expected: {"ordersByStatus":{...},"revenueLast30Days":...}
```

### Test 11 — CORS null Origin Blocked (FIX 2)
```bash
curl -H "Origin: null" https://api.looom.me/api/products
# Expected: Access-Control-Allow-Origin should NOT be "null"
# Should return "https://looom.me" (the default fallback)
```

### Test 12 — Paginated User Orders (FIX 7)
```bash
TOKEN="<user token>"
curl "https://api.looom.me/api/me/orders?page=1" \
  -H "Authorization: Bearer $TOKEN"
# Expected: {"orders":[...],"page":1,"limit":20,"total":<number>}
```

---

## Remaining Issues

The following issues from the original LOOM_REPORT.md were **not addressed** in this fix session (out of scope, non-backend, or require manual infrastructure steps):

| Priority | Issue | Reason Not Fixed |
|----------|-------|-----------------|
| 🔴 Critical | D1 database_id placeholder | Requires `wrangler login` — no auth on this machine |
| 🟠 High | No 3D model load error handler | Frontend JS fix (`configurator.js`), not backend |
| 🟠 High | Hardcoded Telegram Worker URL in `configurator.js` | Frontend fix, not backend |
| 🟡 Medium | No R2 upload retry in configurator | Frontend fix |
| 🟡 Medium | No form validation feedback on login/register pages | Frontend fix |
| 🟡 Medium | `products-catalog.js` ignores `LOOM_CONFIG` | Frontend fix |
| 🟡 Medium | Tailwind CDN not production-safe | Frontend build step needed |
| 🟡 Medium | Three.js r128 is outdated (current: r167) | Frontend migration required |
| 🟡 Low | Legacy `google-sheets-order-module.js` still loaded | Frontend cleanup |
| 🟡 Low | No CSP headers | Not yet implemented |
| 🟡 Low | Rate limiting is in-process only (not global) | Needs KV-based implementation |

---

## Suggested Next Steps

1. **Deploy** — run `wrangler login` then follow the FIX 6 steps to fill in `database_id` and deploy
2. **Run the curl test suite** above to verify each fix on the live Worker
3. **Fix `configurator.js`**: add GLTFLoader error handler, remove hardcoded Worker URL, add upload retry before order submit
4. **Fix `products-catalog.js` + `account.js`**: consistently read from `window.LOOM_CONFIG.API_BASE` instead of falling back to hardcoded localhost
5. **Upgrade Three.js** from r128 → r167 (check CDN URL changes in loader imports)
6. **Replace Tailwind CDN** with `npx tailwindcss` CLI output before shipping
7. **KV-based global rate limiting** — use `RATE_LIMIT_KV` binding with `kv.put(key, count, { expirationTtl: 60 })`
8. **Delete `google-sheets-order-module.js`** and `google-apps-script.js` from the repo
