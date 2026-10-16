import { NextResponse } from "next/server";
import { uploadResponseSchema, httpErrorSchema } from "@sync/shared";
import { roomAuthorization, authorizeMediaResponse } from "@/lib/server-media";

export async function POST(request:Request,{params}:{params:Promise<{roomId:string}>}){
  const {roomId}=await params;const access=roomAuthorization(request,roomId);
  if(!access.success)return NextResponse.json({error:{code:"UNAUTHORIZED",message:"Войдите в комнату."}},{status:401});
  try{
    const headers=new Headers({Authorization:`Bearer ${access.data.resumeToken}`,"Content-Type":request.headers.get("content-type")??"application/octet-stream"});const size=request.headers.get("x-upload-size");if(size)headers.set("X-Upload-Size",size);
    const options:RequestInit & {duplex:"half"}={method:"POST",headers,body:request.body,duplex:"half",cache:"no-store",signal:request.signal};
    const upstream=await fetch(new URL(`/api/rooms/${roomId}/uploads`,process.env.API_INTERNAL_URL??"http://127.0.0.1:4000"),options);
    const body=await upstream.json();
    if(!upstream.ok){const error=httpErrorSchema.safeParse(body);return NextResponse.json(error.success?error.data:{error:{code:"UPLOAD_FAILED",message:"Сервер отклонил загрузку."}},{status:upstream.status});}
    return authorizeMediaResponse(request,roomId,access.data.resumeToken,NextResponse.json(uploadResponseSchema.parse(body),{status:201}));
  }catch{return NextResponse.json({error:{code:"UPLOAD_FAILED",message:"Связь прервалась во время загрузки. Повторите попытку."}},{status:503});}
}
