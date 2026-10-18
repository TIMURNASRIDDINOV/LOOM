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
on the next fetch for published artwork. Changing a design's markup invalidates
checkout of older cart items referencing it: the buyer sees a translated message
to remove and re-add that item. This prevents the stored cart price and current
designer share from disagreeing. Historical orders and sales are untouched.

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
create/rename/deactivate; designer upload missing/valid category; approve/reject;
Market All/category/empty/category pagination; ru/uz/en and customer light/dark;
view-only staff have no edit/category mutation controls. Test mobile publish and
Market filters and Load more on a device or Expo preview as well.

## Release / rollback

Production migration, Worker deployment and native builds are founder-run.
Apply migration 0023 before the new Worker. Deploy updated web assets together
with their bumped cache versions; ship the mobile update with category selection.
Old mobile builds cannot submit new artwork without category_id after this
release; they receive the stable artwork_category validation error. Existing
portfolios and public browsing remain readable. Coordinate the app release with
submission enforcement.

Rollback: restore the prior Worker and web/mobile builds, keeping the additive
schema and category assignments. No destructive down migration is necessary.
