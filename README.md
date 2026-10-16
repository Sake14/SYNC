# SYNC — слушаем вместе

[![CI](https://github.com/Sake14/SYNC/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Sake14/SYNC/actions/workflows/ci.yml)

Веб-приложение для синхронного прослушивания музыки на нескольких устройствах.
Проект для кейса «Слушаем вместе» хакатона **«Время IT» 2026, ГУАП**.

Создайте комнату, выберите трек и пригласите друзей по ссылке или QR.
Сервер задаёт общую временную шкалу, а каждый браузер воспроизводит аудио
через HTMLAudioElement и корректирует расхождение позиции.

## Возможности

- Создание комнаты без регистрации, вход по ссылке и QR, список участников.
- Общие play/pause/seek, роль HOST, передача роли и исключение участника.
- Каталог локальной музыки, общая очередь и приватная библиотека комнаты.
- Загрузка MP3/WAV/OGG/M4A с проверкой содержимого, прогрессом и квотами.
- Реакции, восстановление сессии после reconnect, диагностика /sync-lab.
- Личная громкость и mute, явное разрешение звука на каждом устройстве.
- Адаптивный интерфейс, Docker Compose, Caddy, HTTPS/WSS и GitHub Actions.

## Быстрый запуск

Нужны **Node.js 22.12+ и npm 10+**. В .nvmrc выбрана ветка Node.js 22.

```sh
git clone https://github.com/Sake14/SYNC.git
cd SYNC
npm ci
npm run dev
```

Откройте **http://localhost:3000**. Backend: http://localhost:4000/health,
каталог: http://localhost:4000/api/catalog.

Команда dev создаёт три оригинальных демотрека, собирает shared и запускает
watchers frontend/backend/shared. Файл .env необязателен: локальные настройки
работают по умолчанию. Для своих настроек скопируйте .env.example в .env.

Для запуска собранного приложения:

```sh
npm run build
npm start
```

## Как слушать вместе

1. Нажмите «Создать комнату» на главной. Создатель получает роль HOST.
2. Выберите композицию и отправьте ссылку приглашения либо покажите QR.
3. Друг открывает приглашение, вводит имя и присоединяется.
4. **На каждом устройстве** нажмите «Включить звук / Готов слушать».
5. Когда все активные слушатели готовы, HOST нажимает Play.
6. Любой участник может поставить паузу; перемотка и смена трека доступны HOST.
7. Добавляйте музыку в очередь, загружайте свои записи и отправляйте реакции.

Для проверки на одном компьютере используйте обычное и приватное окно браузера.
Перезагрузка страницы требует повторного разрешения звука.
Для телефона и публичной демонстрации используйте один адрес через Caddy: [DEPLOY.md](DEPLOY.md).

## Технологии и структура

| Часть | Технологии и ответственность |
| --- | --- |
| apps/web | Next.js 16, React 19, TypeScript, Tailwind CSS, Zustand, HTMLAudioElement |
| apps/server | Node.js, Express 5, Socket.IO, комнаты в Map, каталог и загрузки |
| packages/shared | Типы, Zod-схемы, контракты событий, серверная временная шкала |
| tests | Playwright: независимые браузерные сессии; smoke-проверки развёртывания |
| deploy/caddy | Единый origin, HTTP/HTTPS, Socket.IO/WebSocket и streaming proxy |

Socket.IO передаёт команды и состояние. Аудиофайлы загружаются по HTTP(S)
с поддержкой Range/206 и HEAD. Синхронизация использует оценку разницы часов,
отложенный общий старт, readiness, коррекцию drift и свежий snapshot после reconnect.
Подробности: [архитектура](docs/ARCHITECTURE.md), [алгоритм](docs/SYNC_ALGORITHM.md),
[API](docs/API.md), [протокол](docs/ROOM_PROTOCOL.md).

## Музыка и хранение

Команда npm run media:demo генерирует три WAV по 24 секунды без скачивания музыки.
Для общего каталога добавьте файлы в media и перезапустите backend.
Для добавления без перезапуска используйте загрузку внутри комнаты.
Подробности: [media/README.md](media/README.md).

По умолчанию: 20 MiB на файл, 100 MiB и 20 записей на комнату, 512 MiB на сервер.
Приватное аудио доступно активным участникам комнаты. Аудиофайлы, env-файлы,
загрузки и сертификаты исключены из Git.

**Комнаты, токены, очередь и библиотека находятся в памяти.** Рестарт backend
закрывает комнаты. Docker volume сохраняет байты загрузок, но не восстанавливает
состояние прежней комнаты. Базы данных и аккаунтов пока нет.

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

Перед браузерными тестами освободите 3000/4000: Playwright запускает production-процессы.
Команды для контейнеров и TLS: [DEPLOY.md](DEPLOY.md).
Состав тестов: [TESTING.md](docs/TESTING.md), результаты этой реализации:
[VERIFICATION.md](docs/VERIFICATION.md).

## Docker

При запущенном Docker Desktop / Docker Engine:

```sh
cp -n .env.example .env.docker.local
docker compose --env-file .env.docker.local -f docker-compose.yml build server
docker compose --env-file .env.docker.local -f docker-compose.yml build web
docker compose --env-file .env.docker.local -f docker-compose.yml up -d --wait --wait-timeout 180
```

По умолчанию адрес — **http://localhost:8080**. Если порт занят, измените
LOCAL_HTTP_PORT и PUBLIC_ORIGIN в .env.docker.local и используйте этот адрес.
Наружу опубликован только Caddy.
Production override включает HTTPS/WSS для вашего домена.
Окружение, обновление и откат: [DEPLOY.md](DEPLOY.md).
Готовая конфигурация не означает, что приложение уже опубликовано на сервере.

## Ограничения

- Физическая слышимость и точность звука зависят от браузера, устройства,
  Bluetooth и фонового режима; совпадение currentTime не является акустическим измерением.
- Safari/iOS используют профиль с обычной скоростью воспроизведения;
  Playwright не заменяет прослушивание на настоящем iPhone.
- Один backend-процесс; масштабирование требует общего хранилища состояния.
- Live API «Звука» не подключён: операции возвращают UNSUPPORTED.
  [Статус интеграции](docs/ZVUK_INTEGRATION.md).

## Документация и происхождение

- [Сценарий демонстрации](docs/DEMO.md), [поведение продукта](docs/PRODUCT_FLOW.md).
- [Развёртывание](DEPLOY.md), [проверки](docs/TESTING.md), [результаты](docs/VERIFICATION.md).
- [Происхождение реализации](docs/ORIGIN.md), [лицензии зависимостей](docs/THIRD_PARTY_LICENSES.md).
- AGENTS.md — правила сотрудничества; PROJECT_CONTEXT.md — состояние разработки.

Реализация развита на основе собственного проекта
[Sake14/hakaton_MVP](https://github.com/Sake14/hakaton_MVP/tree/83c42968d41af542b14489558c2b1a9e10ea0d75).
Основной репозиторий: **[Sake14/SYNC](https://github.com/Sake14/SYNC)**, ветка main.
