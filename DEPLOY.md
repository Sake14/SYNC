# Развёртывание SYNC

Сервисы: Express/Socket.IO server, Next.js standalone web, Caddy reverse-proxy.
Команды выполняются из корня SYNC. Нужны Docker Engine / Docker Desktop
и Compose 2.24.4+ с поддержкой !override.

## Локальный HTTP

Создайте отдельный файл настроек, если его ещё нет:

```sh
cp -n .env.example .env.docker.local
docker compose --env-file .env.docker.local -f docker-compose.yml config --quiet
docker compose --env-file .env.docker.local -f docker-compose.yml build server
docker compose --env-file .env.docker.local -f docker-compose.yml build web
docker compose --env-file .env.docker.local -f docker-compose.yml up -d --wait --wait-timeout 180
docker compose --env-file .env.docker.local -f docker-compose.yml ps
curl --fail http://localhost:8080/health
curl --fail http://localhost:8080/api/health
```

Откройте **http://localhost:8080**. Compose-проект — sync-local.
Только Caddy публикует порт; frontend/backend находятся во внутренней сети.
Имена и volumes не совпадают с резервным MVP.

Для телефона в одной сети задайте в .env.docker.local:

```dotenv
LOCAL_BIND_ADDRESS=0.0.0.0
LOCAL_HTTP_PORT=8080
PUBLIC_ORIGIN=http://192.168.1.10:8080
```

Подставьте LAN-IP компьютера, повторите up -d --wait и откройте один и тот же
адрес на всех устройствах. При смене порта меняйте и PUBLIC_ORIGIN.
На каждом устройстве отдельно разрешите звук кнопкой Ready.

## Публичный HTTPS/WSS

Нужен сервер с Docker, ваш домен с A-записью на его IP, рабочий DNS,
контактный email и свободные TCP 80/443. UDP 443 используется для HTTP/3.
Если reverse proxy другого проекта занимает эти порты, настройте маршрутизацию
через него или используйте отдельный сервер.

```sh
git clone https://github.com/Sake14/SYNC.git
cd SYNC
cp -n .env.example .env.docker.production
```

Заполните .env.docker.production своими значениями:

```dotenv
SYNC_DOMAIN=sync.example.com
ACME_EMAIL=admin@example.com
SYNC_IMAGE_TAG=your-commit-sha
```

SYNC_DOMAIN — DNS-имя без схемы, пути и порта. CORS автоматически разрешает
https://SYNC_DOMAIN. Значения выше — примеры.

```sh
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml config --quiet
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml build server
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml build web
docker compose --env-file .env.docker.production -f docker-compose.yml -f docker-compose.production.yml up -d --wait --wait-timeout 180
curl --fail https://sync.example.com/health
curl --fail https://sync.example.com/api/health
```

Compose-проект — sync. Caddy получает и обновляет сертификат, перенаправляет
HTTP на HTTPS. Проверяйте настоящий адрес с обычной проверкой TLS.
up --wait проверяет здоровье контейнеров; публичный DNS и сертификат проверяются отдельно.
Официальные инструкции: [Docker на Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Compose merge](https://docs.docker.com/reference/compose-file/merge/),
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## Маршруты и данные

- /socket.io и /socket.io/* идут в backend, включая polling и WebSocket/WSS.
- /health идёт в backend; остальные запросы — в Next.js.
- /api/* и /media/* проходят через Next.js: он проверяет media cookie
  перед чтением приватного аудио. Range/206 и HEAD сохраняются.
- Docker frontend использует NEXT_PUBLIC_SOCKET_URL=/: сокеты работают через origin
  страницы, смена домена не требует пересборки клиента.
- uploads хранит загруженные байты; caddy-data/caddy-config — состояние TLS.
  Комнаты и токены находятся в Map и исчезают при рестарте backend.

Контейнеры имеют healthchecks, ограничения ресурсов и ротацию логов.
Web/server работают от node; root filesystem read-only, запись разрешена
в volume, tmp и cache. Caddy исключает токены и cookie из access logs.
Healthcheck не перезапускает зависший процесс сам: unhealthy требует диагностики.
Один backend не рассчитан на несколько replicas.

По умолчанию файл ограничен 20 MiB, тело запроса на proxy — 21 MiB.
При увеличении MAX_UPLOAD_BYTES увеличьте MAX_REQUEST_BYTES с запасом для multipart.
Новый volume получает права пользователя node. Музыка и сертификаты не входят в Git.
Свой каталог подключайте read-only mount на /app/media через отдельный override:
[media/README.md](media/README.md).

## Проверки контейнеров

После npm ci и установки браузеров Playwright, при запущенном локальном Compose:

```sh
npm run build -w @sync/shared
npm run test:deployment
npm run test:docker:e2e
```

Для другого адреса: env SYNC_TEST_URL=https://sync.example.com npm run test:deployment.
Smoke-тесты проверяют HTTP, Range, приватные uploads/cookie, квоты proxy,
отказ постороннему Origin, двух клиентов и polling → WebSocket.

Отдельная локальная проверка HTTPS/WSS с частным CA, без публичного домена:

```sh
docker compose --env-file .env.docker.local -f docker-compose.yml -f docker-compose.tls-test.yml up -d --wait --wait-timeout 180
docker compose --env-file .env.docker.local -f docker-compose.yml -f docker-compose.tls-test.yml cp reverse-proxy:/data/caddy/pki/authorities/local/root.crt /tmp/sync-test-ca.crt
env SYNC_TEST_URL=https://localhost:8443 SYNC_TEST_CA=/tmp/sync-test-ca.crt npm run test:deployment
docker compose --env-file .env.docker.local -f docker-compose.yml -f docker-compose.tls-test.yml stop
```

Это отдельный проект sync-tls-test. Тест доверяет указанному публичному сертификату
CA только в своём процессе; системное доверие и проверка TLS не отключаются.
Этот режим не подтверждает выдачу сертификата публичным ACME.

## Обновление, откат и остановка

Используйте SHA рабочей версии как SYNC_IMAGE_TAG. В чистом checkout ветки main:
git pull --ff-only origin main. Пройдите проверки, соберите server и web
последовательно и выполните up -d --wait. Протокол shared/server/web обновляется
совместно; backend restart закрывает комнаты.

Сохраняйте предыдущую пару образов. Для отката восстановите её tag и соответствующую
конфигурацию, затем выполните up -d --no-build --wait. Не сбрасывайте чужие изменения.

Логи: docker compose --env-file .env.docker.local -f docker-compose.yml logs --tail 100.
Остановка: та же команда с stop. Volumes при этом сохраняются.
down -v не используется для обычного обновления или остановки.
