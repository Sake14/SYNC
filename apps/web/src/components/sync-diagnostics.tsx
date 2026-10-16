"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useRoomStore,
  calibrateClock,
  setInboundDelay,
} from "@/stores/room-store";

export function SyncDiagnostics() {
  const { metrics, clock, inboundDelayMs, room } = useRoomStore();
  const duration = useRoomStore(
    (s) => s.tracks.find((t) => t.id === s.room?.trackId)?.durationSeconds ?? 1,
  );
  useEffect(() => () => setInboundDelay(0), []);
  return (
    <section
      className="sync-diagnostics"
      aria-label="Диагностика синхронизации"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">SYNC LAB / РЕАЛЬНОЕ АУДИО</p>
          <h2>Наблюдение за временной позицией</h2>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void calibrateClock();
          }}
        >
          Измерить часы
        </Button>
      </div>
      <p className="muted">
        Откройте комнату во втором браузерном профиле, включите звук на обоих
        устройствах и сравнивайте шкалы. Drift = audio.currentTime − ожидаемая
        серверная позиция; это оценка позиции, а не измерение физического выхода
        звука.
      </p>
      <div className="sync-bars">
        <div>
          <span>Сервер</span>
          <meter
            aria-label="Ожидаемая позиция"
            min={0}
            max={duration}
            value={metrics?.expected ?? 0}
          />
          <b>{metrics?.expected.toFixed(3) ?? "—"} с</b>
        </div>
        <div>
          <span>Audio</span>
          <meter
            aria-label="Позиция HTMLAudioElement"
            min={0}
            max={duration}
            value={metrics?.actual ?? 0}
          />
          <b>{metrics?.actual.toFixed(3) ?? "—"} с</b>
        </div>
      </div>
      <dl className="sync-values">
        <div>
          <dt>Оценка drift</dt>
          <dd data-testid="sync-drift">
            {metrics?.driftMs !== null && metrics?.driftMs !== undefined
              ? `${metrics.driftMs.toFixed(1)} мс`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>playbackRate</dt>
          <dd data-testid="sync-rate">
            {metrics?.rate.toFixed(4) ?? "1.0000"}
          </dd>
        </div>
        <div>
          <dt>Режим / коррекция</dt>
          <dd data-testid="sync-phase">
            {metrics?.phase ?? "idle"} / {metrics?.correction ?? "none"}
          </dd>
        </div>
        <div>
          <dt>До общего старта</dt>
          <dd data-testid="sync-start">
            {Math.max(0, metrics?.startInMs ?? 0).toFixed(0)} мс
          </dd>
        </div>
        <div>
          <dt>Offset часов / RTT</dt>
          <dd>
            {clock
              ? `${clock.offsetMs.toFixed(1)} / ${clock.rttMs.toFixed(1)} мс`
              : "Калибровка…"}
          </dd>
        </div>
        <div>
          <dt>Clock samples / revision</dt>
          <dd>
            {clock?.samples ?? 0} / {room?.revision ?? 0}
          </dd>
        </div>
      </dl>
      <label className="field sync-delay">
        Искусственная задержка входящих snapshots/player:state (мс)
        <Input
          aria-label="Задержка сообщений"
          type="number"
          min={0}
          max={5000}
          step={100}
          value={inboundDelayMs}
          onChange={(e) => setInboundDelay(Number(e.target.value) || 0)}
        />
      </label>
      <p className="form-note">
        Задержка применяется в этой вкладке, включая ack плеера. Clock ping и
        аудио HTTP не задерживаются. Старые события после смены задержки
        защищены revision. При выходе с экрана задержка сбрасывается.
      </p>
    </section>
  );
}
