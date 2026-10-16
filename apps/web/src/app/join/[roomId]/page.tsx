import { notFound } from "next/navigation";
import { roomIdSchema } from "@sync/shared";
import { RoomForm } from "@/components/room-form";
export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) notFound();
  return <RoomForm roomId={roomId} />;
}
