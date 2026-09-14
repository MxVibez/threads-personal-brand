#!/bin/sh
set -eu

project_dir="${1:-/opt/threads-personal-brand}"
backup_dir="$project_dir/backups/postgres"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/threads-$timestamp.dump"
temporary="$target.tmp"

mkdir -p "$backup_dir"
chmod 700 "$project_dir/backups" "$backup_dir"
cd "$project_dir"

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT HUP INT TERM

docker compose exec -T postgres sh -lc \
  'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$temporary"
test -s "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$target"
trap - EXIT HUP INT TERM

find "$backup_dir" -type f -name 'threads-*.dump' -mtime +7 -delete
echo "Резервная копия PostgreSQL создана: $target"
