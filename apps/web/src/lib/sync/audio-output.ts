export type AudioOutputPreferences = { volume: number; muted: boolean };
type OutputPort = { volume: number; muted: boolean };
export type MusicSessionHost = { audioSession?: { type: string; state?: string } };

// AudioSession is optional. Its absence or a rejected setter must never prevent
// the synchronous native play() in the user's gesture.
export function configureMusicSession(host: MusicSessionHost) {
  try {
    if (!host.audioSession) return false;
    if (host.audioSession.type !== "playback") host.audioSession.type = "playback";
    return true;
  } catch { return false; }
}

export function musicSessionStatus(host: MusicSessionHost) {
  try {
    const session = host.audioSession;
    return session ? `${session.type}/${session.state ?? "—"}` : "API недоступен";
  } catch { return "API недоступен"; }
}

export function applyAudioOutput(audio: OutputPort, preferences: AudioOutputPreferences, preparing = false) {
  // iOS can leave volume under OS control, or reject the setter. Mute is still
  // controllable and must not leak from preparation into the next real play.
  try { if (audio.volume !== preferences.volume) audio.volume = preferences.volume; } catch { /* OS volume. */ }
  const muted = preparing || preferences.muted || preferences.volume === 0;
  if (audio.muted !== muted) audio.muted = muted;
  return Math.abs(audio.volume - preferences.volume) < 0.001;
}
