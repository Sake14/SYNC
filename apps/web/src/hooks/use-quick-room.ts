"use client";
import { useRouter } from "next/navigation";
import { displayNameSchema } from "@sync/shared";
import { createRoom, controlPlayer, useRoomStore } from "@/stores/room-store";
import { useProfileStore } from "@/stores/profile-store";

export function useQuickRoom() {
  const router=useRouter();
  return async(trackId?:string)=>{
    const current=useRoomStore.getState();
    if(current.joined&&current.room){router.push(`/room/${current.room.id}`);return;}
    const profile=useProfileStore.getState();const parsed=displayNameSchema.safeParse(profile.displayName);const name=parsed.success?parsed.data:"Гость";
    if(!parsed.success)profile.setDisplayName(name);
    const id=await createRoom(name,"Вечер вместе");if(!id)return;
    if(trackId)await controlPlayer("track",trackId);
    router.push(`/room/${id}`);
  };
}
