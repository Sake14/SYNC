import { musicProvidersSchema } from "@sync/shared";

export async function GET() {
  try {
    const response = await fetch(new URL("/api/music/providers", process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"), { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Unavailable");
    return Response.json(musicProvidersSchema.parse(await response.json()));
  } catch { return Response.json({ error: "Не удалось получить состояние музыкальных сервисов." }, { status: 503 }); }
}
