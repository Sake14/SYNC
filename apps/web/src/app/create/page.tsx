import { RoomForm } from "@/components/room-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ track?: string }>;
}) {
  const { track } = await searchParams;
  return <RoomForm initialTrack={track} />;
}
