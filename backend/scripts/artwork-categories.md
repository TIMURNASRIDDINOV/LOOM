# LOOM-241 — artwork details and Market categories

Admins with `artworks.edit` can change artwork title, design markup (0–200,000
UZS), tags and one primary category, independently of approval/rejection. Owner
and manager presets include this capability; staff need an explicit grant.
Designers choose a category on new web/mobile uploads. Post-submission editing
is performed by staff in this task.

Migration `0023_artwork_categories.sql` adds the shared translated category
list, nullable assignments for existing work, and the price-change timestamp.
Starter categories: Illustration, Typography, Abstract, Nature, Culture, Other.
Staff can rename them in ru/uz/en, add more, or deactivate them without a deploy.
Deactivated categories cannot receive new assignments; existing assignments can
be retained on edits. Categories containing approved works remain available in
Market filters even after deactivation. Legacy uncategorized work remains in All.

Admin metadata edits preserve moderation status and are immediately reflected
on the next fetch for published artwork. Each edit that changes a field is
recorded in the designer's activity log with the acting admin.

A cart item freezes its unit price, and web and mobile record each marketplace
design's markup on the design element (`artworkPrice`) when it is added.
Checkout compares that recorded price with the artwork's current markup and,
when they differ, refuses with 409 `artwork_price_changed` before any order is
written. Only items without a recorded price (older carts and app builds) fall
back to comparing the artwork's price-change time with the cart row's creation
time. The 409 body always carries `artworkId` and `itemId` (the cart row);
`artworkTitle` and `currentPrice` are added only when the artwork is approved,
because an unapproved work's title and markup are not public. The buyer sees a
translated message, removes the item and adds it again from Market (web) or the
studio (mobile) to get the current price. This keeps the paid price and the
designer share in agreement. Historical orders and sales are untouched.

## Verification

From the repository root, with backend and mobile dependencies installed:

```
node backend/scripts/artwork-categories-test.mjs
npm run typecheck --prefix backend
cd mobile && npx --no-install tsc --noEmit
```

The route test bundles the real Worker, applies every migration to ephemeral
Miniflare D1, and exercises permissions, validation, submission, metadata edits,
category rename/deactivation, moderation, category pagination, unchanged sales
and orders, and refusal of stale-price checkout before any order is written.
It has no remote bindings or production credentials. `--serve` keeps that local
fixture at localhost:8787 for browser checks; close it when finished.

Browser QA: admin Edit → Cancel; Edit → failed save → retry; save/reload; category
create/rename/deactivate; categories request failing (moderation grid and
Approve/Reject still work, category manager shows Retry, editing an uncategorized
work explains why Save is disabled); designer upload missing/valid category; approve/reject;
Market All/category/empty/category pagination; ru/uz/en and customer light/dark;
view-only staff have no edit/category mutation controls. Test mobile publish and
Market filters and Load more on a device or Expo preview as well.

## Release / rollback

Production migration, Worker deployment and native builds are founder-run.
Cloudflare Pages publishes the web assets (repository root, including `/admin/`)
as soon as the PR merges to `main`; the API Worker is deployed by hand. The
migration and the Worker deploy run from a clean checkout of `origin/main`,
never from a checkout that sits on a feature branch: `wrangler d1 migrations
apply` applies every migration file it finds, including unmerged ones. Because
0023 reaches `main` only with this PR, the migration follows the merge. Release
in this order:

1. **Merge.** Pages publishes the new admin, designer and Market code with
   their bumped `?v=` cache versions.
2. **Apply migration 0023 to production as soon as the merge is on `main`.**
   The founder runs this from a fresh detached worktree of `origin/main`. It
   borrows `backend/node_modules` from the main checkout by symlink (this PR
   does not change `backend/package.json`). From the main checkout's root:

   ```sh
   git fetch origin
   git worktree add --detach ../loom-release origin/main
   ln -s "$PWD/backend/node_modules" ../loom-release/backend/node_modules
   cd ../loom-release/backend
   npx wrangler d1 time-travel info loom-db           # record the bookmark it prints
   npx wrangler d1 migrations list loom-db --remote   # pending: 0023_artwork_categories.sql
   npx wrangler d1 migrations apply loom-db --remote  # same as npm run migrate:prod
   ```

   Keep the bookmark in the deploy note. It serves only the last-resort restore
   in `backend/scripts/rollback.md` section 5, which discards every later write,
   orders included; it is not the rollback for this release. Stop and review
   first if `migrations list` shows anything pending besides 0023. 0023 is
   additive: the Worker currently live reads `SELECT a.*` and inserts without
   `category_id`, so it keeps working on the new schema. Never deploy the new
   Worker before 0023 is applied — Market, the category list and designer
   submission would fail on the old schema.
3. **Deploy the Worker immediately after the migration, once the Pages build
   is live**, from the same `../loom-release/backend`: record the current
   version, run
   `npm run deploy`, then run
   `node scripts/health-check.mjs https://api.loomdesign.uz` (see
   `backend/scripts/rollback.md`).
4. **Check the immutable web assets before announcing the release.** The Pages
   rollout is not atomic: the first request for a new `?v=` URL can reach the
   old file, and the edge then keeps that copy for a year. List the changed
   files with `git diff --name-only <merge-sha>~1 <merge-sha> -- assets
   admin/assets` (plus any changed root `.js`/`.css` bundle) and take each
   file's `?v=` from the HTML that loads it. For each file, from the root of
   `../loom-release`, first fetch the URL with an extra random `&probe=` query
   until its sha256 matches the file on `main`; only then fetch the real `?v=`
   URL and compare it the same way:

   ```sh
   # check <repo path> <version> [extra query]: compare the live copy with main's
   check() {
     want=$(shasum -a 256 < "$1" | cut -d' ' -f1)
     got=$(curl -fsS "https://loomdesign.uz/$1?v=$2$3" | shasum -a 256 | cut -d' ' -f1)
     [ "$got" = "$want" ] && echo "match $1?v=$2$3" || echo "STALE $1?v=$2$3"
   }
   check <path> <N> "&probe=$(openssl rand -hex 8)"   # repeat until it matches
   check <path> <N>                                   # only after the probe matched
   ```

   If a real `?v=` URL is stale, do not wait for it to clear: bump that file's
   `?v=` again in a tiny PR and check the new version the same way (see the
   immutable-cache note in `backend/scripts/rollback.md` and the cache contract
   in `_headers`). Then leave the release worktree: from the main checkout run
   `rm ../loom-release/backend/node_modules` (removes only the symlink) and
   `git worktree remove ../loom-release`.

Between steps 1 and 3 the new web code talks to the old Worker, which has no
category routes. During that short window:

- Web designer uploads are blocked: the upload form cannot load categories and
  does not submit without one.
- Web Market shows only "All categories", with a "could not load categories"
  note and Retry; the artwork grid still loads.
- The admin moderation grid still loads and Approve/Reject work. The category
  manager shows the error with Retry, and admin artwork edits cannot be saved
  until the new Worker is live.

Keep the window as short as possible. The new Worker rejects submissions
without a category, so a designer page left open from before the release gets
the stable artwork_category error until it is reloaded. Old mobile builds get
the same error for new uploads until the mobile update with category selection
ships; existing portfolios and public browsing remain readable. Coordinate the
app release with submission enforcement.

Rollback: roll back the Worker with `wrangler rollback` and revert the merge for
the web assets (see `backend/scripts/rollback.md`), keeping the additive schema
and category assignments. No destructive down migration is necessary. A
Worker-only rollback reopens the window above until the web revert is live.
