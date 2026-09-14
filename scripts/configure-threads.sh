#!/bin/sh
set -eu

project_dir="${1:-/opt/threads-personal-brand}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Не найден $env_file" >&2
  exit 1
fi

printf 'Вставьте долгосрочный Threads Access Token (не будет виден): ' >&2
trap 'stty echo 2>/dev/null || true' EXIT HUP INT TERM
stty -echo
IFS= read -r threads_access_token
stty echo
trap - EXIT HUP INT TERM
printf '\nПроверяю доступ к Threads API…\n' >&2

[ -n "$threads_access_token" ] || {
  echo 'Токен не может быть пустым.' >&2
  exit 1
}

threads_response="$(curl --silent --show-error --fail \
  --get \
  --header "Authorization: Bearer $threads_access_token" \
  --data-urlencode 'fields=id,username' \
  'https://graph.threads.net/v1.0/me')" || {
    unset threads_access_token
    echo 'Threads отклонил токен. Настройки не изменены.' >&2
    exit 1
  }

threads_user_id="$(printf '%s' "$threads_response" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)".*/\1/p')"
if [ -z "$threads_user_id" ]; then
  unset threads_access_token threads_response
  echo 'Threads API не вернул числовой ID пользователя. Настройки не изменены.' >&2
  exit 1
fi

upsert_env() {
  threads_key="$1"
  threads_value="$2"
  threads_tmp="$env_file.tmp"
  awk -v key="$threads_key" -v value="$threads_value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$env_file" > "$threads_tmp"
  chmod 600 "$threads_tmp"
  mv "$threads_tmp" "$env_file"
}

upsert_env META_THREADS_APP_ID 1087966097033130
upsert_env THREADS_USER_ID "$threads_user_id"
upsert_env THREADS_ACCESS_TOKEN "$threads_access_token"
upsert_env THREADS_DRY_RUN true
upsert_env THREADS_MARKET_ENABLED true
chmod 600 "$env_file"

unset threads_access_token threads_response
cd "$project_dir"
docker compose up -d --force-recreate api worker
echo 'Threads подключён. Поиск тем включён; публикация оставлена под контролем до первого проверочного поста.'
