#!/bin/sh
set -eu

project_dir="${1:-/opt/personal-brand-threads}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 1
fi

if ! grep -q '^APIFY_API_TOKEN=apify_api_' "$env_file"; then
  echo 'Сначала подключите Apify API token.' >&2
  exit 1
fi

upsert_env() {
  threads_key="$1"
  threads_value="$2"
  threads_tmp="$env_file.tmp"
  threads_found=false
  umask 077
  while IFS= read -r threads_line || [ -n "$threads_line" ]; do
    case "$threads_line" in
      "$threads_key"=*)
        printf '%s=%s\n' "$threads_key" "$threads_value"
        threads_found=true
        ;;
      *) printf '%s\n' "$threads_line" ;;
    esac
  done < "$env_file" > "$threads_tmp"
  if [ "$threads_found" = false ]; then
    printf '%s=%s\n' "$threads_key" "$threads_value" >> "$threads_tmp"
  fi
  mv "$threads_tmp" "$env_file"
}

upsert_env APIFY_ACTOR_ID apify/google-search-scraper
upsert_env APIFY_MARKET_ENABLED true
upsert_env APIFY_DAILY_MAX_RESULTS 10
upsert_env APIFY_TEST_RUN_LIMIT 9
chmod 600 "$env_file"

echo 'Ежедневный мониторинг рынка включён в тестовом режиме.'
echo 'Лимит: 10 зарубежных поисковых страниц в сутки (по одной на направление).'
