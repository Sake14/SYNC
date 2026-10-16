"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Headphones,
  LoaderCircle,
} from "lucide-react";
import { displayNameSchema, roomCreateSchema } from "@sync/shared";
import { Shell, ErrorNotice } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Cover } from "@/components/cover";
import { useProfileStore } from "@/stores/profile-store";
import {
  useRoomStore,
  createRoom,
  joinRoom,
  leaveRoom,
  controlPlayer,
} from "@/stores/room-store";

export function RoomForm({
  roomId,
  initialTrack,
}: {
  roomId?: string;
  initialTrack?: string;
}) {
  const router = useRouter();
  const profileName = useProfileStore((s) => s.displayName);
  const saveName = useProfileStore((s) => s.setDisplayName);
  const { room, joined, busy, connection, tracks, catalogStatus } =
    useRoomStore();
  const [draft, setDraft] = useState<string | null>(null);
  const [name, setName] = useState("Вечер вместе");
  const [validation, setValidation] = useState("");
  const track = tracks.find((t) => t.id === initialTrack);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const displayName = displayNameSchema.safeParse(draft ?? profileName);
    if (!displayName.success) {
      setValidation(displayName.error.issues[0]?.message ?? "Введите имя");
      return;
    }
    if (
      !roomId &&
      !roomCreateSchema.safeParse({ displayName: displayName.data, name })
        .success
    ) {
      setValidation("Введите название комнаты: от 1 до 64 символов");
      return;
    }
    setValidation("");
    saveName(displayName.data);
    const id = roomId
      ? await joinRoom(roomId, displayName.data)
      : await createRoom(displayName.data, name.trim());
    if (!id) return;
    if (!roomId && track) await controlPlayer("track", track.id);
    router.push(`/room/${id}`);
  }
  return (
    <Shell>
      <div className="form-page">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> На главную
        </Link>
        <div className="form-layout">
          <section className="form-copy">
            <p className="eyebrow">
              {roomId ? "ПРИГЛАШЕНИЕ В SYNC" : "ВАШЕ МЕСТО ДЛЯ МУЗЫКИ"}
            </p>
            <h1>
              {roomId ? (
                <>
                  Своим здесь
                  <br />
                  <span>всегда рады.</span>
                </>
              ) : (
                <>
                  Соберите своих.
                  <br />
                  <span>Включите музыку.</span>
                </>
              )}
            </h1>
            <p className="hero-description">
              {roomId
                ? "Укажите имя, которое увидят другие слушатели. После входа включите звук на своём устройстве."
                : "Дайте комнате имя и пригласите друзей по ссылке или QR. Вы станете HOST и сможете управлять общим плеером."}
            </p>
            <div className="form-art">
              <Cover title={track?.title ?? "Together"} kind={track?.cover} />
              <span>
                <Headphones size={18} />{" "}
                {roomId ? "Почти на одной волне" : "Одна комната. Один ритм."}
              </span>
            </div>
          </section>
          <section className="form-panel">
            <span className="icon-box">
              <AudioLines size={24} />
            </span>
            <h2>{roomId ? "Войти в комнату" : "Новая комната"}</h2>
            {roomId && <p className="room-code">ID / {roomId}</p>}
            {joined && room ? (
              <div className="existing-room">
                <p>Вы уже слушаете в комнате «{room.name}».</p>
                <Button asChild>
                  <Link href={`/room/${room.id}`}>
                    Вернуться в комнату <ArrowRight />
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void leaveRoom();
                  }}
                  disabled={busy}
                >
                  Выйти и создать новую сессию
                </Button>
                <ErrorNotice />
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <div className="field">
                  <label htmlFor="listener-name">Ваше имя</label>
                  <Input
                    id="listener-name"
                    value={draft ?? profileName}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setValidation("");
                    }}
                    placeholder="Как вас называть?"
                    autoComplete="nickname"
                    maxLength={32}
                  />
                </div>
                {!roomId && (
                  <div className="field">
                    <label htmlFor="room-name">Название комнаты</label>
                    <Input
                      id="room-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setValidation("");
                      }}
                      maxLength={64}
                      placeholder="Например, пятничный вечер"
                    />
                  </div>
                )}
                {initialTrack &&
                  !roomId &&
                  catalogStatus !== "loading" &&
                  !track && (
                    <p className="form-note">
                      Выбранный трек недоступен. Будет создана пустая комната.
                    </p>
                  )}
                {track && !roomId && (
                  <p className="selected-track">
                    Первый трек: <strong>{track.title}</strong>
                  </p>
                )}
                <p className="form-feedback form-error" role="status">
                  {validation}
                </p>
                <ErrorNotice />
                <Button
                  type="submit"
                  className="submit-button"
                  disabled={
                    busy ||
                    connection !== "online" ||
                    (!!initialTrack && catalogStatus === "loading")
                  }
                >
                  {busy ? <LoaderCircle className="spin" /> : <ArrowRight />}
                  {roomId ? "Присоединиться" : "Создать комнату"}
                </Button>
                <p className="form-note">
                  {connection !== "online"
                    ? "Для входа нужно подключение к серверу."
                    : "Без пароля и регистрации. Только ваше имя."}
                </p>
              </form>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
