#!/bin/sh
set -eu

project_dir="${1:-/opt/personal-brand-threads}"
app_domain="${2:?Usage: bootstrap-test-env.sh PROJECT_DIR APP_DOMAIN}"
env_file="$project_dir/.env"

if [ -e "$env_file" ]; then
  echo "Environment file already exists: $env_file" >&2
  exit 1
fi

app_db_password="$(openssl rand -hex 24)"
app_webhook_secret="$(openssl rand -hex 24)"
app_apify_secret="$(openssl rand -hex 24)"
app_encryption_key="$(openssl rand -hex 32)"

umask 077
{
  printf '%s\n' \
    'NODE_ENV=production' \
    'PORT=3000' \
    "APP_BASE_URL=https://$app_domain" \
    "APP_DOMAIN=$app_domain" \
    '' \
    "DATABASE_URL=postgresql://personal_brand:$app_db_password@postgres:5432/personal_brand" \
    'REDIS_URL=redis://redis:6379' \
    'POSTGRES_DB=personal_brand' \
    'POSTGRES_USER=personal_brand' \
    "POSTGRES_PASSWORD=$app_db_password" \
    '' \
    'TELEGRAM_BOT_TOKEN=' \
    "TELEGRAM_WEBHOOK_SECRET=$app_webhook_secret" \
    'EXPERT_TELEGRAM_IDS=' \
    '' \
    'THREADS_API_BASE_URL=https://graph.threads.net' \
    'THREADS_API_VERSION=v1.0' \
    'META_THREADS_APP_ID=' \
    'META_THREADS_APP_SECRET=' \
    'THREADS_USER_ID=' \
    'THREADS_ACCESS_TOKEN=' \
    'THREADS_DRY_RUN=true' \
    '' \
    'OPENAI_API_KEY=' \
    'OPENAI_CLASSIFIER_MODEL=gpt-5.6-luna' \
    'OPENAI_WRITER_MODEL=gpt-5.6-terra' \
    '' \
    'APIFY_API_TOKEN=' \
    'APIFY_ACTOR_ID=' \
    "APIFY_WEBHOOK_SECRET=$app_apify_secret" \
    '' \
    "APP_ENCRYPTION_KEY=$app_encryption_key"
} > "$env_file"

chmod 600 "$env_file"
echo "Created $env_file for https://$app_domain"
