# Deploy, rollback and recovery (LOOM-149)

Part of PRD-201 — Ship safely (LOOM-138), requirement R4. Every deploy of the
API Worker or the Pages site follows this document. All commands run from
`backend/` unless stated otherwise.

## 1. Gates — what runs before a deploy

```sh
npm run typecheck      # tsc --noEmit, also wired as `predeploy`
npm run deploy         # runs typecheck first; a type error stops the deploy
```

`predeploy` is an npm lifecycle hook: `npm run deploy` always executes it
first, and npm aborts the deploy when it exits non-zero. A type error in
`src/` therefore never reaches Cloudflare — fix it and deploy again.

## 2. Record the current version BEFORE every deploy

Nothing is rolled back without a recorded version id. Before every deploy:

```sh
npx wrangler deployments list          # note the current latest version id
npx wrangler deploy                    # or: npm run deploy
```

The deploy output also prints the new version id — record that too. Keep both
in the deploy note (ticket comment or #deploys channel).

## 3. Post-deploy health check

```sh
node scripts/health-check.mjs https://api.loomdesign.uz    # prod
node scripts/health-check.mjs https://loom-backend-staging.<subdomain>.workers.dev
```

Anonymous GETs only: `/api/products` must return 200, `/api/admin/me` must
return 401. The script exits non-zero on any failure — treat a non-zero exit
as "roll back" (section 4), not "try again later".

## 4. Rollback

### API Worker (Cloudflare Workers)

```sh
npx wrangler rollback <prev-version> -m "smoke failed" --yes
```

`<prev-version>` is the version id recorded in section 2. The `-m` message
lands in the deployment history so the reason survives. Re-run the health
check against the rolled-back Worker.

### Site (Cloudflare Pages)

Pages deploys track git, so a revert + push is the rollback:

```sh
git revert <merge-sha> && git push
```

Cloudflare Pages rebuilds from the reverted tree; no manual upload.

### Database (D1) — additive migrations only, and only the Worker rolls back

D1 migrations are **additive only**: new tables, new nullable columns, new
indexes. Never edit or delete a migration that has been applied anywhere —
apply a new forward migration instead. Because the schema only grows, the
previous Worker version still works against the current schema, so a rollback
is always just "put the old Worker back". The D1 database itself is never
rolled back as part of a deploy rollback.

## 5. Last resort only: D1 time-travel restore

`wrangler d1 time-travel restore` rewinds the whole database to a bookmark.
**It discards every write after that bookmark — real customer orders
included.** Only rows you can see in the admin panel are affected, but they
are all affected: orders, users, payments and status logs written since the
bookmark are gone and cannot be recovered from Cloudflare. Never use it to
fix a bad deploy (that is what sections 3–4 are for); escalate to the founder
instead, and only consider restore when the data itself is corrupt beyond
repair.
