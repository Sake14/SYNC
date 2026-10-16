"use client";
import { useState } from "react";
import { Check, Headphones, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Cover } from "@/components/cover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useRoomStore, controlPlayer } from "@/stores/room-store";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { formatTime } from "@/lib/playback";

export function Player() {
  const {
    room,
    tracks,
    joined,
    participantId,
    busy,
    connection,
    catalogStatus,
    metrics,
  } = useRoomStore();
  const track = tracks.find((t) => t.id === room?.trackId);
  const mediaRoomId=useRoomStore(s=>s.mediaRoomId);
  const mediaSessionError=useRoomStore(s=>s.mediaSessionError);
  const needsMediaSession=!!track?.streamPath.startsWith("/media/room_") && mediaRoomId!==room?.id;
  const {
    audioRef,
    ready,
    unlocked,
    position,
    volume,
    setVolume,
    error,
    loading,
    enableAudio,
    activating,
    retryAudio,
    muted,
    toggleMute,
    volumeSupported,
    recoverAudio,
    nativeStatus,
  } = useAudioPlayer(track);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const canControl =
    joined && connection === "online" && room?.hostId === participantId;
  const canPause = joined && connection === "online";
  const playing = room?.playbackState === "playing";
  const allReady =
    room?.participants.every(
      (p) =>
        p.readiness.status === "ready" &&
        p.readiness.trackRevision === room.trackRevision,
    ) ?? false;
  const duration = track?.durationSeconds ?? 0;
  const progress = seekDraft ?? position;
  function seek() {
    if (seekDraft !== null) {
      void controlPlayer("seek", seekDraft);
      setSeekDraft(null);
    }
  }
  return (
    <section className="player-panel" aria-label="Музыкальный плеер">
      <div className="player-cover-wrap">
        <Cover
          title={track?.title ?? "Your next track"}
          kind={track?.cover}
          className="player-cover"
        />
        <span className={`playing-badge ${playing ? "active" : ""}`}>
          <span className="equalizer">
            <i />
            <i />
            <i />
          </span>
          {metrics?.phase === "scheduled"
            ? "ОБЩИЙ СТАРТ"
            : playing
              ? "СЕЙЧАС ИГРАЕТ"
              : "НА ПАУЗЕ"}
        </span>
      </div>
      <div className="track-heading">
        <div>
          <p className="eyebrow">ОБЩИЙ ПЛЕЕР</p>
          <h2>{track?.title ?? "Выберите трек"}</h2>
          <p>{track?.artist ?? "HOST может выбрать музыку из каталога ниже"}</p>
        </div>
        <Headphones size={23} />
      </div>
      <audio
        ref={audioRef}
        src={track?.streamPath.startsWith("/media/room_") && mediaRoomId!==room?.id ? undefined : track?.streamPath}
        preload="auto"
        aria-label="Аудио комнаты"
      />
      <div className="progress-control">
        <Slider
          aria-label="Позиция трека"
          aria-valuetext={`${formatTime(progress)} из ${formatTime(duration)}`}
          min={0}
          max={duration}
          step={0.1}
          value={progress}
          disabled={!canControl || !track || busy}
          onChange={(e) => setSeekDraft(Number(e.target.value))}
          onPointerUp={seek}
          onKeyUp={seek}
          onBlur={seek}
        />
        <div className="time-labels">
          <span data-testid="position">{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="playback-controls">
        <span className="player-role">
          {canControl ? "Вы управляете" : "Пауза доступна всем"}
        </span>
        <Button
          size="icon"
          className="play-button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            void controlPlayer(playing ? "pause" : "play");
          }}
          disabled={
            (playing ? !canPause : !canControl) || !track || busy || (!playing && (!ready || !allReady))
          }
        >
          {playing ? (
            <Pause fill="currentColor" />
          ) : (
            <Play fill="currentColor" />
          )}
        </Button>
        <div className="volume-control">
          <button
            aria-label={!muted ? "Выключить звук" : "Вернуть громкость"}
            onClick={toggleMute}
          >
            {!muted ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <Slider
            aria-label="Громкость"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={!volumeSupported}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </div>
      </div>
      <div className={`audio-readiness ${ready ? "is-ready" : ""}`}>
        <span className="readiness-icon">
          {ready ? <Check size={19} /> : <Headphones size={19} />}
        </span>
        <div>
          <strong>
            {ready
              ? muted ? "Звук выключен на этом устройстве" : "Готов слушать"
              : needsMediaSession ? mediaSessionError ? "Музыка комнаты недоступна" : "Подключаем музыку комнаты"
              : activating ? "Загружаем и включаем звук"
              : unlocked
                ? loading ? "Буферизуем новый файл" : "Калибруем часы"
                : "Сначала включите звук"}
          </strong>
          <p>
            {!track
              ? "Дождитесь выбора трека."
              : needsMediaSession
                ? "Проверяем доступ к загруженному файлу. Затем станет доступна кнопка «Включить звук»."
              : ready
                ? muted ? "Нажмите кнопку громкости, чтобы вернуть звук." : !volumeSupported
                  ? "Громкость и выбор динамика регулируются кнопками и настройками устройства."
                  : loading
                  ? "Буферизуем локальный файл…"
                  : "Звук включён на этом устройстве."
                : unlocked
                  ? loading
                    ? "Загружаем аудио по HTTP. Разрешение на звук сохранено: повторно нажимать «Готов слушать» не нужно."
                    : "Проверяем серверное время перед общим стартом."
                  : "Нажмите кнопку: она разрешит звук и запустит загрузку. На телефоне выберите динамик в настройках вывода звука."}
          </p>
        </div>
        {(!unlocked || error) && (
          <Button
            size="sm"
            onClick={() => {
              void enableAudio();
            }}
            disabled={!track || !joined || activating || needsMediaSession}
          >
            {activating ? "Подготавливаем звук…" : "Включить звук / Готов слушать"}
          </Button>
        )}
      </div>
      {unlocked && (
        <details className="audio-help form-note">
          <summary>Звук не слышно?</summary>
          <p>Общая шкала показывает время комнаты. Она не подтверждает звук на устройстве.
            Эта кнопка заново запускает аудио в вашем браузере, сохраняя общую позицию.</p>
          <Button variant="outline" size="sm" onClick={recoverAudio} disabled={!joined || activating || needsMediaSession}>
            Восстановить звук
          </Button>
          <p data-testid="native-audio-status">{nativeStatus}</p>
        </details>
      )}
      {needsMediaSession && mediaSessionError && (
        <div className="error-notice" role="alert">
          <p>{mediaSessionError}</p>
        </div>
      )}
      {!playing && !allReady && (
        <p className="listener-note" role="status">
          PLAY ждёт готовности всех подключённых слушателей.
        </p>
      )}
      {error && (
        <div className="error-notice" role="alert">
          <p>{error}</p>
          <Button variant="outline" size="sm" disabled={!joined || activating} onClick={() => { void retryAudio(); }}>
            Повторить загрузку аудио
          </Button>
        </div>
      )}
      {room?.trackId && !track && catalogStatus === "ready" && (
        <p className="error-notice" role="alert">
          Текущий трек отсутствует в каталоге. HOST может выбрать другой.
        </p>
      )}
    </section>
  );
}
