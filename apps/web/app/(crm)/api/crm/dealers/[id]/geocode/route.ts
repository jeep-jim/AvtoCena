import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { readDataJson, mutateDataJson, getJsonStorage } from "@/lib/data";
import { findDealer } from "@/lib/dealers/showcase-store";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    (await getCurrentUser())?.role !== "owner" ||
    !isCalculationOriginAllowed(req)
  )
    return Response.json({ error: "Доступ запрещён" }, { status: 403 });
  try {
    if (!(await findDealer((await params).id)))
      return Response.json({ error: "Компания не найдена" }, { status: 404 });
    const body = await req.json();
    if (body.acceptPolicy !== true)
      throw Error("Подтвердите условия поиска адресов OpenStreetMap");
    const q = [
      String(body.city || "")
        .trim()
        .slice(0, 120),
      String(body.address || "")
        .trim()
        .slice(0, 400),
    ].join(", ");
    if (!body.city || !body.address) throw Error("Укажите город и адрес");
    const key = `dealers/geocodes/${createHash("sha256").update(q).digest("hex")}.json`;
    const cached = await readDataJson<{ lat: number; lon: number } | null>(
      key,
      null,
    );
    if (cached) return Response.json(cached);
    await mutateDataJson<{ at: number }>(
      "dealers/geocode-rate.json",
      { at: 0 },
      (current) => {
        if (Date.now() - current.at < 1500)
          throw Error("Подождите две секунды перед следующим поиском");
        return { at: Date.now() };
      },
    );
    const endpoint =
      process.env.DEALER_GEOCODING_URL ||
      "https://nominatim.openstreetmap.org/search";
    const url = new URL(endpoint);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    const r = await fetch(url, {
      headers: {
        "User-Agent": "AvtoCena-DealerOffices/1.0 (+https://avtocena.com)",
        "Accept-Language": "ru",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw Error(
        "Поиск временно недоступен. Можно указать координаты вручную",
      );
    const rows = await r.json();
    const lat = Number(rows[0]?.lat),
      lon = Number(rows[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      throw Error("Адрес не найден. Уточните его или укажите координаты");
    const result = { lat, lon };
    await getJsonStorage().writeJson(key, result);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Не удалось найти адрес" },
      { status: 400 },
    );
  }
}
