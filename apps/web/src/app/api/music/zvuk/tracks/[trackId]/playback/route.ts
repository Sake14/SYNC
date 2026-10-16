import { zvukTrackIdSchema, providerResultSchema, localPlaybackSchema } from "@sync/shared";

export async function GET(_request: Request, { params }: { params: Promise<{ trackId: string }> }) {
  const { trackId } = await params;
  if (!zvukTrackIdSchema.safeParse(trackId).success) return Response.json({ status: "INVALID_INPUT", message: "Некорректный ID композиции." }, { status: 400 });
  try {
    const response = await fetch(new URL(`/api/music/zvuk/tracks/${trackId}/playback`, process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const result = providerResultSchema(localPlaybackSchema).parse(await response.json());
    // This route only opens official pages; it never accepts an external stream as playable media.
    if (result.status === "OK" || (result.officialUrl && result.officialUrl !== `https://zvuk.com/track/${trackId}`)) throw new Error("Invalid external playback response");
    return Response.json(result, { status: response.status });
  } catch { return Response.json({ status: "SERVICE_UNAVAILABLE", message: "Состояние сервиса недоступно. Повторите попытку." }, { status: 503 }); }
}
