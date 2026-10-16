# Результаты проверки SYNC

Дата: 2026-10-16. Это результаты данного репозитория, а не резервного MVP.
Среда: macOS, Node.js 22.22.3, npm 10.9.8, Docker Desktop / Linux-контейнеры,
Compose v5.0.0. Production frontend собирается с Webpack.

## Выполненные проверки

| Проверка | Результат |
| --- | --- |
| npm install | Установка успешна, lock обновлён |
| npm ci в Docker build | Успешно, включая backend-only production install |
| npm run lint | Код 0; повторён после изменений тестовой диагностики |
| npm run build | Shared, backend и Next.js собраны, код 0 |
| npm run typecheck | Все workspace и tools, код 0; повторён после изменения тестов |
| npm test | 19 файлов, 187 тестов, код 0 |
| npm audit --omit=dev | 0 уязвимостей |
| Compose config local/production/tls-test | Код 0 во всех трёх режимах |
| Docker build server/web | Оба образа собраны на Node 22.22.3 |
| Node production E2E | 38/38 desktop/mobile Chromium, код 0 |
| Browser matrix | 28/28 Chromium, Firefox, WebKit, mobile WebKit, код 0 |
| HTTP deployment smoke через Caddy | 5/5 на localhost:18082 |
| HTTPS/WSS deployment smoke | 5/5 на localhost:8443, явный локальный CA |
| Docker browser E2E | 38/38 desktop/mobile Chromium через Caddy, код 0 |
| Desktop/mobile UI | Визуально просмотрены 1440/390 px, нет горизонтального overflow |
| Сверка браузерных исходников | Все 52 файла совпадают с эталоном после переименования shared |

Сценарии используют настоящие HTMLAudioElement и независимые BrowserContext:
создание/приглашение, QR, readiness, общий старт, pause/seek, непрерывный native
playback, смена трека, роли, реакции, очередь, приватные uploads и reconnect.
Deployment smoke проверяет Range/HEAD и байты WAV, cookie и доступ к приватному
аудио, лимит тела, сторонний Origin, polling → WebSocket и двух клиентов.

HTTPS проверен с включённой проверкой сертификата и явно переданным публичным
сертификатом локального CA. Системное доверие не менялось. Это проверка local
TLS/WSS, не публичного ACME или домена.

## Единичная пауза WebKit и изоляция тестов

Первый параллельный browser matrix дал 27/28: в desktop WebKit один peer
зарегистрировал одно событие pause при сохранённом ходе currentTime.
Точная причина события не доказана. Три повтора пары диагностических WebKit-тестов
дали 6/6. Матрица переведена на один worker, чтобы исключить влияние независимых
сценариев на общий нативный аудиовыход ОС; повтор всей матрицы дал 28/28.

Несколько слушателей внутри сценария продолжают работать одновременно.
Исходные пределы drift, seek и pause не изменены; native play/pause не подменяются
ради прохождения проверки. Добавлен журнал media events и состояния AudioSession.
Возможность прерывания playback другой сессией описана в
[рабочем проекте W3C](https://www.w3.org/TR/audio-session/).
Эта мера изоляции не является доказательством причины первоначального события.

## Текущее локальное окружение

Основной Compose-проект sync-local оставлен запущенным: web/server/Caddy healthy.
Адрес — http://localhost:18082. В исключённом из Git .env.docker.local порт изменён,
поскольку 8080 занят резервным MVP. Остальные его проекты и volumes не менялись.

TLS-проект sync-tls-test после проверки остановлен, его volumes сохранены.
Скриншоты и browser traces не коммитятся. Демо WAV и приватные загрузки
исключены из Git; демо восстанавливаются npm run media:demo.

## Границы результатов

- Установка сообщает 5 high в dev-зависимостях. Production audit чистый.
  Принудительное понижение eslint-config-next через audit fix --force не выполнялось.
- Совпадение currentTime и native playback не измеряет акустическую задержку.
  Реальный iPhone, Bluetooth и заблокированный экран требуют отдельного прослушивания.
- Публичное развёртывание не выполнялось: домен/сервер SYNC пользователем не заданы.
- GitHub Actions настроен на main/PR; его результаты доступны во вкладке Actions.
  Локальные результаты не означают, что удалённый CI уже завершился.
