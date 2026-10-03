# Staging Worker (LOOM-147)

`wrangler.toml` `[env.staging]` deploys the same Worker as `loom-backend-staging`
on workers.dev only, bound to its own resources. It never touches prod data.

| Binding | Staging resource |
|---|---|
| `DB` | D1 `loom-db-staging` |
| `LOOM_MODELS` | R2 `loom-models-staging` |
| `LOOM_UPLOADS` | R2 `loom-uploads-staging` |
| `RATE_LIMIT` | KV `loom-backend-staging-staging-RATE_LIMIT` |

No `AI` / `IMAGES` bindings: the admin AI spike and cutout routes return an error on staging.

**`routes = []` in `[env.staging]` is load-bearing.** `routes` is inherited from the
top level; without it a staging deploy moves `api.` / `admin.loomdesign.uz` onto the
staging Worker and takes prod down. Bindings are not inherited, so every staging
binding is declared explicitly.

All commands run from `backend/`.

## Rebuild from scratch

1. Create the resources (skip any that `wrangler d1 list`, `wrangler r2 bucket list`,
   `wrangler kv namespace list` already show) and put the new ids in `[env.staging]`:

   ```sh
   npx wrangler d1 create loom-db-staging
   npx wrangler r2 bucket create loom-models-staging
   npx wrangler r2 bucket create loom-uploads-staging
   npx wrangler kv namespace create RATE_LIMIT --env staging
   ```

2. Apply migrations (expect 0001–0020):

   ```sh
   npx wrangler d1 migrations apply loom-db-staging --remote --env staging
   ```

3. Copy the catalogue only (products rows + the GLB/thumbnail objects they reference).
   Prod access is a read-only SELECT and `r2 object get`; no other table is copied.
   Safe to re-run (upserts by id):

   ```sh
   bash scripts/staging-copy-catalogue.sh
   ```

4. Check the config before any deploy. The output must list only `*-staging`
   bindings, `ENVIRONMENT: "staging"`, and no routes:

   ```sh
   npx wrangler deploy --env staging --dry-run --outdir "$(mktemp -d)"
   ```

## Founder-only steps (deploy)

Fresh random secrets, never the prod values, never printed:

```sh
openssl rand -hex 32 | npx wrangler secret put JWT_SECRET --env staging
openssl rand -hex 32 | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
```

No `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` on staging (`BOT_USERNAME` is empty).

Record the prod version, deploy staging, record the prod version again:

```sh
npx wrangler deployments list | tail -20      # prod, before
npx wrangler deploy --env staging
npx wrangler deployments list | tail -20      # prod, after: same latest version
```

## Smoke checks

`STG=https://loom-backend-staging.<account-subdomain>.workers.dev` (printed by the deploy).

```sh
curl -s -o /dev/null -w '%{http_code}\n' $STG/api/products                       # 200
curl -s -o /dev/null -w '%{http_code}\n' $STG/api/products/tshirt-regular        # 200
curl -s -D - -o /dev/null $STG/api/files/models/glb/tshirt-regular.glb \
  | grep -iE '^HTTP|access-control-allow-origin'                                 # 200, ACAO *
curl -s -o /dev/null -w '%{http_code}\n' $STG/api/admin/me                       # 401
curl -s -o /dev/null -w '%{http_code}\n' https://api.loomdesign.uz/api/products  # 200 (prod untouched)
```
