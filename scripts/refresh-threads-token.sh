#!/bin/sh
set -eu

project_dir="${1:-/opt/threads-personal-brand}"
env_file="$project_dir/.env"
lock_dir="$project_dir/.threads-token-refresh.lock"

if [ ! -f "$env_file" ]; then
  echo "Не найден $env_file" >&2
  exit 1
fi
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo 'Обновление Threads-токена уже выполняется.' >&2
  exit 0
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT HUP INT TERM

set -a
. "$env_file"
set +a
if [ -z "${THREADS_ACCESS_TOKEN:-}" ]; then
  echo 'THREADS_ACCESS_TOKEN не настроен.' >&2
  exit 1
fi

response="$(curl --silent --show-error --fail \
  --get \
  --header "Authorization: Bearer $THREADS_ACCESS_TOKEN" \
  --data-urlencode 'grant_type=th_refresh_token' \
  'https://graph.threads.net/refresh_access_token')" || {
    echo 'Meta не обновила Threads-токен. Старый токен сохранён.' >&2
    exit 1
  }

new_token="$(printf '%s' "$response" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
expires_in="$(printf '%s' "$response" | sed -n 's/.*"expires_in"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
if [ -z "$new_token" ]; then
  unset response
  echo 'Meta не вернула новый Threads-токен. Старый токен сохранён.' >&2
  exit 1
fi

profile="$(curl --silent --show-error --fail \
  --get \
  --header "Authorization: Bearer $new_token" \
  --data-urlencode 'fields=id,username' \
  'https://graph.threads.net/v1.0/me')" || {
    unset new_token response
    echo 'Новый Threads-токен не прошёл проверку. Старый токен сохранён.' >&2
    exit 1
  }
username="$(printf '%s' "$profile" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ "$username" != 'maks.eremenkoo' ]; then
  unset new_token response profile
  echo 'Новый токен относится не к профилю maks.eremenkoo. Старый токен сохранён.' >&2
  exit 1
fi

upsert_env() {
  key="$1"
  value="$2"
  tmp="$env_file.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
}

now="$(date +%s)"
expires_at="$((now + ${expires_in:-5184000}))"
upsert_env THREADS_ACCESS_TOKEN "$new_token"
upsert_env THREADS_TOKEN_REFRESHED_AT "$now"
upsert_env THREADS_TOKEN_EXPIRES_AT "$expires_at"
chmod 600 "$env_file"

unset THREADS_ACCESS_TOKEN new_token response profile
cd "$project_dir"
docker compose up -d --force-recreate api worker
echo "Threads-токен обновлён; срок продлён примерно на ${expires_in:-5184000} секунд."
