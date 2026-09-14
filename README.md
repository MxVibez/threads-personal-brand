# Максим: Threads Content Workspace

Личный контент-пульт Максима для привлечения клиентов из Threads на разработку Telegram Mini Apps, приложений для мессенджеров, веб-, iOS- и Android-продуктов, AI-аватаров и AI-блогеров.

## Что сохранено

- Telegram Mini App: React, TypeScript и Vite.
- API: NestJS с Fastify adapter.
- PostgreSQL: черновики, версии, доступы, настройки, очередь и аудит.
- Redis/BullMQ: идемпотентная обработка публикаций.
- Отдельный worker и безопасный dry-run publisher.
- Тесты серверных инвариантов и touch/swipe-взаимодействий.
- Docker Compose для локального контура.

Рабочий контур: материал появляется в Telegram Mini App, Максим одобряет его и выбирает время, после чего worker автоматически публикует ветку. Реальные публикации, сбор внешних данных и Telegram-бот отключены, пока не заданы отдельные credentials. `THREADS_DRY_RUN=true` обязателен для первоначального запуска.

## Быстрая локальная проверка без внешних API

Требуется Node.js 24+.

```bash
npm ci
npm --prefix miniapp ci
npm run typecheck
npm test
npm run build
npm run build:miniapp
npm run audit:repo
```

Для запуска полного локального контура:

```bash
cp .env.example .env
docker compose up --build
```

Перед запуском Compose замените локальный пароль PostgreSQL в `.env`. Не добавляйте `.env` в Git.

## Безопасные значения по умолчанию

- Apify monitoring выключен: `APIFY_MARKET_ENABLED=false`.
- Threads publishing работает только в dry-run: `THREADS_DRY_RUN=true`.
- Все Telegram, Meta Threads, Apify и OpenAI credentials читаются только сервером.
- Mini App не получает provider tokens и не хранит bearer credentials в browser storage.
- Демонстрационный материал создаётся только явной командой `/demo` при включённом Telegram-контуре.

## Контент и воронка

Стартовые темы и голос уже настроены под услуги Максима. Публикации ведут к одному из трёх кодовых слов: `РАЗБОР`, `АВАТАР`, `ПЕРСОНАЖ`. До включения live-режима нужно добавить настоящий Threads username, Telegram-ссылку, разрешённый аватар и примеры авторских текстов.

Архитектурные решения, границы и критерии приёмки находятся в [docs/cto/PROJECT.md](./docs/cto/PROJECT.md).
Контентные опоры, CTA и ограничения находятся в [docs/cto/CONTENT_STRATEGY.md](./docs/cto/CONTENT_STRATEGY.md).

GitHub Actions повторяет typecheck, тесты, production build и аудит tracked-файлов для `main` и pull request.

## Статус

Персонализированная основа развёрнута на отдельном VPS Timeweb Cloud в безопасном dry-run режиме:

- Mini App: <https://217-149-26-19.sslip.io/miniapp/>
- health check: <https://217-149-26-19.sslip.io/api/health/ready>
- Debian 13, Docker Compose, 2 ГБ swap, HTTPS через Caddy/Let's Encrypt.

Контейнеры и HTTPS проверены 2026-09-14. Telegram-бот и Meta Threads ещё не подключены; реальный Telegram WebView и live-публикация не проверены.
