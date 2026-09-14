# Personal Brand Threads Automation

Чистый локальный технический шаблон контент-пульта для личного бренда. Он выделен из ранее проверенной кодовой базы, но не содержит клиентского бренда, материалов, изображений, данных, аккаунтов, секретов или истории Git.

## Что сохранено

- Telegram Mini App: React, TypeScript и Vite.
- API: NestJS с Fastify adapter.
- PostgreSQL: черновики, версии, доступы, настройки, очередь и аудит.
- Redis/BullMQ: идемпотентная обработка публикаций.
- Отдельный worker и безопасный dry-run publisher.
- Тесты серверных инвариантов и touch/swipe-взаимодействий.
- Docker Compose для локального контура.

Это шаблон, а не подключённый продукт. Реальные публикации, сбор внешних данных и Telegram-бот отключены, пока не заданы отдельные credentials. `THREADS_DRY_RUN=true` обязателен для первоначального запуска.

## Быстрая локальная проверка без внешних API

Требуется Node.js 24+.

```bash
npm ci
npm --prefix miniapp ci
npm run typecheck
npm test
npm run build
npm run build:miniapp
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

## Настройка под личный бренд

Нейтральные значения `[BRAND_NAME]`, `[TOPIC_*]`, `[VOICE_PROFILE]` и визуальный placeholder нужно заменить после определения позиционирования. Не включайте реальные персональные или рыночные данные в seed-файлы и тестовые фикстуры.

Архитектурные решения, границы и критерии приёмки находятся в [docs/cto/PROJECT.md](./docs/cto/PROJECT.md).

## Статус

Локальный технический шаблон. Ничего не развёрнуто, реальные аккаунты не подключены, production/WebView-проверки не выполнены.
