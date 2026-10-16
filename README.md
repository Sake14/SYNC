# SYNC — слушаем вместе

[![CI](https://github.com/Sake14/SYNC/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sake14/SYNC/actions/workflows/ci.yml)

Веб-приложение для совместного прослушивания музыки. Проект для кейса
«Слушаем вместе» хакатона «Время IT» 2026, ГУАП.

Создавайте комнаты, приглашайте друзей по ссылке или QR, выбирайте музыку
из каталога или загружайте свои файлы. Общие воспроизведение, пауза, перемотка,
очередь и реакции работают в реальном времени.

## Запуск

Нужны Node.js 22.12+ и npm 10+.

```sh
git clone https://github.com/Sake14/SYNC.git
cd SYNC
npm ci
npm run dev
```

Приложение: **http://localhost:3000**. Backend: **http://localhost:4000/health**.
Три демотрека создаются автоматически. Настройки по умолчанию работают без .env;
при необходимости скопируйте .env.example в .env.

Для запуска собранной версии:

```sh
npm run build
npm start
```

Создайте комнату, выберите трек и откройте приглашение на втором устройстве
или в приватном окне. На каждом устройстве нажмите «Включить звук / Готов слушать»,
затем HOST запускает воспроизведение. Любой участник может поставить паузу;
перемотка и смена композиции доступны HOST.

## Структура

| Каталог | Назначение |
| --- | --- |
| apps/web | Next.js, React, Tailwind CSS, Zustand, браузерный аудиоплеер |
| apps/server | Express, Socket.IO, комнаты, каталог и загрузки |
| packages/shared | Общие типы, Zod-схемы и контракты событий |
| tests | Браузерные тесты и проверки развёртывания |
| deploy/caddy | HTTP/HTTPS и WebSocket proxy |

Сервер хранит состояние комнаты и задаёт общую временную шкалу. Socket.IO
передаёт команды и состояние, аудио загружается по HTTP с поддержкой Range.
Браузеры оценивают разницу часов, согласуют готовность и корректируют позицию.

## Проверки

```sh
npm run lint
npm run build
npm run typecheck
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:browsers
```

Playwright запускает приложение сам: порты 3000 и 4000 должны быть свободны.
Unit-тесты расположены рядом с исходниками. GitHub Actions также проверяет
контейнеры, HTTP, HTTPS/WSS и воспроизведение в нескольких браузерах.

## Docker

Нужны Docker и Compose 2.24.4+.

```sh
cp -n .env.example .env.docker.local
docker compose --env-file .env.docker.local -f docker-compose.yml build server
docker compose --env-file .env.docker.local -f docker-compose.yml build web
docker compose --env-file .env.docker.local -f docker-compose.yml up -d --wait --wait-timeout 180
```

Адрес по умолчанию: **http://localhost:8080**. Если порт занят, измените
LOCAL_HTTP_PORT и PUBLIC_ORIGIN в .env.docker.local. Для доступа с телефона
в той же сети задайте LOCAL_BIND_ADDRESS=0.0.0.0 и PUBLIC_ORIGIN с LAN-IP компьютера.

Для публичного HTTPS нужен домен, направленный на сервер, и открытые порты 80/443.
Скопируйте .env.example в .env.docker.production, заполните SYNC_DOMAIN
(домен без https://) и ACME_EMAIL, затем выполните:

```sh
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml build server
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml build web
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml up -d --wait --wait-timeout 180
```

Caddy получает сертификат автоматически. Проверьте https://ваш-домен/health.
Для обновления повторите сборку и запуск; для остановки используйте stop
с теми же параметрами Compose. Docker volumes сохраняют загрузки и сертификаты.

Проверки работающего локального стека:

```sh
npm run build -w @sync/shared
npm run test:deployment
npm run test:docker:e2e
```

Если адрес отличается от http://localhost:8080, задайте SYNC_TEST_URL.

## Хранение и ограничения

Общий каталог читается из media; после добавления файлов перезапустите backend.
Для добавления музыки без перезапуска используйте загрузку внутри комнаты.
Лимиты по умолчанию: 20 MiB на файл, 100 MiB на комнату, 512 MiB на сервер.
Музыка, загрузки и локальные настройки исключены из Git.

Комнаты, сессии и очередь хранятся в памяти одного backend-процесса и исчезают
при его перезапуске. Базы данных нет. Звук нужно разрешать на каждом устройстве;
точность зависит от браузера, фонового режима и аудиоустройства.
Интеграция с live API «Звука» пока недоступна.

[Лицензии сторонних зависимостей](THIRD_PARTY_LICENSES.md).
