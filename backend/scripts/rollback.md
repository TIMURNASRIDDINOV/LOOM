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

**Always deploy with `npm run deploy`. A bare `npx wrangler deploy` bypasses the
gate** — `predeploy` is an npm hook, so wrangler never runs it and a type error
can reach Cloudflare. Flags go after `--`, otherwise npm swallows them:

```sh
npm run deploy                    # prod
npm run deploy -- --env staging   # staging (the `--` is required)
```

## 2. Record the current version BEFORE every deploy

Nothing is rolled back without a recorded version id. Before every deploy:

```sh
npx wrangler deployments list                  # prod — the current version is the LAST row
npx wrangler deployments list --env staging    # staging
npm run deploy                                 # prod
npm run deploy -- --env staging                # staging
```

`wrangler deployments list` prints oldest first, so the version in service is
the **last** entry, not the first. The deploy output also prints the new version
id — record that too. Keep both in the deploy note (ticket comment or #deploys
channel) together with the environment they belong to.

## 3. Post-deploy health check

```sh
node scripts/health-check.mjs https://api.loomdesign.uz                                    # prod
node scripts/health-check.mjs https://loom-backend-staging.timurnasriddinov56.workers.dev  # staging
```

Anonymous GETs only: `/api/products` must return 200, `/api/admin/me` must
return 401. A 200 on `/api/products` proves D1 answers — not that the catalogue
has products. The script exits non-zero on any failure — treat a non-zero exit
as "roll back" (section 4), not "try again later". Exit 2 means the script
itself was called wrongly (missing host, or a host that is not http/https) and
says nothing about the deployment.

Behind a mandatory egress proxy, Node's fetch ignores `HTTPS_PROXY`/`HTTP_PROXY`
unless `NODE_USE_ENV_PROXY=1` is set — without it both checks report
`ENOTFOUND: fetch failed` while `curl` gets 200 and 401. Do not roll back on
that alone; re-run with the variable set, or confirm with `curl` first:

```sh
NODE_USE_ENV_PROXY=1 node scripts/health-check.mjs https://api.loomdesign.uz
```

## 4. Rollback

### API Worker (Cloudflare Workers)

```sh
npx wrangler rollback <prev-version> -m "smoke failed" --yes                  # prod
npx wrangler rollback <prev-version> -m "smoke failed" --yes --env staging    # staging
```

`<prev-version>` is the version id recorded in section 2 **for that
environment**. The `-m` message lands in the deployment history so the reason
survives. `--yes` accepts the prompts' defaults but does not silence every
prompt in wrangler 3.114.17: a terminal can still ask for the message, for
confirmation to serve the rollback to 100% of traffic, and — if secrets changed
since that version — one more confirmation about them. Answer the prompts;
`--yes` only takes the default. Re-run the health check (section 3) against the
rolled-back Worker.

### Site (Cloudflare Pages)

Pages deploys track git, so a revert + push is the rollback:

```sh
git checkout main && git pull
git revert <merge-sha> && git push
```

Cloudflare Pages rebuilds from the reverted tree; no manual upload. Note that
`/assets/*` is served with a year-long immutable cache, so reverting a file
under `/assets/` in place leaves browsers and the edge on the cached copy — a
**forward fix** of such a file needs a new `?v=` in the HTML that loads it.

### Database (D1) — additive migrations only, and only the Worker rolls back

D1 migrations are **additive only**: new tables, new nullable columns, new
indexes. Never edit or delete a migration that has been applied anywhere —
apply a new forward migration instead. Because the schema only grows, the
previous Worker version still works against the current schema, so a rollback
is always just "put the old Worker back". The D1 database itself is never
rolled back as part of a deploy rollback.

Not every migration in the history is additive — `0006` and `0008` rewrite rows
(`UPDATE ... SET role`). A data-rewriting migration is **not** undone by
`wrangler rollback`, so treat it as its own change: apply it separately from the
Worker deploy, know the exact before-state of the rows it touches, and have the
reverse `UPDATE` written down before you apply it. Apply migrations before the
Worker deploy so the old Worker never meets a schema its code does not expect
(see dev.md, Deployment).

## 5. Last resort only: D1 time-travel restore

```sh
npx wrangler d1 time-travel info loom-db --timestamp 2026-10-15T09:00:00Z  # bookmark for a moment
npx wrangler d1 time-travel restore loom-db --bookmark <bookmark>          # or: --timestamp <ts>
```

`wrangler d1 time-travel restore` rewinds the whole database to a bookmark. **It
discards every write after that bookmark — real customer orders included.**
Only rows you can see in the admin panel are affected, but they are all
affected: orders, users, payments and status logs written since the bookmark
leave the live database. Never use it to fix a bad deploy (that is what sections
3–4 are for); escalate to the founder instead, and only consider restore when
the data itself is corrupt beyond repair.

The restore prints the bookmark of the state it replaced. **Record that
bookmark immediately**: passing it back as `--bookmark` undoes the restore and
returns the database to where it was, as long as it is still inside D1's
time-travel window. Lose it and the discarded writes are gone for good.
