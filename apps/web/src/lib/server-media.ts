import { roomAccessSchema } from "@sync/shared";
import { NextResponse } from "next/server";

export function mediaCookie(roomId:string) { return `sync-media-${roomId}`; }
export function roomAuthorization(request:Request,roomId:string) {
  return roomAccessSchema.safeParse({roomId,resumeToken:request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32})$/)?.[1]});
}
export function authorizeMediaResponse(request:Request,roomId:string,token:string,response:NextResponse) {
  response.cookies.set(mediaCookie(roomId),token,{httpOnly:true,sameSite:"strict",secure:new URL(request.url).protocol==="https:"||request.headers.get("x-forwarded-proto")==="https",path:"/media"});
  return response;
}
