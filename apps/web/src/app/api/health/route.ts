import { healthSchema } from "@sync/shared";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const response = await fetch(new URL("/health", process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"), { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("Backend unavailable");
    const health = healthSchema.parse(await response.json());
    return Response.json(health, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Сервер пока недоступен" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
