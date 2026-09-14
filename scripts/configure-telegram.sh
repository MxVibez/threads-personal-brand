#!/bin/sh
set -eu

project_dir="${1:-/opt/personal-brand-threads}"
env_file="$project_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 1
fi

restore_echo() {
  stty echo 2>/dev/null || true
}
trap restore_echo EXIT INT TERM

printf 'Вставьте токен Telegram-бота (он не будет виден): ' >&2
stty -echo
IFS= read -r threads_telegram_token
stty echo
printf '\n' >&2

case "$threads_telegram_token" in
  [0-9]*:[A-Za-z0-9_-]*) ;;
  *)
    echo 'Токен не похож на токен BotFather. Настройки не изменены.' >&2
    exit 1
    ;;
esac

printf 'Введите числовой Telegram ID эксперта: ' >&2
IFS= read -r threads_expert_id
case "$threads_expert_id" in
  ''|*[!0-9]*)
    echo 'Telegram ID должен состоять только из цифр. Настройки не изменены.' >&2
    exit 1
    ;;
esac

threads_tmp_file="$env_file.tmp"
umask 077
while IFS= read -r threads_line || [ -n "$threads_line" ]; do
  case "$threads_line" in
    TELEGRAM_BOT_TOKEN=*)
      printf 'TELEGRAM_BOT_TOKEN=%s\n' "$threads_telegram_token"
      ;;
    EXPERT_TELEGRAM_IDS=*)
      printf 'EXPERT_TELEGRAM_IDS=%s\n' "$threads_expert_id"
      ;;
    *)
      printf '%s\n' "$threads_line"
      ;;
  esac
done < "$env_file" > "$threads_tmp_file"

mv "$threads_tmp_file" "$env_file"
chmod 600 "$env_file"
unset threads_telegram_token

cd "$project_dir"
docker compose up -d --force-recreate api worker
docker compose run --rm api node scripts/register-telegram-webhook.mjs

echo 'Telegram-бот подключён. Откройте его и отправьте /start, затем /demo.'
