# HTTP API и Socket.IO SYNC

Аудит 2026-10-14, протокол v4. Авторитетный runtime-контракт — Zod и интерфейсы
`packages/shared/src/index.ts`, `rooms.ts`, `tracks.ts`, `music-provider.ts`.
В Docker browser обращается к одному origin Caddy; прямой Express порт наружу не публикуется.

## HTTP, доступный через web/Caddy

| Метод и путь | Поведение |
| --- | --- |
| `GET /health` | Caddy → Express; status/service/protocolVersion/timestamp/uptimeSeconds |
| `GET /api/health` | Next.js проверяет backend; 200 или 503 |
| `GET /api/catalog` | `{ tracks: Track[] }`, локальный общий каталог |
| `POST /api/rooms/:roomId/uploads` | Multipart file + title?/artist?; 201 `{ track }`, устанавливает media cookie |
| `POST /api/rooms/:roomId/session` | Активный bearer; проверяет библиотеку и выдаёт media cookie |
| `DELETE /api/rooms/:roomId/session` | Удаляет browser media cookie; server membership удаляется через room:leave |
| `GET/HEAD /media/:filename` | Общий каталог публичный, загруженная музыка — только участникам комнаты |
| `GET /api/music/providers` | Статусы/capabilities local и zvuk |
| `GET /api/music/zvuk/tracks/:id/playback` | В web: явный 501/UNSUPPORTED и официальный URL для валидного ID |

HTTP route может отсутствовать на конкретном слое. Например session существует только в Next.js,
а `/health` — в Express/Caddy. Остальной provider facade ниже доступен непосредственно Express
в private сети; на browser web-route сейчас публично доступны только providers и Zvuk playback fallback.

`Track = { id, title, artist, durationSeconds, streamPath, cover? }`;
cover — orbit/bloom/pulse.
Аудио поддерживает Accept-Ranges, Content-Length, Content-Type, Range/206 и неверный Range/416.
Приватный путь: `/media/room_<roomId>_upload_<opaqueId>.<ext>`; знания URL недостаточно.
Через browser audio передаётся HttpOnly cookie, Next.js пересылает её в Authorization.
Bearer resumeToken используется только активным участником, не является аккаунтом или музыкальным OAuth token.
Токен нельзя помещать в ссылки, QR, логи или NEXT_PUBLIC_*.

### Upload

Тело multipart содержит ровно `file`, необязательные `title`, `artist`. Имя файла/MIME
не определяют сохраняемый путь или фактический формат. `X-Upload-Size` — необязательный size hint,
который может лишь ужесточить server file-size limit. Runtime проверяет файл и duration.
По умолчанию 20 MiB/файл, 100 MiB/комната, 512 MiB/сервер и 20 записей/комната.
Caddy принимает максимум 21 MiB на всё тело запроса, включая multipart.

| HTTP | Типовые причины |
| --- | --- |
| 400 | Неверный roomId, multipart/metadata, отсутствующий файл |
| 401 | Нет bearer/media cookie |
| 403 | Нет активного доступа/неверная сессия |
| 404 | Комната или разрешённый файл не существует |
| 413 | Размер файла/тела либо квота превышены |
| 415 | Байты не являются поддерживаемым аудио |
| 429 | Лимит параллельных загрузок |
| 503 | Внутренний backend недоступен через Next.js proxy |

Ошибка: `{ error: { code, message } }`; media routes могут отдавать пустое тело ошибки.
Точные ошибки upload/domain и статусы задаются соответствующим route, не угадываются клиентом.

## Provider facade в Express

`GET /api/rooms/:roomId/library` существует только в Express и возвращает `{ tracks, limits }`
активному bearer-участнику. В Next.js библиотека получается через `POST /api/rooms/:roomId/session`;
отдельного публичного web GET library нет.

`GET /api/music/:provider/search?q=&limit=&roomId?`, `/library`, `/playlists`,
`/tracks/:trackId`, `/tracks/:trackId/playback`. Provider: local/zvuk.
Поиск ограничен limit 1–50 и q до 200 символов. Неизвестные query поля отклоняются.
Локальный room scope требует активный bearer; roomId для zvuk не принимается.

Ответ: `{ status: "OK", data }` либо `{ status, message, officialUrl?, retryAfterSeconds? }`.
Статусы: UNSUPPORTED→501, ACCESS_DENIED→403, TOKEN_EXPIRED→401, SERVICE_UNAVAILABLE→503,
NETWORK_ERROR/INVALID_RESPONSE→502, RATE_LIMITED→429, NOT_FOUND→404, INVALID_INPUT→400.
При RATE_LIMITED с известным временем выставляется Retry-After.
В текущем production Zvuk не делает внешних запросов; все live-операции UNSUPPORTED.
LocalMusicProvider работает; сохранённых provider-playlists нет. [ZVUK_INTEGRATION.md](ZVUK_INTEGRATION.md).

## Socket.IO, default namespace, /socket.io/

Каждая входящая команда проходит Zod и требует callback ack. Без ack мутация не выполняется.
Ack: `{ ok: true, data }` либо `{ ok: false, error: { code, message, currentRevision? } }`.
Команды не содержат socketId/hostId: идентичность определяет серверная membership.

| Client → server | Payload | Ack data / права |
| --- | --- | --- |
| room:create | displayName, name? | Membership; создатель HOST |
| room:join | roomId + displayName **либо** roomId + resumeToken | Membership; fresh join/resume |
| room:leave | roomId, expectedRevision | RoomSnapshot; активный member |
| room:snapshot | roomId | RoomSnapshot; только member |
| room:transfer-host | roomId, expectedRevision, participantId | RoomSnapshot; только HOST, активный участник той же комнаты |
| room:kick | roomId, expectedRevision, participantId | RoomSnapshot; только HOST, нельзя исключить себя |
| track:change | roomId, expectedRevision, trackId (nullable) | PlaybackState; HOST, доступный локальный трек |
| player:play | roomId, expectedRevision | PlaybackState; HOST, ready всех активных |
| player:pause | roomId, expectedRevision | PlaybackState; любой активный member |
| player:seek | roomId, expectedRevision, position | PlaybackState; HOST, секунды в границах duration |
| player:ready | roomId, trackId, trackRevision, sequence, status, bufferedSeconds, soundUnlocked, clockSynced | RoomSnapshot; member, актуальный файл/sequence |
| queue:add | roomId, expectedRevision, trackId | RoomSnapshot; любой member |
| queue:remove | roomId, expectedRevision, entryId | RoomSnapshot; автор записи или HOST |
| queue:move | roomId, expectedRevision, entryId, direction(up/down) | RoomSnapshot; HOST |
| queue:next | roomId, expectedRevision | RoomSnapshot; HOST |
| reaction:send | roomId, emoji | Reaction; member, ❤️/🔥/😭/🎧, не чаще 500 мс |
| sync:ping | roomId, clientSentAtMs | SyncPong; member |
| clock:ping | clientSentAtMs | bootstrap ClockPong; не даёт room access |

`Membership = { snapshot, participantId, resumeToken, resumed }`.
`RoomSnapshot = { room, serverTime }`; Room включает участников, library, очередь и anchor.
`PlaybackState = { roomId, trackId, trackRevision, playbackState, position, startedAt, revision, serverTime }`.
Position — секунды; timestamps — миллисекунды. Playing требует trackId и startedAt;
paused имеет startedAt=null. Сервер ограничивает duration и назначает scheduled deadline.

| Server → client | Когда |
| --- | --- |
| server:ready | Bootstrap protocolVersion/serverTimeMs после подключения |
| room:snapshot | Membership, readiness, очередь, библиотека, запрос snapshot |
| participant:joined / participant:left | Вход/уход; роль, revision, серверное время; reason=leave/disconnect/kick |
| room:removed | Только исключённому socket: roomId, reason=kicked, revision, serverTime; затем disconnect |
| player:state | Принятый playback command и server end |
| track:change | Прямая команда track:change, вместе с player:state той же revision |
| reaction:received | Эфемерная реакция всей комнате |
| sync:pong | Только инициатору ping, дополнительно к ack |

Защита: INVALID_PAYLOAD, ROOM_NOT_FOUND, NOT_MEMBER, NOT_HOST, STALE_REVISION,
ROOM_FULL/ROOM_LIMIT/SESSION_LIMIT, INVALID_SESSION, TRACK_NOT_FOUND, NO_TRACK,
NOT_READY, QUEUE_FULL/QUEUE_EMPTY/NOT_QUEUE_OWNER, RATE_LIMIT и другие enum shared.
Старая revision не изменяет комнату. Отправка клиентом server-only событий не меняет состояние.
Повторить отклонённую команду можно только после обновления состояния и нового пользовательского действия.
queue:next передаёт новый трек в полном snapshot; server end публикует player:state и snapshot.

## Восстановление

Transport disconnect сразу убирает активного участника; его session сохраняется 30 секунд.
Resume возвращает прежний participantId и свежий snapshot, но не возвращает потерянную роль HOST.
При takeover предыдущий socket отключается. Явный leave отзывает токен; после истечения grace
нужен новый вход. Перезапуск процесса утрачивает все комнаты/сессии независимо от upload volume.
CORS/allowRequest ограничены заданными origins; отсутствие Origin у серверного HTTP/Socket.IO
клиента само по себе не является room authorization. Подробности: [ROOM_PROTOCOL.md](ROOM_PROTOCOL.md).

HOST transfer не меняет playback anchor. Kick удаляет активное членство и отзывает resumeToken,
включая доступ к приватным аудиофайлам. Клиент очищает credential и не пытается автоматически
вернуться. Это исключение текущей сессии: без аккаунтов публичная ссылка позволяет снова
войти вручную с новой идентичностью. Ошибки: PARTICIPANT_NOT_FOUND, CANNOT_REMOVE_HOST.
