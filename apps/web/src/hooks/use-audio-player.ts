"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SyncEngine, type Track, type Readiness, type PlaybackState } from "@sync/shared";
import { useRoomStore, serverNow, clockIsReady, reportReadiness, publishMetrics, calibrateClock, prepareMediaSession } from "@/stores/room-store";
import { PlaybackScheduler } from "@/lib/sync/playback-scheduler";
import { audioReadiness, mediaErrorMessage } from "@/lib/sync/audio-readiness";
import { applyAudioOutput, configureMusicSession, musicSessionStatus, type MusicSessionHost } from "@/lib/sync/audio-output";
import { usesNativeAppleAudio } from "@/lib/sync/audio-profile";
import { DriftCorrector } from "@/lib/sync/drift-corrector";

export function useAudioPlayer(selectedTrack: Track | undefined) {
  const id = selectedTrack?.id, streamPath = selectedTrack?.streamPath, durationSeconds = selectedTrack?.durationSeconds;
  // Metadata snapshots may replace a Track object without replacing its audio.
  const track = useMemo(() => id && streamPath && durationSeconds !== undefined
    ? { id, streamPath, durationSeconds } : undefined, [id, streamPath, durationSeconds]);
  const trackRevision = useRoomStore(s => s.room?.trackRevision ?? 0);
  const mediaAllowed = useRoomStore(s => !track?.streamPath.startsWith("/media/room_") || s.mediaRoomId === s.room?.id);
  const audioRef = useRef<HTMLAudioElement>(null);
  const unlockedRef = useRef(false);
  const activatingRef = useRef(false);
  const primingRef = useRef(false);
  const failedRef = useRef(false);
  const activationRef = useRef({ epoch: 0, attempts: 0, cancel: () => {} });
  const outputRef = useRef({ volume: 0.7, muted: false });
  const applyRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [activating, setActivating] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [volumeSupported, setVolumeSupported] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nativeStatus, setNativeStatus] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    outputRef.current = { volume, muted };
    // iOS owns volume at OS level. Report the observed capability, not a UA guess.
    const supported = applyAudioOutput(audio, outputRef.current, primingRef.current);
    queueMicrotask(() => setVolumeSupported(supported));
  }, [volume, muted]);

  const enableAudio = useCallback(async (reload = false, automatic = false) => {
    const audio = audioRef.current;
    const state = useRoomStore.getState();
    if (!audio || !track || !state.room || activatingRef.current || !state.joined) return;
    if (track.streamPath.startsWith("/media/room_") && state.mediaRoomId !== state.room.id) {
      setError("Подключаем доступ к музыке комнаты…");
      if (await prepareMediaSession()) setError("Музыка подключена. Нажмите «Включить звук» для запуска на этом устройстве.");
      else setError("Не удалось подключить музыку комнаты. Проверьте сеть и повторите попытку.");
      return;
    }
    const activation = activationRef.current;
    const epoch = activation.epoch;
    const revision = state.room.trackRevision;
    const valid = () => epoch === activation.epoch && audioRef.current === audio &&
      useRoomStore.getState().room?.trackRevision === revision;
    activation.attempts++;
    activatingRef.current = true; setActivating(true); setError(""); failedRef.current = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let warmTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      configureMusicSession(navigator as MusicSessionHost);
      // Prime the new source without audible playback before the shared PLAY.
      primingRef.current = automatic;
      if (!automatic) {
        // Ready/recovery means enable sound. Unmute BEFORE play(), while the
        // user gesture is active, even if a cancelled preparation left it muted.
        outputRef.current = { volume: outputRef.current.volume || 0.7, muted: false };
        setMuted(false); setVolume(outputRef.current.volume);
      }
      applyAudioOutput(audio, outputRef.current, automatic);
      if (reload || audio.error || !audio.getAttribute("src")) audio.load();
      if (audio.readyState >= 1) {
        const target = new SyncEngine().positionAt(state.room, serverNow(), track.durationSeconds);
        try { audio.currentTime = target >= track.durationSeconds ? 0 : target; } catch { /* play() will load metadata. */ }
      }
      // Call synchronously in the click handler, before any network await. This
      // gesture starts loading on iPhone even when preload has supplied no data.
      audio.playbackRate = 1;
      const activationPosition = audio.currentTime;
      const playing = audio.play();
      const timeout = new Promise<never>((_resolve, reject) => {
        const cancel = () => reject(new DOMException("Audio activation cancelled", "AbortError"));
        activation.cancel = cancel;
        deadline = setTimeout(() => reject(new Error("Звук не удалось подготовить за 20 секунд. Проверьте сеть и повторите загрузку аудио.")), 20_000);
      });
      const warmed = playing.then(() => {
        if (valid()) { unlockedRef.current = true; setUnlocked(true); }
        return new Promise<void>((resolve, reject) => {
          const check = () => {
            if (!valid()) { reject(new DOMException("Track changed", "AbortError")); return; }
            if (audio.error) { reject(new Error(mediaErrorMessage(audio.error.code, audio.error.message))); return; }
            const latest = useRoomStore.getState().room!;
            const expected = new SyncEngine().positionAt(latest, serverNow(), track.durationSeconds);
            const buffer = audioReadiness({ audio, duration: track.durationSeconds, expected,
              sourceMatches: audio.currentSrc === new URL(track.streamPath, location.origin).href,
              unlocked: true, clockSynced: clockIsReady(), playing: latest.playbackState === "playing", failed: false });
            // Let native playback actually advance before ending the first
            // audible gesture. A resolved play promise + preload alone is not
            // evidence that Safari has started its output path.
            const advanced = automatic || audio.ended || (!audio.paused &&
              audio.currentTime - activationPosition >= Math.min(0.1, Math.max(0.01, (track.durationSeconds - activationPosition) / 2)));
            if (buffer.buffered && advanced) resolve();
            else warmTimer = setTimeout(check, 50);
          };
          check();
        });
      });
      await Promise.race([warmed, timeout]);
      if (valid()) { unlockedRef.current = true; setUnlocked(true); }
    } catch (reason) {
      if (valid()) {
        audio.pause(); setReady(false);
        const blocked = reason instanceof DOMException && reason.name === "NotAllowedError";
        unlockedRef.current = unlockedRef.current && !blocked; setUnlocked(unlockedRef.current);
        failedRef.current = !blocked;
        setError(blocked ? "Разрешите звук в браузере и нажмите кнопку ещё раз."
          : audio.error ? mediaErrorMessage(audio.error.code, audio.error.message)
            : reason instanceof Error ? reason.message : "Не удалось включить звук. Повторите загрузку аудио.");
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      if (warmTimer) clearTimeout(warmTimer);
      if (valid()) {
        const output = outputRef.current;
        primingRef.current = false;
        applyAudioOutput(audio, output);
        if (useRoomStore.getState().room?.playbackState === "paused") audio.pause();
        activation.cancel = () => {};
        activatingRef.current = false; setActivating(false); applyRef.current();
      }
    }
  }, [track]);

  // Install/cancel the controller at DOM commit, before a newly enabled button
  // can accept a gesture. A later passive setup must not invalidate that play().
  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const activation = activationRef.current;
    activation.epoch++;
    const initialAttempt = activation.attempts;
    let disposed = false, reporting = false;
    let lastReport = "", lastReportAt = -Infinity;
    let lastProgressAt = performance.now(), lastProgress = "";
    let lastNativeStatusAt = -Infinity;
    // The same HTMLAudioElement retains its successful user activation across
    // tracks. Only an actual NotAllowedError revokes this in the current tab.
    failedRef.current = false;
    const engine = new SyncEngine();
    // Match the early native player on Apple: no continuous time stretching.
    // Leave bounded native output latency alone; correct persistent large
    // errors after decoder settling, while explicit commands apply immediately.
    const nativeOutput = usesNativeAppleAudio(navigator.userAgent, navigator.maxTouchPoints);
    const scheduler = new PlaybackScheduler(audio, serverNow, reason => {
      if (disposed || (reason instanceof DOMException && reason.name === "AbortError")) return;
      const blocked = reason instanceof DOMException && reason.name === "NotAllowedError";
      if (blocked) { unlockedRef.current = false; setUnlocked(false); }
      setReady(false);
      failedRef.current = !blocked;
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Браузер приостановил звук. Нажмите «Включить звук» ещё раз."
        : mediaErrorMessage(audio.error?.code, audio.error?.message));
      apply();
    }, nativeOutput ? new DriftCorrector(0.04, 1, 0) : new DriftCorrector());
    function apply() {
      if (disposed || !audio) return;
      const { room, joined, connection } = useRoomStore.getState();
      if (!track || !room || room.trackId !== track.id || room.trackRevision !== trackRevision) {
        audio.pause(); setReady(false); return;
      }
      const now = serverNow();
      const target = engine.positionAt(room, now, track.durationSeconds);
      setPosition(target);
      const sourceMatches = audio.currentSrc === new URL(track.streamPath, location.origin).href;
      // A fast failed preload can precede our event listener. Inspect native
      // state too, so the initial effect cannot erase a real loading error.
      if (audio.error && (sourceMatches || (!audio.currentSrc && audio.networkState === audio.NETWORK_NO_SOURCE))) {
        failedRef.current = true;
        setError(mediaErrorMessage(audio.error.code, audio.error.message));
      }
      const clockSynced = clockIsReady();
      const readiness = audioReadiness({ audio, duration: track.durationSeconds, expected: target,
        sourceMatches, unlocked: unlockedRef.current, clockSynced, playing: room.playbackState === "playing", failed: failedRef.current });
      const end = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
      const progress = `${audio.readyState}:${end.toFixed(2)}`;
      if (progress !== lastProgress) { lastProgress = progress; lastProgressAt = performance.now(); }
      if (!failedRef.current && unlockedRef.current && !readiness.buffered && !activatingRef.current &&
          performance.now() - lastProgressAt > 20_000) {
        failedRef.current = true;
        audio.pause();
        setError("Загрузка аудио остановилась. Проверьте сеть и нажмите «Повторить загрузку аудио».");
        readiness.status = "error"; readiness.canContinue = false;
      }
      // Prepare a missing range only before playback. Repeated seeks into an
      // advancing server cursor interrupt Safari's decoder and its play promise.
      if (!activatingRef.current && !failedRef.current && !readiness.buffered && sourceMatches && audio.readyState >= 1 &&
          room.playbackState === "paused" && !audio.seeking) {
        if (target >= track.durationSeconds && unlockedRef.current) {
          // WebKit can discard the beginning after a seek near the end. Refill
          // it on the already activated element without another user gesture.
          void enableAudio(false, true);
        } else if (Math.abs(audio.currentTime - target) > 0.6) {
          try { audio.currentTime = target; } catch { /* Metadata may be replaced during source loading. */ }
        }
      }
      const status: Readiness["status"] = failedRef.current ? "error"
        : activatingRef.current ? "buffering" : readiness.status;
      const report: Readiness = { status, trackRevision,
        bufferedSeconds: Math.min(86400, Math.max(0, readiness.seconds)),
        soundUnlocked: unlockedRef.current, clockSynced };
      setReady(status === "ready"); setUnlocked(unlockedRef.current); setLoading(!readiness.buffered);
      const playback: PlaybackState = { roomId: room.id, trackId: room.trackId, trackRevision: room.trackRevision,
        position: room.position, startedAt: room.startedAt, playbackState: room.playbackState, revision: room.revision, serverTime: now };
      if (!activatingRef.current) {
        // Volume/mute are written only on an explicit output change or when
        // preparation ends. Repeated output writes must not reconfigure iOS.
        scheduler.update(playback, track.durationSeconds,
          status === "ready" || readiness.canContinue, joined && connection === "online");
      }
      if (performance.now() - lastNativeStatusAt >= 1000) {
        lastNativeStatusAt = performance.now();
        setNativeStatus(`Аудио: ${audio.paused ? "пауза" : "воспроизведение"}; позиция ${audio.currentTime.toFixed(1)} с; ` +
          `mute ${audio.muted ? "да" : "нет"}; громкость ${Math.round(audio.volume * 100)}%; ` +
          `скорость ${audio.playbackRate.toFixed(3)}; буфер ${audio.readyState}/4; ` +
          `режим ${nativeOutput ? "native" : "adaptive"}; авто-seek ${scheduler.automaticSeeks}; ` +
          `seek команд ${scheduler.commandSeeks}; сессия ${musicSessionStatus(navigator as MusicSessionHost)}.`);
      }
      publishMetrics(scheduler.metrics);
      const key = `${room.id}:${trackRevision}:${status}:${unlockedRef.current}:${clockSynced}`;
      if (joined && connection === "online" && !reporting &&
          (key !== lastReport || performance.now() - lastReportAt >= 4000)) {
        reporting = true;
        void reportReadiness(report).then(ok => {
          if (ok && !disposed) { lastReport = key; lastReportAt = performance.now(); }
        }).finally(() => { reporting = false; });
      }
    }
    applyRef.current = apply;
    const loaded = () => {
      if (!audio.error && audio.readyState >= 2) {
        failedRef.current = false;
        if (unlockedRef.current) setError("");
      }
      apply();
    };
    const failed = () => {
      failedRef.current = true;
      setError(mediaErrorMessage(audio.error?.code, audio.error?.message));
      setReady(false);
      apply();
    };
    const events = ["loadedmetadata", "loadeddata", "canplay", "playing", "progress", "waiting", "stalled", "seeking", "seeked", "ended"];
    for (const event of events) audio.addEventListener(event, loaded);
    audio.addEventListener("error", failed);
    const initial = setTimeout(() => {
      if (activation.attempts === initialAttempt && !audio.error && !failedRef.current) setError("");
      setUnlocked(unlockedRef.current); setActivating(activatingRef.current);
      apply();
      if (unlockedRef.current && mediaAllowed && !failedRef.current) void enableAudio(false, true);
    }, 0);
    const timer = setInterval(apply, 100);
    const unsubscribe = useRoomStore.subscribe((next, previous) => {
      if (next.room !== previous.room || next.joined !== previous.joined || next.connection !== previous.connection || next.clock !== previous.clock)
        queueMicrotask(apply);
    });
    const foreground = () => {
      if (document.visibilityState === "visible") { void calibrateClock(); apply(); }
    };
    document.addEventListener("visibilitychange", foreground);
    return () => {
      disposed = true;
      activation.epoch++;
      activation.cancel();
      activatingRef.current = false;
      primingRef.current = false;
      scheduler.destroy(); clearTimeout(initial); clearInterval(timer); unsubscribe();
      // Invalidated activation promises must not own mute on the reused element.
      applyAudioOutput(audio, outputRef.current);
      for (const event of events) audio.removeEventListener(event, loaded);
      audio.removeEventListener("error", failed);
      document.removeEventListener("visibilitychange", foreground);
      if (track) void reportReadiness({ trackRevision, status: "loading", bufferedSeconds: 0, soundUnlocked: false, clockSynced: false });
      publishMetrics(null);
    };
  }, [track, trackRevision, enableAudio, mediaAllowed]);

  function toggleMute() {
    const next = !(muted || volume === 0);
    const audio = audioRef.current;
    if (!next && volume === 0) setVolume(0.7);
    outputRef.current = { volume: !next && volume === 0 ? 0.7 : volume, muted: next };
    if (audio) applyAudioOutput(audio, outputRef.current, primingRef.current);
    setMuted(next);
  }
  function changeVolume(next: number) {
    outputRef.current = { ...outputRef.current, volume: next };
    if (audioRef.current) applyAudioOutput(audioRef.current, outputRef.current, primingRef.current);
    setVolume(next);
  }
  function recoverAudio() {
    if (activatingRef.current) return;
    // Restart the same decoder in a fresh gesture, keeping the shared timeline.
    audioRef.current?.pause();
    void enableAudio(false);
  }
  async function retryAudio() {
    if (activatingRef.current) return;
    if (track?.streamPath.startsWith("/media/room_")) {
      const epoch = activationRef.current.epoch;
      setError("Обновляем доступ к музыке комнаты…");
      const connected = await prepareMediaSession();
      if (epoch !== activationRef.current.epoch) return;
      if (!connected) {
        setError("Не удалось восстановить доступ к музыке. Проверьте подключение и повторите попытку.");
        return;
      }
      if (!unlockedRef.current) {
        audioRef.current?.load();
        setError("Доступ к файлу восстановлен. Нажмите «Включить звук» для разрешения воспроизведения.");
        return;
      }
      await enableAudio(true, true);
      return;
    }
    await enableAudio(true);
  }
  return { audioRef, ready, unlocked, activating, position, volume: volumeSupported ? volume : 1,
    setVolume: changeVolume, muted: muted || volume === 0, toggleMute, volumeSupported,
    error, loading, enableAudio, retryAudio, recoverAudio, nativeStatus };
}
