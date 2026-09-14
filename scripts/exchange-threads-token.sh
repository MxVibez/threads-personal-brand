#!/bin/sh
set -eu

project_dir="${1:-/opt/threads-personal-brand}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Не найден $env_file" >&2
  exit 1
fi

restore_echo() {
  stty echo 2>/dev/null || true
}

trap restore_echo EXIT HUP INT TERM
printf 'Вставьте краткосрочный Threads Access Token из Graph API Explorer (не будет виден): ' >&2
stty -echo
IFS= read -r short_token
stty echo
printf '\nВставьте Threads App Secret (не будет виден): ' >&2
stty -echo
IFS= read -r app_secret
stty echo
trap - EXIT HUP INT TERM
printf '\nОбмениваю токен и проверяю разрешения…\n' >&2

if [ -z "$short_token" ] || [ -z "$app_secret" ]; then
  unset short_token app_secret
  echo 'Токен и App Secret не могут быть пустыми.' >&2
  exit 1
fi

exchange_response="$(curl --silent --show-error --fail \
  --get \
  --data-urlencode 'grant_type=th_exchange_token' \
  --data-urlencode "client_secret=$app_secret" \
  --data-urlencode "access_token=$short_token" \
  'https://graph.threads.net/access_token')" || {
    unset short_token app_secret
    echo 'Meta не обменяла токен. Настройки не изменены.' >&2
    exit 1
  }

long_token="$(printf '%s' "$exchange_response" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
expires_in="$(printf '%s' "$exchange_response" | sed -n 's/.*"expires_in"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p')"
if [ -z "$long_token" ]; then
  unset short_token app_secret exchange_response
  echo 'Meta не вернула долгосрочный токен. Настройки не изменены.' >&2
  exit 1
fi

profile_response="$(curl --silent --show-error --fail \
  --get \
  --header "Authorization: Bearer $long_token" \
  --data-urlencode 'fields=id,username' \
  'https://graph.threads.net/v1.0/me')" || {
    unset short_token long_token app_secret exchange_response
    echo 'Долгосрочный токен не прошёл проверку профиля. Настройки не изменены.' >&2
    exit 1
  }

threads_user_id="$(printf '%s' "$profile_response" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)".*/\1/p')"
threads_username="$(printf '%s' "$profile_response" | sed -n 's/.*"username"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$threads_user_id" ] || [ "$threads_username" != 'maks.eremenkoo' ]; then
  unset short_token long_token app_secret exchange_response profile_response
  echo 'Токен относится не к ожидаемому профилю maks.eremenkoo. Настройки не изменены.' >&2
  exit 1
fi

curl --silent --show-error --fail \
  --get \
  --header "Authorization: Bearer $long_token" \
  --data-urlencode 'q=стоматология' \
  --data-urlencode 'search_type=RECENT' \
  --data-urlencode 'fields=id,text,permalink,timestamp,username' \
  --data-urlencode 'limit=1' \
  'https://graph.threads.net/v1.0/keyword_search' >/dev/null || {
    unset short_token long_token app_secret exchange_response profile_response
    echo 'У токена нет рабочего доступа threads_keyword_search. Настройки не изменены.' >&2
    exit 1
  }

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
upsert_env META_THREADS_APP_SECRET "$app_secret"
upsert_env THREADS_USER_ID "$threads_user_id"
upsert_env THREADS_ACCESS_TOKEN "$long_token"
upsert_env THREADS_DRY_RUN true
upsert_env THREADS_MARKET_ENABLED true
chmod 600 "$env_file"

unset short_token long_token app_secret exchange_response profile_response
cd "$project_dir"
docker compose up -d --build --force-recreate api worker
echo "Threads подключён долгосрочным токеном${expires_in:+ (срок в секундах: $expires_in)}. Поиск тем включён; публикация остаётся под контролем."
