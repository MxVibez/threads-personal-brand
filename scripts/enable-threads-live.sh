#!/bin/sh
set -eu

project_dir="${1:-/opt/threads-personal-brand}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Не найден $env_file" >&2
  exit 1
fi

if ! grep -q '^THREADS_USER_ID=[0-9][0-9]*$' "$env_file" || ! grep -q '^THREADS_ACCESS_TOKEN=..' "$env_file"; then
  echo 'Сначала подключите Threads через scripts/configure-threads.sh.' >&2
  exit 1
fi

threads_tmp="$env_file.tmp"
awk '
  /^THREADS_DRY_RUN=/ { print "THREADS_DRY_RUN=false"; found = 1; next }
  { print }
  END { if (!found) print "THREADS_DRY_RUN=false" }
' "$env_file" > "$threads_tmp"
chmod 600 "$threads_tmp"
mv "$threads_tmp" "$env_file"

cd "$project_dir"
docker compose up -d --force-recreate api worker
echo 'Реальная публикация в Threads включена.'
