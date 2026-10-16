# Общий аудиокаталог SYNC

```sh
npm run media:demo
```

Команда создаёт три оригинальных WAV по 24 секунды: Orbit, Soft focus и Night drive.
Существующие файлы не перезаписываются. Музыка не скачивается из внешних сервисов.

Для своего каталога добавьте обычные MP3/WAV/OGG/M4A в эту папку и перезапустите
backend. Длительность и теги разбирает music-metadata; формат sidecar обрабатывает
apps/server/src/catalog/catalog.ts. Symlink и вложенные папки не включаются.
Файлы каталога и sidecar исключены из Git. Для загрузки без перезапуска
используйте приватную библиотеку комнаты.

Docker-образы содержат сгенерированные демо. Для своего каталога создайте
docker-compose.media.yml:

```yaml
services:
  server:
    volumes:
      - ./media:/app/media:ro
```

Подготовьте папку и примените override:

```sh
npm run media:demo
docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.media.yml up -d --wait
```

Bind mount скрывает демо из образа. Приватную музыку хранит отдельный volume.
Подробнее: [DEPLOY.md](../DEPLOY.md).
