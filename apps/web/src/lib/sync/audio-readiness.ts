import type { Readiness } from "@sync/shared";

export type BufferedMedia = {
  readyState: number;
  currentTime: number;
  buffered: { length: number; start(index: number): number; end(index: number): number };
};

export function bufferAhead(audio: BufferedMedia, position: number) {
  for (let i = 0; i < audio.buffered.length; i++) {
    if (audio.buffered.start(i) <= position + 0.02 && audio.buffered.end(i) > position)
      return Math.max(0, audio.buffered.end(i) - position);
  }
  return 0;
}

export function audioReadiness(input: {
  audio: BufferedMedia;
  duration: number;
  expected: number;
  sourceMatches: boolean;
  unlocked: boolean;
  clockSynced: boolean;
  playing: boolean;
  failed: boolean;
}): { status: Readiness["status"]; seconds: number; buffered: boolean; canContinue: boolean } {
  const { audio, duration, expected, sourceMatches, unlocked, clockSynced, playing, failed } = input;
  // Once playing, measure the decoder's actual cursor. Do not stop a healthy stream
  // merely because the server estimate is a few frames beyond the current buffer.
  const position = expected >= duration ? 0
    : playing && unlocked && audio.readyState ? audio.currentTime : expected;
  const seconds = sourceMatches ? bufferAhead(audio, position) : 0;
  const remaining = Math.max(0, duration - position);
  const buffered = sourceMatches && audio.readyState >= 2 && seconds > 0 &&
    seconds >= Math.min(playing && unlocked ? 0.12 : 0.75, remaining);
  const status = failed ? "error" : !unlocked ? "blocked" : !buffered ? "buffering"
    : !clockSynced ? "clock" : "ready";
  // Native audio can buffer/resume without destroying its play() request. Fresh
  // readiness is still required by the server for a new shared PLAY command.
  const canContinue = playing && unlocked && sourceMatches && !failed;
  return { status, seconds, buffered, canContinue };
}

export function mediaErrorMessage(code: number | undefined, message?: string) {
  if (code === 3 && /OnMediaSinkAudioError|NS_ERROR_DOM_MEDIA_MEDIASINK_ERR/.test(message ?? ""))
    return "Браузер не смог подключиться к аудиовыходу. Проверьте выбранные динамики или наушники и повторите загрузку; если ошибка останется, перезапустите браузер.";
  if (code === 2) return "Связь с аудиофайлом прервалась. Нажмите «Повторить загрузку аудио».";
  if (code === 3) return "Браузер не смог декодировать запись. Попробуйте MP3, AAC/M4A или PCM WAV.";
  if (code === 4) return "Аудиофайл недоступен или его формат не поддерживается. Повторите загрузку; если ошибка останется, выберите другой файл.";
  return "Не удалось загрузить аудио. Нажмите «Повторить загрузку аудио».";
}
