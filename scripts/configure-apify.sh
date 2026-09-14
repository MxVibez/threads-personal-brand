#!/bin/sh
set -eu

project_dir="${1:-/opt/personal-brand-threads}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo 'На сервере не найден curl. Настройки не изменены.' >&2
  exit 1
fi

restore_echo() {
  stty echo 2>/dev/null || true
}
trap restore_echo EXIT INT TERM

printf 'Вставьте Apify API token (он не будет виден): ' >&2
stty -echo
IFS= read -r threads_apify_token
stty echo
printf '\n' >&2

case "$threads_apify_token" in
  apify_api_*) ;;
  *)
    echo 'Токен не похож на Apify API token. Настройки не изменены.' >&2
    exit 1
    ;;
esac

printf 'Проверяю токен Apify...\n' >&2
token_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 20 \
  --header "Authorization: Bearer $threads_apify_token" \
  'https://api.apify.com/v2/users/me')

if [ "$token_status" != '200' ]; then
  echo "Apify отклонил токен, HTTP $token_status. Настройки не изменены." >&2
  exit 1
fi

threads_tmp_file="$env_file.tmp"
umask 077
token_written=false

while IFS= read -r threads_line || [ -n "$threads_line" ]; do
  case "$threads_line" in
    APIFY_API_TOKEN=*)
      printf 'APIFY_API_TOKEN=%s\n' "$threads_apify_token"
      token_written=true
      ;;
    *)
      printf '%s\n' "$threads_line"
      ;;
  esac
done < "$env_file" > "$threads_tmp_file"

if [ "$token_written" = false ]; then
  printf 'APIFY_API_TOKEN=%s\n' "$threads_apify_token" >> "$threads_tmp_file"
fi
mv "$threads_tmp_file" "$env_file"
chmod 600 "$env_file"
unset threads_apify_token

cd "$project_dir"
docker compose up -d --no-deps --force-recreate api worker

echo 'Apify API подключён. Actor и сбор данных пока не настроены.'
echo 'Деньги не списываются: скрипт только проверил и сохранил токен.'
