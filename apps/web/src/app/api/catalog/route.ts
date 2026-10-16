import { catalogSchema } from "@sync/shared";

export async function GET() {
  try {
    const origin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    const response = await fetch(new URL("/api/catalog", origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Unavailable");
    return Response.json(catalogSchema.parse(await response.json()));
  } catch {
    return Response.json(
      { error: "Музыкальный каталог недоступен" },
      { status: 503 },
    );
  }
}
