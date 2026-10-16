"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SyncDiagnostics } from "@/components/sync-diagnostics";
import { RoomStatus, Reactions, SharedQueue, UploadAudio } from "@/components/room-product";
import Image from "next/image";
import QRCode from "qrcode";
import {
  Copy,
  Crown,
  Check,
  LogOut,
  QrCode,
  Users,
  Radio,
  Music2,
} from "lucide-react";
import { useRoomStore, controlPlayer, controlQueue, controlParticipant, leaveRoom } from "@/stores/room-store";
import { Shell, ErrorNotice, CatalogFailure } from "@/components/shell";
import { RoomForm } from "@/components/room-form";
import { Player } from "@/components/player";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/lib/playback";
import { copyInvitation } from "@/lib/copy-invitation";

function Invitation({ roomId }: { roomId: string }) {
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const inviteInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const link = `${window.location.origin}/join/${roomId}`;
    void Promise.resolve()
      .then(() => {
        if (active) setUrl(link);
        return QRCode.toDataURL(link, {
          margin: 2,
          width: 220,
          errorCorrectionLevel: "M",
          color: { dark: "#101f15", light: "#ffffff" },
        });
      })
      .then((data) => {
        if (active) setQr(data);
      })
      .catch(() => {
        if (active) setMessage("Не удалось создать QR. Используйте ссылку.");
      });
    return () => {
      active = false;
    };
  }, [roomId]);
  async function copy() {
    if (!inviteInput.current) return;
    setMessage("Копируем ссылку…");
    const result = await copyInvitation(url, inviteInput.current, manual);
    setCopied(result === "copied"); setManual(result === "manual");
    setMessage(result === "copied" ? "Ссылка скопирована"
      : "Ссылка выделена. Нажмите «Копировать» в меню телефона или Ctrl/Cmd+C. Кнопку можно нажать ещё раз.");
  }
  return (
    <section className="invite-panel">
      <h3>
        Хорошая компания —<br />
        по одной ссылке
      </h3>
      <p>Пригласите друзей в свой ритм.</p>
      <label className="sr-only" htmlFor="invite-url">
        Ссылка приглашения
      </label>
      <Input
        id="invite-url"
        ref={inviteInput}
        value={url}
        readOnly
        onFocus={(e) => e.target.select()}
      />
      <div className="invite-actions">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void copy();
          }}
          disabled={!url}
        >
          {copied ? <Check /> : <Copy />}Копировать ссылку
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Показать QR-код"
          aria-expanded={showQr}
          onClick={() => setShowQr(!showQr)}
          disabled={!qr}
        >
          <QrCode />
        </Button>
      </div>
      {showQr && (
        <div className="qr-image">
          {/* QR is a generated data URL, not remote album artwork. */}
          <Image
            src={qr}
            width={220}
            height={220}
            unoptimized
            alt="QR-код приглашения в комнату"
          />
        </div>
      )}
      <p className="form-feedback" role="status">
        {message}
      </p>
    </section>
  );
}

export function RoomView({
  roomId,
  diagnostics = false,
}: {
  roomId: string;
  diagnostics?: boolean;
}) {
  const router = useRouter();
  const {
    room,
    participantId,
    joined,
    connection,
    busy,
    tracks,
    catalogStatus,
    rtt,
  } = useRoomStore();
  if (
    !room ||
    room.id !== roomId ||
    (!joined && connection === "online" && !busy)
  )
    return <RoomForm roomId={roomId} />;
  const host = room.hostId === participantId;
  const canControl = host && joined && connection === "online";
  return (
    <Shell>
      <div className="room-page">
        <div className="room-topline">
          <div>
            <p className="eyebrow">
              <Radio size={13} /> МУЗЫКАЛЬНАЯ КОМНАТА{" "}
              <span className="subtle-badge">
                {host ? "ВЫ HOST" : "ВЫ СЛУШАТЕЛЬ"}
              </span>
            </p>
            <h1>{room.name}</h1>
            <p className="room-code">
              ID / {room.id}
              <span className="room-connection">
                {joined && connection === "online"
                  ? `Подключено${rtt !== null ? ` · ${rtt} мс` : ""}`
                  : "Восстанавливаем подключение…"}
              </span>
            </p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              if (await leaveRoom()) router.push("/");
            }}
            disabled={!joined || busy}
          >
            <LogOut />
            Выйти
          </Button>
        </div>
        <ErrorNotice />
        <RoomStatus />
        {diagnostics ? (
          <SyncDiagnostics />
        ) : (
          <Link className="back-link" href="/sync-lab">
            Открыть диагностику синхронизации
          </Link>
        )}
        <div className="room-grid">
          <div className="music-column">
            <Player />
            <Reactions />
            <SharedQueue />
            <section className="room-catalog">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ЧТО ПОСЛУШАЕМ?</p>
                  <h2>Музыка комнаты</h2>
                </div>
                <span className="muted">{tracks.length} трека</span>
              </div>
              {!host && (
                <p className="listener-note">
                  HOST выбирает трек и перемотку. Паузу может поставить любой участник. Громкость — ваша.
                </p>
              )}
              {catalogStatus === "error" && <CatalogFailure />}
              {catalogStatus === "loading" && !tracks.length ? (
                <p className="muted">Загружаем каталог…</p>
              ) : !tracks.length ? (
                <p className="empty-state">
                  Добавьте локальные файлы в media и перезапустите сервер.
                </p>
              ) : (
                <div className="track-list">
                  {tracks.map((track, index) => (
                    <div className="library-track" key={track.id}><button
                      className={`track-row ${room.trackId === track.id ? "selected" : ""}`}
                      disabled={!canControl || busy}
                      onClick={() => {
                        void controlPlayer("track", track.id);
                      }}
                      aria-label={`Выбрать трек ${track.title}`}
                      aria-pressed={room.trackId === track.id}
                    >
                      <span className="track-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Cover
                        title={track.title}
                        kind={track.cover}
                        className="track-thumb"
                      />
                      <span className="track-info">
                        <strong>{track.title}</strong>
                        <span>{track.artist}</span>
                      </span>
                      <span className="track-duration">
                        {formatTime(track.durationSeconds)}
                      </span>
                      <Music2 size={16} />
                    </button><Button variant="outline" size="icon" aria-label={`Добавить в очередь ${track.title}`} disabled={!joined||connection!=="online"||busy||room.queue.length>=50} onClick={()=>{void controlQueue("add",track.id);}}>+</Button></div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <aside className="room-sidebar">
            <section className="participants-panel">
              <div className="panel-title">
                <h2>На одной волне</h2>
                <span className="subtle-badge">
                  <Users size={13} />
                  {room.participants.length}
                </span>
              </div>
              <p className="muted">Слушатели в этой комнате</p>
              <ul className="participant-list">
                {room.participants.map((participant, index) => (
                  <li key={participant.id} data-participant-id={participant.id}>
                    <span className={`avatar avatar-${index % 3}`}>
                      {participant.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="participant-name">
                      {participant.displayName}
                      {participant.id === participantId && (
                        <small>Это вы</small>
                      )}
                      <small>
                        {
                          {
                            loading: "Загрузка",
                            blocked: "Включите звук",
                            buffering: "Буферизация",
                            clock: "Калибровка часов",
                            ready: "Готов слушать",
                            error: "Ошибка аудио",
                            stale: "Нет свежей готовности",
                          }[participant.readiness.status]
                        }
                      </small>
                    </span>
                    {participant.id === room.hostId ? (
                      <span className="host-label">
                        <Crown size={12} />
                        HOST
                      </span>
                    ) : (
                      <span className="status-dot" />
                    )}
                    {canControl && participant.id !== participantId && (
                      <div className="participant-actions">
                        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Передать HOST ${participant.displayName}`}
                          onClick={() => { void controlParticipant("transfer", participant.id); }}><Crown size={13} />HOST</Button>
                        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Исключить ${participant.displayName}`}
                          onClick={() => { void controlParticipant("kick", participant.id); }}>Исключить</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <Invitation roomId={room.id} />
            <UploadAudio />
            <div className="room-tip">
              <HeadphoneNote />
              Выберите трек, включите звук на каждом устройстве и дождитесь play
              от HOST.
            </div>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
function HeadphoneNote() {
  return <Radio size={20} />;
}
