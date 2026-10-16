import { NextResponse } from "next/server";
import { roomLibrarySchema, roomIdSchema } from "@sync/shared";
import { authorizeMediaResponse, roomAuthorization, mediaCookie } from "@/lib/server-media";
type Context={params:Promise<{roomId:string}>};

export async function POST(request:Request,{params}:Context) {
  const {roomId}=await params;const parsed=roomAuthorization(request,roomId);
  if(!parsed.success)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"Войдите в комнату."}},{status:401});
  try{
    const origin=process.env.API_INTERNAL_URL??"http://127.0.0.1:4000";
    const response=await fetch(new URL(`/api/rooms/${roomId}/library`,origin),{headers:{Authorization:`Bearer ${parsed.data.resumeToken}`},cache:"no-store",signal:AbortSignal.timeout(6000)});
    if(!response.ok)return NextResponse.json({error:{code:"MEDIA_ACCESS",message:"Нет доступа к музыке комнаты."}},{status:response.status});
    const library=roomLibrarySchema.parse(await response.json());
    return authorizeMediaResponse(request,roomId,parsed.data.resumeToken,NextResponse.json(library));
  }catch{return NextResponse.json({error:{code:"MEDIA_ACCESS",message:"Не удалось подключить музыку комнаты. Повторите попытку."}},{status:503});}
}
export async function DELETE(_request:Request,{params}:Context){
  const {roomId}=await params;if(!roomIdSchema.safeParse(roomId).success)return new Response(null,{status:400});
  const response=NextResponse.json({ok:true});response.cookies.set(mediaCookie(roomId),"",{httpOnly:true,sameSite:"strict",path:"/media",maxAge:0});return response;
}
