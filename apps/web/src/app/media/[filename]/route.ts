type Context = { params: Promise<{ filename: string }> };
import { mediaCookie } from "@/lib/server-media";

async function proxy(request: Request, context: Context) {
  const { filename } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,128}\.(mp3|wav|ogg|m4a)$/.test(filename))
    return new Response(null, { status: 404 });
  try {
    const headers = new Headers();
    const uploaded = filename.match(/^room_([A-Za-z0-9_-]{12})_upload_[A-Za-z0-9_-]{32}\.(mp3|wav|ogg|m4a)$/);
    if(uploaded){const value=request.headers.get("cookie")?.split(";").map(pair=>pair.trim()).find(pair=>pair.startsWith(`${mediaCookie(uploaded[1]!)}=`))?.split("=")[1];if(!value||!/^[A-Za-z0-9_-]{32}$/.test(value))return new Response(null,{status:401});headers.set("Authorization",`Bearer ${value}`);}
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    const origin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    const response = await fetch(new URL(`/media/${filename}`, origin), {
      method: request.method,
      headers,
      cache: "no-store",
      signal: request.signal,
    });
    const forwarded = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = response.headers.get(name);
      if (value) forwarded.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: forwarded,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
export const GET = proxy;
export const HEAD = proxy;
