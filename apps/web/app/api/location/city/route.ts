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
  const city = String(data.city || data.settlement || "").trim();
  const region = String(data.region_with_type || data.region || "").trim();
  return city ? { city, region, value: String(item?.value || city) } : null;
}

function uniqueSuggestions(items: any[]) {
  return items
    .map(cityFromSuggestion)
    .filter(Boolean)
    .filter((item: any, index: number, array: any[]) => array.findIndex((candidate) => candidate.city === item.city && candidate.region === item.region) === index)
    .slice(0, 20);
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

async function suggestRussianCities(query: string) {
  const request = async (body: Record<string, unknown>) => {
    const data = await dadata("suggest/address", {
      method: "POST",
      body: JSON.stringify(body),
    }).catch(() => null);
    return uniqueSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
  };

  const cityOnly = await request({
    query,
    count: 20,
    from_bound: { value: "city" },
    to_bound: { value: "city" },
    locations: [{ country: "Россия" }],
    restrict_value: false,
  });
  if (cityOnly.length) return cityOnly;

  // A city prefix helps DaData resolve shortened compound names such as
  // "Петропавловск" -> "Петропавловск-Камчатский" without inventing aliases locally.
  const prefixed = await request({
    query: `г ${query}`,
    count: 20,
    from_bound: { value: "city" },
    to_bound: { value: "city" },
    locations: [{ country: "Россия" }],
    restrict_value: false,
  });
  if (prefixed.length) return prefixed;

  // Final DaData fallback keeps the search inside Russia but also accepts
  // settlements for users whose delivery locality is not formally a city.
  return request({
    query,
    count: 20,
    from_bound: { value: "city" },
    to_bound: { value: "settlement" },
    locations: [{ country: "Россия" }],
    restrict_value: false,
  });
}

export async function GET(request: NextRequest) {
  const query = String(request.nextUrl.searchParams.get("q") || "").trim();

  if (query) {
    const suggestions = await suggestRussianCities(query);
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
