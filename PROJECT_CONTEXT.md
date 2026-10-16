# PROJECT_CONTEXT.md

Обновлено: 2026-10-16.

## Проект и цель

SYNC — основное веб-приложение для кейса «Слушаем вместе» хакатона
«Время IT» 2026, ГУАП. Репозиторий: https://github.com/Sake14/SYNC,
рабочая ветка main. Рабочая папка: /Users/kirillzaitsev/Documents/SYNC.

Требование: внешний вид и пользовательское поведение собственного резервного
MVP воспроизводятся в SYNC. Эталон фиксирован:
Sake14/hakaton_MVP, коммит 83c42968d41af542b14489558c2b1a9e10ea0d75.
Исходники frontend совпадают с эталоном после замены @listen/shared на @sync/shared.
Происхождение и отличия описаны в docs/ORIGIN.md. Старые release-теги,
серверные адреса и результаты запусков MVP не относятся к SYNC.

## Сотрудничество и разрешения

Правила наставничества — AGENTS.md. По умолчанию MENTOR: объяснять по-русски,
учитывать отсутствие у разработчика знаний TypeScript, давать понятные небольшие
задания и проверять результат. Ускоренный режим разрешает готовые фрагменты
и использование кода своего MVP с объяснением и атрибуцией.

2026-10-16 пользователь явно изменил объём текущей задачи:
«перенеси все оставшиеся нужное в проект вплоть до девопс части и readme
подправь как основной проект ... и закомить и запушь все в гитхаб».
Это разрешение на IMPLEMENT в пределах завершения переноса: исходники,
зависимости, проверки, Docker/Compose/Caddy, CI, README и контекст, commit/push.
Пользователь взял на себя и frontend; прежнее разделение с напарником не действует.
После завершения этой задачи вернуться в MENTOR. Разрешение не является
бессрочным согласием на последующие изменения, Git-операции или удалённый деплой.
AGENTS.md сохранён. Новые чаты должны различать эту завершённую задачу
и новые запросы пользователя.

Постоянные ограничения: сохранять работу разработчика; не публиковать env,
ключи, токены, приватную музыку; не приписывать неподтверждённые проверки.
Вести PROJECT_CONTEXT.md разрешено, сохранять только актуальное состояние
и существенные решения, а не историю переписки целиком.

## Реализация

npm workspaces:
- apps/web: пакет web@0.1.0, Next.js 16.4.0 / React 19.3.0, App Router,
  TypeScript, Tailwind CSS 4.3.3 через PostCSS, Webpack, Zustand, qrcode,
  lucide-react, собственные UI primitives и Radix Slot.
- apps/server: @sync/server@0.1.0, Node.js, Express 5.3.0,
  Socket.IO 4.8.4, Zod, nanoid, music-metadata, multer, file-type.
- packages/shared: @sync/shared@1.0.0, типы, Zod-схемы, события протокола v4
  и чистая серверная временная шкала SyncEngine.
- tools/tests: TypeScript 5.9.3, ESLint 9.39.5, Vitest 5.0.3,
  Playwright 1.64.0. Node.js >=22.12.0, npm >=10; .nvmrc = 22.

Реализованы:
- Главная, быстрое создание комнаты, форма /create, /join/[roomId],
  /room/[roomId], /sync-lab, /music-services, темы и адаптивная вёрстка.
- Комнаты, участники, HOST, передача HOST/kick, приватные resumeToken,
  optimistic revision guards, очередь, реакции, readiness и reconnect.
- Каталог трёх оригинальных демо WAV; приватные загрузки и библиотека комнаты.
- HTTP Range/206/HEAD; Socket.IO передаёт команды/состояние, не аудиобайты.
- Валидация Zod, квоты/проверка фактических байтов, cleanup и лимиты комнат.
- HTMLAudioElement, clock offset, scheduled start, readiness barrier,
  drift correction и восстановление media-доступа через Next.js proxy/cookie.
- Native-профиль Apple: обычная скорость, штатный preservesPitch,
  без постоянной дробной коррекции. Аудиоэлемент переиспользуется.
- Учебные room-metadata.ts и room-store.ts сохранены дополнительно,
  основной runtime использует RoomManager.
- LocalMusicProvider работает; live API «Звука» не подключён, UNSUPPORTED.

Структура:
- apps/web/src/components — интерфейс; stores — состояние/Socket.IO.
- apps/web/src/hooks/use-audio-player.ts и lib/sync — браузерное аудио.
- apps/web/src/app/api и app/media — серверные Next.js proxy/авторизация.
- apps/server/src/app.ts — HTTP, server.ts — Socket.IO/lifecycle,
  index.ts — загрузка конфигурации и запуск; rooms/catalog/uploads/providers/transport.
- tests/e2e — реальные независимые BrowserContext и native media;
  tests/deployment — HTTP/TLS/Socket.IO smoke.
- docs — архитектура, API, протокол, алгоритм, тесты, demo, происхождение/лицензии.
- README.md — основной запуск и возможности; DEPLOY.md — Docker/HTTPS/обновление.

## Запуск и инфраструктура

Из корня:
- npm ci; npm run dev — генерация демо, shared build и три watchers.
- npm run build; npm start — production через Node.js.
- npm run lint; npm run typecheck; npm test.
- npm run test:e2e; npm run test:browsers.
- npm run test:deployment; npm run test:docker:e2e — для работающего Caddy.

Локальный Node: frontend localhost:3000, backend localhost:4000.
API_INTERNAL_URL по умолчанию http://127.0.0.1:4000.
Браузерные сокеты при обычном npm-запуске используют hostname страницы:4000.
Перед Node E2E освободить 3000/4000: Playwright сам запускает production-серверы.

Основной Compose — docker-compose.yml, проект sync-local.
Production — добавить docker-compose.production.yml, проект sync.
Локальный TLS — docker-compose.tls-test.yml, проект sync-tls-test.
Старые compose.yaml/compose.server.yaml и корневой Dockerfile резервного MVP
не перенесены: у SYNC один актуальный набор с Dockerfile каждого приложения.

Docker: Node 22.22.3-bookworm-slim, Caddy 2.11.7-alpine, multi-stage build,
standalone Next.js, non-root web/server, read-only root, healthchecks,
resource limits, log rotation, внутренние сети и отдельные volumes.
Caddy: /socket.io и /health в backend; остальные запросы, в том числе
/api и /media, через Next.js для приватной media cookie.
NEXT_PUBLIC_SOCKET_URL=/ в Docker build: браузер использует origin страницы.
Production требует собственного домена/DNS, ACME_EMAIL и свободных 80/443.

На машине разработчика резервный MVP уже занимает 8080, а другие его
проверочные установки — 18080/18081. Они не изменялись.
Для SYNC создан исключённый из Git .env.docker.local:
LOCAL_HTTP_PORT=18082, PUBLIC_ORIGIN=http://localhost:18082.
Основной sync-local запущен на этом адресе, все три сервиса healthy.
Отдельный TLS-проект проверен на 8443 и затем остановлен; volumes сохранены.
В системное хранилище доверия сертификаты не устанавливались.

Файлы media/*.wav и .data исключены из Git. Демо восстанавливаются
npm run media:demo. .env.example содержит только публичные примеры.
GitHub Actions ci.yml реагирует на main, PR и теги v*: lint/build/typecheck,
Vitest, production audit, Chromium E2E, browser matrix и Docker/TLS job.
Текущий перенос не является удалённой публикацией: сервер и домен для SYNC
пользователем не заданы.

## Проверки текущей задачи

Подтверждено локально 2026-10-16:
- npm install выполнен, lock обновлён; npm ci также прошёл при Docker build.
- npm run lint — код 0.
- npm run build — shared/backend/web собраны, код 0.
- npm run typecheck — все workspace и tools, код 0.
- npm test — 19 файлов, 187 тестов, код 0.
- npm audit --omit=dev — 0 уязвимостей.
- Полная установка сообщает 5 high в dev-зависимостях; force downgrade
  eslint-config-next не применялся.
- Docker build server/web — оба образа собраны.
- Compose local/production/tls-test config --quiet — код 0.
- npm run test:e2e — 38/38 desktop/mobile Chromium, код 0.
- Browser matrix — 28/28 в четырёх браузерных проектах, код 0.
- Docker browser E2E — 38/38 через Caddy на localhost:18082, код 0.
- HTTP deployment smoke через localhost:18082 — 5/5.
- HTTPS/WSS smoke через localhost:8443 с явным локальным CA — 5/5;
  проверка TLS оставалась включена.
- Визуально просмотрены desktop 1440 px и mobile 390 px;
  горизонтального переполнения нет; заголовок SYNC, каталог из трёх треков.
- 52 исходника web сравнены с git-объектами эталона: совпадают после
  замены имени shared.

Первый параллельный browser matrix дал 27/28: desktop WebKit зарегистрировал
одну паузу peer во время непрерывного аудио, при сохранённом ходе currentTime.
Три повторения пары диагностических WebKit-сценариев дали 6/6.
Причина единичного события не доказана. Для изоляции общего нативного
аудиовыхода сценарии test:browsers выполняются одним worker; слушатели внутри
каждого сценария остаются параллельными. Все исходные пределы позиции,
перемоток и пауз сохранены. Добавлен журнал native media events/AudioSession;
полный повтор матрицы прошёл: 28/28, Docker browser E2E — 38/38.
Актуальный итог будет записан в docs/VERIFICATION.md.

Полный перенос сохранён и отправлен в origin/main:
1424cac2cb73b680936ba9815b12d6a16f686aae,
feat: complete SYNC app and deployment setup. Рабочее дерево после push было чистым.
Первый GitHub CI подтвердил базовые проверки и 38 Chromium E2E, но один
Firefox-тест browser matrix захватил стартовую коррекцию позиции в измерении
скорости декодера. В Linux-контейнере проблема воспроизвелась (2/3 отказа).
Fixture теперь ждёт четыре секунды устойчивого native playback, затем сохраняет
исходное требование >1,8 с за 2,2 с. Код приложения не менялся.
После изменения 3/3 Linux Firefox и 4/4 целевых браузеров macOS прошли.
CI container job дополнен PulseAudio и выполняется независимо от host-browser job.
Результаты записаны в docs/VERIFICATION.md; текущий удалённый CI — Actions.

## Ограничения и следующий шаг

Map, комнаты, токены, очередь и библиотека не переживают backend restart.
Volume хранит байты аудио, не состояние комнаты. Один backend-процесс,
нет аккаунтов, постоянной БД и нескольких replicas.
Каждый браузер должен разрешить звук жестом; reload/отказ autoplay требуют
нового разрешения. Акустическая синхронность и настоящий iPhone в SYNC
не подтверждены этими автотестами; диагностика currentTime этого не заменяет.
Внешние музыкальные сервисы не являются частью рабочего аудиоканала.

Техническая часть IMPLEMENT завершена, все итоговые локальные проверки успешны.
Контрольная точка для сохранения: feat: complete SYNC app and deployment setup.
Пользователь разрешил commit/push этой точки в origin/main. Точные SHA и
состояние отправки читать из Git; не создавать повторный коммит автоматически.
Предыдущая сохранённая точка backend: 92c8df793b433214b9cf6f1426e577b5780643bc,
feat: add realtime backend, audio catalog and uploads — push подтверждён.
После сохранения: MENTOR и подготовка реальной демонстрации/публичного запуска
по новому запросу пользователя.
