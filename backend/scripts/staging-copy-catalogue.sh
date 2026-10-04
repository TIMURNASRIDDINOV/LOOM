#!/usr/bin/env bash
# Copy the product catalogue (products rows + the GLB/thumbnail objects they
# reference) from production into staging. See scripts/staging-setup.md.
#
# Production access is READ-ONLY: one SELECT on loom-db and `r2 object get` on
# loom-models. Every write goes to loom-db-staging / loom-models-staging with
# --env staging. No other table is copied: staging holds no users, orders or
# any other personal data.
#
# Run from backend/:  bash scripts/staging-copy-catalogue.sh
# Needs migration 0022 (LOOM-165) on both prod and staging: it copies the
# per-product config columns.
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
COLS="id, slug, name_ru, name_en, name_uz, description_ru, description_uz, description_en, price, glb_key, thumbnail_key, base_colors, active, display_order, product_type, sizes_json, colors_json, print_area_json, flat_art_json, created_at, updated_at"

# 1. Read prod catalogue (read-only).
npx wrangler d1 execute loom-db --remote --json \
  --command "SELECT $COLS FROM products ORDER BY id" > "$WORK/products.json"

# 2. Build an upsert file + the list of referenced R2 keys.
python3 - "$WORK" "$COLS" <<'PY'
import json, sys
work, cols = sys.argv[1], [c.strip() for c in sys.argv[2].split(",")]
rows = json.load(open(f"{work}/products.json"))[0]["results"]
def lit(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
with open(f"{work}/products.sql", "w") as f:
    for r in rows:
        vals = ", ".join(lit(r[c]) for c in cols)
        upd = ", ".join(f"{c}=excluded.{c}" for c in cols if c != "id")
        f.write(f"INSERT INTO products ({', '.join(cols)}) VALUES ({vals}) "
                f"ON CONFLICT(id) DO UPDATE SET {upd};\n")
keys = sorted({r[k] for r in rows for k in ("glb_key", "thumbnail_key") if r[k]})
open(f"{work}/keys.txt", "w").write("\n".join(keys) + "\n")
print(f"products: {len(rows)} rows, {len(keys)} referenced objects")
PY

# 3. Write rows to staging.
npx wrangler d1 execute loom-db-staging --remote --env staging --yes --file "$WORK/products.sql"

# 4. Copy referenced objects loom-models -> loom-models-staging.
#    Thumbnails and GLBs both live in loom-models (see routes/admin-products.ts).
#    wrangler 3 `r2 object` targets the remote bucket by default (no --remote flag).
copied=0; missing=0
while read -r key; do
  [ -n "$key" ] || continue
  case "$key" in
    *.glb) ct=model/gltf-binary ;; *.jpg|*.jpeg) ct=image/jpeg ;;
    *.png) ct=image/png ;; *.webp) ct=image/webp ;; *) ct=application/octet-stream ;;
  esac
  out="$WORK/obj"
  rm -f "$out"
  if npx wrangler r2 object get "loom-models/$key" --file "$out" </dev/null >/dev/null 2>&1 && [ -s "$out" ]; then
    npx wrangler r2 object put "loom-models-staging/$key" --file "$out" --content-type "$ct" </dev/null >/dev/null
    copied=$((copied + 1)); echo "copied  $key"
  else
    missing=$((missing + 1)); echo "missing $key (not in loom-models)"
  fi
done < "$WORK/keys.txt"
echo "objects copied: $copied, missing in prod: $missing"
