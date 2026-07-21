import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const POPULAR_CITIES = ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Красноярск", "Омск", "Самара", "Челябинск", "Ростов-на-Дону", "Уфа", "Новокузнецк", "Барнаул", "Иркутск", "Владивосток"];

function token() {
  return String(process.env.DADATA_API_KEY || process.env.DADATA_TOKEN || "").trim();
}

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || real || "";
  if (!value || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/.test(value)) return "";
  return value;
}

function cityFromSuggestion(item: any) {
  const data = item?.data || {};
  const city = String(data.city || data.settlement || data.region || "").trim();
  const region = String(data.region_with_type || data.region || "").trim();
  return city ? { city, region, value: String(item?.value || city) } : null;
}

async function dadata(path: string, init?: RequestInit) {
  const apiKey = token();
  if (!apiKey) return null;
  const response = await fetch(`https://suggestions.dadata.ru/suggestions/api/4_1/rs/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Token ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function GET(request: NextRequest) {
  const query = String(request.nextUrl.searchParams.get("q") || "").trim();

  if (query) {
    const data = await dadata("suggest/address", {
      method: "POST",
      body: JSON.stringify({
        query,
        count: 10,
        from_bound: { value: "city" },
        to_bound: { value: "settlement" },
        locations: [{ country_iso_code: "RU" }],
        restrict_value: false,
      }),
    }).catch(() => null);
    const suggestions = (Array.isArray(data?.suggestions) ? data.suggestions : [])
      .map(cityFromSuggestion)
      .filter(Boolean)
      .filter((item: any, index: number, array: any[]) => array.findIndex((candidate) => candidate.city === item.city && candidate.region === item.region) === index);
    if (suggestions.length) return NextResponse.json({ suggestions });

    const normalized = query.toLocaleLowerCase("ru-RU");
    return NextResponse.json({ suggestions: POPULAR_CITIES.filter((city) => city.toLocaleLowerCase("ru-RU").includes(normalized)).map((city) => ({ city })) });
  }

  const ip = clientIp(request);
  if (!ip) return NextResponse.json({ city: "" });
  const data = await dadata(`iplocate/address?ip=${encodeURIComponent(ip)}`, { method: "GET" }).catch(() => null);
  const suggestion = cityFromSuggestion(data?.location);
  return NextResponse.json({ city: suggestion?.city || "", region: suggestion?.region || "" });
}
