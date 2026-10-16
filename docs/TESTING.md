# Проверки SYNC

Все команды выполняются из корня. Нужны Node.js 22.12+ и npm 10+.

```sh
npm ci
npm run lint
npm run build
npm run typecheck
npm test
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:browsers
```

build сначала собирает shared, затем backend и frontend. typecheck
проверяет все workspace и инструменты тестирования. ESLint работает
по общей конфигурации в корне, включая React/Next.js.

## Vitest

Unit/integration-тесты проверяют Zod-контракты, временную шкалу,
RoomManager, readiness, права и revision, Socket.IO, каталог, HTTP Range,
uploads, провайдеры и браузерные модули синхронизации. Сетевые тесты
создают временные серверы на localhost; открытие портов должно быть разрешено.
test:watch запускает Vitest в режиме наблюдения.

## Playwright

Перед запуском освободите 3000/4000. Конфигурация запускает собранные
production-процессы и завершает их после набора тестов.
Тесты используют независимые BrowserContext, настоящий HTMLAudioElement,
HTTP-аудио, приватные загрузки, QR, реакции, очередь и reconnect.

- test:e2e — desktop/mobile Chromium и продуктовые сценарии.
- test:browsers — регрессии Chromium, Firefox, WebKit и mobile WebKit.
- test:docker:e2e — тот же продукт через уже запущенный Caddy/Compose.

Матрица test:browsers выполняет сценарии одним worker: они используют общий
нативный аудиовыход ОС. Внутри сценария независимые слушатели по-прежнему
воспроизводят звук одновременно. AudioSession playback может прерываться
другой сессией; это описано в [рабочем проекте W3C](https://www.w3.org/TR/audio-session/).
Непрерывное аудио проверяется с исходными пределами пауз, перемоток и позиции;
при сбое сохраняется журнал native media events и состояния AudioSession.

Неудачные проверки сохраняют trace в test-results; эти файлы исключены из Git.
На Linux нативным аудиотестам нужен рабочий вывод звука. GitHub Actions
запускает PulseAudio с null sink; установка браузеров выполняется с --with-deps.

Эмуляция браузера и измерение currentTime не подтверждают слышимость на
физическом iPhone, Bluetooth-задержку или поведение заблокированного телефона.

## Развёртывание и CI

test:deployment проверяет HTTP/HTTPS, Range/HEAD, uploads/cookie,
лимиты тела, membership, отказ постороннему Origin и polling → WebSocket.
Локальный TLS использует явно переданный CA без отключения проверки сертификата.
Команды: [DEPLOY.md](../DEPLOY.md).

GitHub Actions запускает lint, build, typecheck, Vitest, production audit,
браузерные наборы и отдельный job с Docker/Caddy и HTTPS/WSS.
Результаты локального запуска: [VERIFICATION.md](VERIFICATION.md).
