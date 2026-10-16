"use client";
import Link from "next/link";
import { useRoomStore } from "@/stores/room-store";
import { RoomView } from "@/components/room-view";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";

export default function Page() {
  const room = useRoomStore((s) => s.room);
  if (room) return <RoomView roomId={room.id} diagnostics />;
  return (
    <Shell>
      <section className="form-page">
        <p className="eyebrow">SYNC LAB</p>
        <h1>Проверка синхронизации</h1>
        <p className="muted">
          Создайте комнату или войдите по приглашению, затем откройте
          диагностику через ссылку в комнате. Во втором браузере повторите вход
          с другим именем.
        </p>
        <Button asChild>
          <Link href="/create">Создать комнату для теста</Link>
        </Button>
      </section>
    </Shell>
  );
}
