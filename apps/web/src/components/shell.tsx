"use client";
import Link from "next/link";
import { AudioLines, Headphones, RefreshCw } from "lucide-react";
import { useRoomStore, reconnect } from "@/stores/room-store";
import { useProfileStore } from "@/stores/profile-store";
import { Button } from "@/components/ui/button";
import { useQuickRoom } from "@/hooks/use-quick-room";

export function Shell({ children }: { children: React.ReactNode }) {
  const connection = useRoomStore((s) => s.connection);
  const room = useRoomStore((s) => s.room);
  const joined = useRoomStore((s) => s.joined);
  const name = useProfileStore((s) => s.displayName);
  const theme = useProfileStore(s => s.theme);
  const quickRoom=useQuickRoom();const busy=useRoomStore(s=>s.busy);
  return (
    <div className="page-shell">
      <a className="skip-link" href="#main">
        К содержимому
      </a>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="SYNC — главная">
          <span className="brand-mark">
            <AudioLines size={22} />
          </span>
          SYNC<span className="brand-dot">.</span>
        </Link>
        <nav className="header-nav" aria-label="Основная навигация">
          <Link href="/">Обзор</Link>
          {room&&joined?<Link href={`/room/${room.id}`}>Моя комната</Link>:<button className="nav-create" disabled={busy||connection!=="online"} onClick={()=>{void quickRoom();}}>Новая комната</button>}
        </nav>
        <div className="header-right">
          <Button variant="ghost" size="sm" className="theme-toggle" aria-label="Переключить тему"
            onClick={() => useProfileStore.getState().setTheme(theme === "green" ? "violet" : "green")}>
            {theme === "green" ? "Зелёная" : "Фиолетовая"}
          </Button>
          <button
            className={`connection-pill ${connection === "online" ? "is-online" : ""}`}
            onClick={reconnect}
            disabled={connection === "online"}
            aria-label={
              connection === "online"
                ? "Сервер на связи"
                : "Подключиться к серверу"
            }
          >
            <span className="status-dot" />
            {connection === "online"
              ? "На связи"
              : connection === "connecting"
                ? "Подключаемся"
                : "Нет связи"}
            {connection === "offline" && <RefreshCw size={12} />}
          </button>
          <span className="profile-chip">
            <Headphones size={16} />
            <span>{name || "Слушатель"}</span>
          </span>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-footer">
        <span>Хорошая музыка. Своя компания.</span>
        <span>SYNC / ВРЕМЯ IT 2026</span>
      </footer>
    </div>
  );
}

export function ErrorNotice() {
  const error = useRoomStore((s) => s.error);
  return error ? (
    <p className="error-notice" role="alert">
      {error}
    </p>
  ) : null;
}
export function CatalogFailure() {
  return (
    <p className="muted">
      Каталог недоступен.{" "}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void import("@/stores/room-store").then((m) => m.loadTracks());
        }}
      >
        Повторить
      </Button>
    </p>
  );
}
