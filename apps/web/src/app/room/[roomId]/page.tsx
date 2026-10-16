import { notFound } from "next/navigation";
import { roomIdSchema } from "@sync/shared";
import { RoomView } from "@/components/room-view";
export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) notFound();
  return <RoomView roomId={roomId} />;
}
