#!/usr/bin/env bash
# Prints the edge functions a range of commits touches, one per line:
#   * every function whose own folder changed, and
#   * every function that imports a changed part of _shared/ (by its
#     top-level entry, e.g. _shared/px-tools/ or _shared/cors.ts).
# Only folders with an index.ts are functions. Used by
# .github/workflows/deploy-edge-functions.yml.
# Usage: scripts/changed-edge-functions.sh <base-sha> <head-sha>
set -euo pipefail
base="$1"; head="$2"
fn_root="supabase/functions"

changed=$(git diff --name-only "$base" "$head" -- "$fn_root")

{
  # Function folders that changed directly.
  echo "$changed" | awk -F/ 'NF >= 4 && $3 != "_shared" { print $3 }'

  # Functions that import a changed shared module.
  echo "$changed" | awk -F/ 'NF >= 4 && $3 == "_shared" { print $4 }' | sort -u | while read -r entry; do
    [ -n "$entry" ] || continue
    grep -rlF --include='*.ts' "_shared/$entry" "$fn_root" 2>/dev/null \
      | awk -F/ '$3 != "_shared" { print $3 }'
  done
} | sort -u | while read -r fn; do
  [ -n "$fn" ] && [ -f "$fn_root/$fn/index.ts" ] && echo "$fn"
done
