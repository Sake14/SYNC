# SYNC: протокол музыкальных комнат

Этап 5, протокол v4. Сервер назначает общий старт и учитывает готовность каждого устройства.
Источник истины — единственный процесс backend. Socket.IO передаёт только состояние.
Схемы и TypeScript-интерфейсы: `packages/shared/src/rooms.ts`.

`QueueEntry = { id, trackId, addedBy, addedByName, addedAt }`, id — 16 символов.
Очередь содержит до 50 записей. Добавляют все участники, удаляет автор или HOST,
сортирует/выбирает следующую HOST. Все изменения требуют expectedRevision и рассылают snapshot.
`Reaction = { id, roomId, participantId, displayName, emoji, serverTime }`; сервер назначает
идентичность и время, лимитирует сессию до одной реакции за 500 мс. Реакция не меняет revision.
Загрузки расширяют `room.library` до 20 метаданных Track, не глобальный каталог.

## HTTP библиотеки комнаты

| Запрос | Назначение |
| --- | --- |
| `GET /api/rooms/:roomId/library` | Метаданные загрузок и лимиты; требует активный bearer resumeToken |
| `POST /api/rooms/:roomId/uploads` | Multipart `file`, `title?`, `artist?`; bearer, Zod, подпись файла, квоты |
| `GET/HEAD /media/room_<roomId>_upload_<id>.<ext>` | Только активным участникам комнаты, поддерживает Range |

Загрузка отвечает `201 { track }`, ошибки — `{ error: { code, message } }` с 4xx/5xx.
`X-Upload-Size` необязателен и может только ужесточить максимальное число байтов.
Коды HTTP включают UNAUTHORIZED, INVALID_SESSION, INVALID_FILE, UNSUPPORTED_MEDIA,
UPLOAD_TOO_LARGE, STORAGE_FULL, UPLOAD_BUSY. Произвольные пути/неизвестные multipart fields
не принимаются. Next.js `/api/rooms/:roomId/session` проверяет membership и выдаёт HttpOnly
медиа-cookie; `/api/rooms/:roomId/uploads` потоково проксирует загрузку. Токен не входит в URL.

## Состояние

```ts
type Room = {
  id: string;
  name: string;
  hostId: string | null;
  participants: { id: string; displayName: string; joinedAt: number; readiness: Readiness }[];
  trackId: string | null;
  trackRevision: number;
  playbackState: "paused" | "playing";
  position: number;
  startedAt: number | null;
  revision: number;
  createdAt: number;
  library: Track[];
  queue: QueueEntry[];
};
type RoomSnapshot = { room: Room; serverTime: number };
```

`position` — секунды в точке отсчёта, `startedAt` — серверное время этой точки в мс Unix.
При playing текущая позиция = `position + max(0, serverNow - startedAt) / 1000`.
При pause `startedAt = null`, позиция фиксирована. Чтение снимка не изменяет точку отсчёта.
Все остальные временные поля — миллисекунды Unix. `revision` начинается с 1, увеличивается
при каждом принятом изменении плеера, membership или замене активного соединения.
Обычное чтение/clock ping/повторный join того же соединения ревизию не меняет.

`hostId` указывает на одного активного участника. Только у пустой комнаты он равен null.
Порядок participants соответствует порядку текущего подключения; повторно подключившийся
участник добавляется в конец, сохраняя собственный id, имя и исходный joinedAt.
Получить список участников можно через `room:snapshot`, поле `room.participants`.
Внутренний RoomManager также предоставляет защищённый `getParticipants`.

## Запросы клиента

Каждый запрос требует Socket.IO acknowledgement callback. Без callback запрос игнорируется,
включая create и join. Payload проходит строгую Zod-валидацию; неизвестные поля запрещены.
Клиент не задаёт свою идентичность, hostId, socketId, startedAt или новую revision.
participantId в командах HOST обозначает целевого активного участника той же комнаты.

| Событие | Payload | Данные успешного ack |
| --- | --- | --- |
| `room:create` | `{ displayName, name? }` | Membership |
| `room:join` | `{ roomId, displayName }` **или** `{ roomId, resumeToken }` | Membership |
| `room:leave` | `{ roomId, expectedRevision }` | RoomSnapshot после выхода |
| `room:snapshot` | `{ roomId }` | RoomSnapshot |
| `room:transfer-host` | `{ roomId, expectedRevision, participantId }` | RoomSnapshot; HOST |
| `room:kick` | `{ roomId, expectedRevision, participantId }` | RoomSnapshot; HOST, кроме себя |
| `track:change` | `{ roomId, expectedRevision, trackId }` | PlaybackState |
| `player:play` | `{ roomId, expectedRevision }` | PlaybackState |
| `player:pause` | `{ roomId, expectedRevision }` | PlaybackState |
| `player:seek` | `{ roomId, expectedRevision, position }` | PlaybackState |
| `sync:ping` | `{ roomId, clientSentAtMs }` | SyncPong |
| `queue:add` | `{ roomId, expectedRevision, trackId }` | RoomSnapshot |
| `queue:remove` | `{ roomId, expectedRevision, entryId }` | RoomSnapshot |
| `queue:move` | `{ roomId, expectedRevision, entryId, direction: "up" \| "down" }` | RoomSnapshot |
| `queue:next` | `{ roomId, expectedRevision }` | RoomSnapshot |
| `reaction:send` | `{ roomId, emoji: "❤️" \| "🔥" \| "😭" \| "🎧" }` | Reaction |

```ts
type Membership = {
  snapshot: RoomSnapshot;
  participantId: string;
  resumeToken: string;
  resumed: boolean;
};
type PlaybackState = Pick<Room,
  "trackId" | "trackRevision" | "playbackState" | "position" | "startedAt" | "revision"
> & { roomId: string; serverTime: number };
type SyncPong = {
  roomId: string;
  clientSentAtMs: number;
  serverReceivedAtMs: number;
  serverSentAtMs: number;
  revision: number;
};
```

Форма ack: `{ ok: true, data }` либо `{ ok: false, error: { code, message, currentRevision? } }`.
`currentRevision` возвращается для STALE_REVISION, после проверки членства и прав.
`room:leave` тоже требует ревизию: запоздавший leave не должен удалить новую membership.

Имена слушателей обрезаются по краям, длина 1–32. Название комнаты — 1–64 символа;
при пропуске name сервер создаёт название из ID. Room IDs — URL-safe nanoid из 12 символов;
идентификаторы участников — 16, resumeToken — 32 (192 случайных бита).
Track ID — 1–128 символов `A–Z a–z 0–9 _ -` либо null для очистки трека.
Это идентификатор, не URL и не путь к файлу. Production backend проверяет наличие ID в
локальном каталоге; неизвестный трек даёт TRACK_NOT_FOUND. Позиция — конечное неотрицательное
число секунд, seek ограничивается фактической длительностью файла.

Создание автоматически подключает автора и назначает HOST. Один socket состоит не более
чем в одной музыкальной комнате. Для перехода сначала нужен успешный leave. Неудачный join
не меняет текущую membership. Повторный join в ту же комнату на том же socket идемпотентен.

## События сервера

| Событие | Payload и получатели |
| --- | --- |
| `room:snapshot` | RoomSnapshot; всем участникам при create/join/leave/disconnect/takeover, либо только запросившему snapshot |
| `participant:joined` | `{ roomId, participant, hostId, revision, serverTime }`; комнате при добавлении активного участника |
| `participant:left` | `{ roomId, participantId, hostId, reason: "leave" \| "disconnect" \| "kick", revision, serverTime }`; оставшимся участникам |
| `player:state` | PlaybackState; комнате после каждой принятой команды плеера/смены трека и серверного завершения |
| `track:change` | PlaybackState; комнате при смене/очистке трека, перед player:state той же ревизии |
| `sync:pong` | SyncPong; только инициатору sync:ping, дополнительно к ack |
| `reaction:received` | Reaction; всем участникам комнаты, включая отправителя |
| `room:removed` | `{ roomId, reason: "kicked", revision, serverTime }`; только исключённому, затем disconnect |

Resume token возвращается **только в личном ack**, не входит в snapshots, participant events
или логи. Socket.IO-каналы имеют префикс `music:`, чтобы не пересекаться с private socket rooms.
После leave/disconnect клиент больше не получает рассылку комнаты. Отправка клиентом
`player:state`, `participant:left` или `sync:pong` не изменяет серверное состояние.

Сохраняются bootstrap-события `server:ready` и `clock:ping`/ack для существующего frontend.
Legacy clock не обращается к комнатам. Новый `sync:ping` проверяет членство.

## HOST, воспроизведение и ревизии

RoomManager сначала проверяет существование комнаты, затем membership по привязанному сервером
connection ID, точное совпадение expectedRevision и роль HOST для Play/Seek/Track.
Pause доступна всем активным участникам; transfer/kick доступны только HOST. Знания roomId/hostId недостаточно.
Все проверки и изменение Map выполняются синхронно, без await. Две команды с одной ревизией
не могут быть приняты: первая увеличивает revision, вторая получает STALE_REVISION.

- `track:change` всегда сбрасывает позицию в 0 и ставит паузу; null очищает трек.
- `play` требует fresh ready всех активных участников, продолжает текущую позицию
  и устанавливает будущий startedAt = serverNow + PLAY_LEAD_MS.
- `pause` вычисляет позицию по серверным часам, затем убирает startedAt.
- `seek` сохраняет playing/paused; при playing переносит startedAt на текущее серверное время.
- Play/pause/seek без выбранного трека возвращают NO_TRACK.
- Команды клиента не могут заменить позицию при pause или передать собственные часы.

При STALE_REVISION клиент запрашивает новый snapshot. Нельзя автоматически переотправлять
старую команду с новой revision: пользователь мог уже видеть другое состояние/другой трек.
При применении событий клиент сравнивает revision **в пределах roomId**, игнорирует меньшие
ревизии и допускает события одной ревизии (track:change + player:state, membership + snapshot).

Backend использует локальный каталог для проверки файла и длительности,
окончания трека и раздачи Range HTTP. Track ID остаётся непрозрачным идентификатором.

## Отключение и восстановление

1. При разрыве транспорта участник сразу удаляется из публичного списка; revision увеличивается.
2. Если отключился HOST, роль получает первый оставшийся участник. Трек продолжает играть.
3. Если участников не осталось, сервер фиксирует текущую позицию и ставит паузу.
4. Закрытая сессия хранится 30 секунд. Комната без участников хранится 5 минут.
5. После нового `connect` клиент отправляет `room:join` с roomId и сохранённым resumeToken.
   Он получает тот же participantId и **новый актуальный snapshot**, включая изменения за время разрыва.
6. Вернувшийся прежний HOST не забирает роль у действующего. В пустой комнате вернувшийся становится HOST.
7. Если старый socket ещё открыт, предъявление токена атомарно переносит membership на новый socket.
   Ревизия увеличивается, старый socket принудительно закрывается. Его поздний disconnect игнорируется,
   а команды через старый connection ID запрещены. Участник не дублируется и ложный left не отправляется.
8. Истёкший/чужой токен возвращает INVALID_SESSION. Явный room:leave отзывает токен немедленно.
   При заполненной комнате восстановление отключённого участника возвращает ROOM_FULL; слот не резервируется.

Встроенный `connectionStateRecovery` Socket.IO не включён: membership и восстановление свежего
состояния контролирует RoomManager, без воспроизведения очереди старых управляющих команд.
Клиент обязан хранить токен приватно и повторно присоединяться после каждого подключения.
Сервер не считает socket.id постоянным идентификатором пользователя.

Socket.IO не гарантирует доставку всех сообщений через разрыв соединения; поэтому ack и
повторный snapshot являются частью протокола. См. [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
и [connection state recovery](https://socket.io/docs/v4/connection-state-recovery/).

## Лимиты и очистка

| Переменная | По умолчанию | Диапазон |
| --- | --- | --- |
| `MAX_ROOM_PARTICIPANTS` | 20 активных | 1–100 |
| `MAX_ROOMS` | 100 | 1–10000 |
| `RECONNECT_GRACE_MS` | 30000 | 1–300000 |
| `EMPTY_ROOM_TTL_MS` | 300000 | 1–3600000, не меньше reconnect grace |

Дополнительно в комнате не больше `MAX_ROOM_PARTICIPANTS * 4` активных + ожидающих восстановления
сессий. При исчерпании памяти для сессий новый join получает SESSION_LIMIT до истечения grace.
Это отдельный предел; активные участники всегда ограничены MAX_ROOM_PARTICIPANTS.
Очистка запускается раз в секунду и перед create/join. Таймер останавливается при закрытии сервера.
Коллизии nanoid проверяются до вставки, количество повторных попыток ограничено восемью.

Ошибки: INVALID_PAYLOAD, ROOM_NOT_FOUND, NOT_MEMBER, NOT_HOST, ROOM_FULL, ROOM_LIMIT,
SESSION_LIMIT, INVALID_SESSION, ALREADY_IN_ROOM, STALE_REVISION, NO_TRACK, TRACK_NOT_FOUND, NOT_READY, ID_EXHAUSTED,
INTERNAL_ERROR. Отклонённые команды не меняют playback/membership/revision.

Комнаты и сессии исчезают после перезапуска. Нужен один backend-процесс; БД и Navidrome не используются.
HTTP `/health` и `/api/catalog` сохраняются. Публичных REST-маршрутов комнат нет: они не обходят
проверку socket membership. TLS/reverse proxy и пользовательская аутентификация находятся вне этого этапа.

## Длительность и окончание трека (этап 3)

Backend получает duration resolver из локального каталога. Смена на отсутствующий
ID возвращает TRACK_NOT_FOUND без изменения revision, после проверки членства/HOST.
Seek ограничивается duration. Backend timer проверяет окончание раз в 250 мс и
рассылает player:state с paused, position=duration и новой revision. Play после конца
начинает с нуля. Браузеры могут не включать звук до явной активации, серверная timeline
при этом продолжает работать. Элемент готовности в UI относится только к своему устройству.

## Готовность и clock synchronization (этап 4)

`player:ready` payload: `{ roomId, trackId, trackRevision, sequence, status, bufferedSeconds,
soundUnlocked, clockSynced }`, ack — RoomSnapshot. При изменении статуса сервер рассылает
room:snapshot и увеличивает revision. Heartbeat не меняет revision.

Readiness имеет те же status/trackRevision/bufferedSeconds/soundUnlocked/clockSynced поля
и находится в participant.readiness. Статусы: loading, blocked, buffering, clock, ready,
error, stale. Ready без буфера, разрешения звука или часов запрещён. Report от постороннего
получает NOT_MEMBER; старый trackRevision или sequence — STALE_REVISION. Новая trackRevision
назначается при каждом track:change, даже при повторном выборе того же файла.

PLAY без fresh ready всех активных участников возвращает NOT_READY без изменения состояния.
Ready действует 15 с и обновляется heartbeat. Join/reconnect/takeover сбрасывают утверждение
готовности возвращённого участника. Поздний join не переносит startedAt уже играющей комнаты.

Начальный запас PLAY — 750 мс, настройка PLAY_LEAD_MS (100–3000 мс). Pause перед deadline
отменяет ожидающий start. Seek задаёт немедленный новый anchor и отменяет прежний timer клиента.
Clock timestamps и timeline используют один источник серверного времени.
Подробный алгоритм, client-side thresholds, ограничения и диагностика:
[SYNC_ALGORITHM.md](SYNC_ALGORITHM.md).

Kick отзывает resumeToken, удаляет членство и доступ к приватному media; клиент не делает
автоматический resume. Новый ручной join по публичной ссылке разрешён: это не постоянный бан.
HOST transfer сохраняет playback anchor и готовность активных устройств.
