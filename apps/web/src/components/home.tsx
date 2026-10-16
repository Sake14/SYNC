"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  Headphones,
  Link2,
  Music2,
  Plus,
  Radio,
} from "lucide-react";
import { roomIdSchema } from "@sync/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cover } from "@/components/cover";
import { Shell, CatalogFailure, ErrorNotice } from "@/components/shell";
import { useQuickRoom } from "@/hooks/use-quick-room";
import { useRoomStore } from "@/stores/room-store";
import { formatTime } from "@/lib/playback";

export function Home() {
  const router = useRouter();
  const tracks = useRoomStore((s) => s.catalogTracks);
  const quickRoom=useQuickRoom();
  const busy=useRoomStore(s=>s.busy);
  const connection=useRoomStore(s=>s.connection);
  const catalogStatus = useRoomStore((s) => s.catalogStatus);
  const room = useRoomStore((s) => s.room);
  const joined = useRoomStore((s) => s.joined);
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");
  function join(event: FormEvent) {
    event.preventDefault();
    const result = roomIdSchema.safeParse(roomId.trim());
    if (!result.success) {
      setError("Введите корректный ID комнаты из приглашения");
      return;
    }
    router.push(`/join/${result.data}`);
  }
  return (
    <Shell>
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-line" /> СЛУШАЕМ ВМЕСТЕ
          </p>
          <h1>
            Один трек.
            <br />
            Общий <span>момент.</span>
          </h1>
          <p className="hero-description">
            Музыка звучит лучше, когда её есть с кем разделить.
            <br className="desktop-break" /> Создайте комнату, пригласите своих
            и нажмите play.
          </p>
          <div className="hero-actions">
            <Button onClick={()=>{void quickRoom();}} disabled={busy||connection!=="online"}>
                <Plus size={17} />
                {room && joined ? "Вернуться в комнату" : "Создать комнату"}
            </Button>
            <Button asChild variant="outline">
              <a href="#join">
                <Link2 />
                Войти по приглашению
              </a>
            </Button>
          </div>
          <ErrorNotice />
          <Link className="back-link" href="/create">Настроить имя и название комнаты</Link>
          <p className="hero-footnote">
            <Headphones size={14} /> Без регистрации. На любом устройстве.
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-disc" />
          <Cover title="Orbit" className="hero-cover" />
          <div className="art-caption">
            <span className="status-dot" /> YOUR MUSIC. YOUR PEOPLE.
          </div>
        </div>
      </section>
      <section id="library" className="library-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ВАША БИБЛИОТЕКА</p>
            <h2>Начните с хорошего трека</h2>
          </div>
          <span className="subtle-badge">
            <Music2 size={13} /> Локальный каталог
          </span>
        </div>
        {catalogStatus === "error" ? (
          <CatalogFailure />
        ) : catalogStatus === "loading" ? (
          <p className="muted" role="status">
            Загружаем музыку…
          </p>
        ) : !tracks.length ? (
          <p className="empty-state">
            Каталог пока пуст. Добавьте собственные MP3 в папку media и
            перезапустите backend.
          </p>
        ) : (
          <div className="album-grid">
            {tracks.map((track) => (
              <Link
                key={track.id}
                className="album-card"
                href={`/create?track=${encodeURIComponent(track.id)}`}
                aria-label={`Создать комнату с треком ${track.title}`}
              >
                <Cover title={track.title} kind={track.cover} />
                <div className="album-meta">
                  <div>
                    <h3>{track.title}</h3>
                    <p>{track.artist}</p>
                  </div>
                  <span>
                    {formatTime(track.durationSeconds)}
                    <ArrowUpRight size={18} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="library-note">
          Демо-треки синтезированы специально для SYNC. Никаких внешних
          музыкальных сервисов.
        </p>
        <Link className="back-link" href="/music-services">Музыкальные сервисы и ссылки Звука</Link>
      </section>
      <section id="join" className="join-strip">
        <div>
          <span className="icon-box">
            <Radio size={24} />
          </span>
          <h2>Вас уже ждут?</h2>
          <p>Введите ID комнаты или откройте ссылку от друга.</p>
        </div>
        <form onSubmit={join} noValidate>
          <label htmlFor="room-id">ID комнаты</label>
          <div className="input-row">
            <Input
              id="room-id"
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                setError("");
              }}
              placeholder="Например, x9Kp4nT2_aB7"
              autoComplete="off"
              maxLength={32}
              aria-invalid={!!error}
              aria-describedby="join-error"
            />
            <Button type="submit" aria-label="Войти в комнату">
              <ArrowRight />
            </Button>
          </div>
          <p id="join-error" className="form-feedback form-error" role="status">
            {error}
          </p>
        </form>
      </section>
    </Shell>
  );
}
