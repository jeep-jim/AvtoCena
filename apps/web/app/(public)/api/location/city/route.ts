import { NextResponse } from "next/server";

const DADATA_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";
const BOT_RE = /bot|crawler|spider|slurp|yandex|google|bing|duckduck/i;

function token() {
  return String(process.env.DADATA_API_KEY || "").trim();
}

function headers() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Token ${token()}`,
  };
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const value = forwarded || real || "";
  return value.replace(/^::ffff:/, "");
}

function cityFromSuggestion(suggestion: any) {
  const data = suggestion?.data || {};
  const city = String(data.city_with_type || data.settlement_with_type || data.city || data.settlement || suggestion?.value || "").trim();
  return city.replace(/^г\s+/i, "").trim();
}

export async function GET(request: Request) {
  const apiKey = token();
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, city: null, suggestions: [] });

  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim().slice(0, 120);

  try {
    if (query) {
      const response = await fetch(`${DADATA_URL}/suggest/address`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          query,
          count: 8,
          from_bound: { value: "city" },
          to_bound: { value: "settlement" },
        }),
        cache: "no-store",
      });
      if (!response.ok) return NextResponse.json({ ok: false, configured: true, suggestions: [] }, { status: 502 });
      const data = await response.json();
      const suggestions = [...new Set((Array.isArray(data?.suggestions) ? data.suggestions : [])
        .filter((item: any) => !item?.data?.country_iso_code || item.data.country_iso_code === "RU")
        .map(cityFromSuggestion)
        .filter(Boolean))];
      return NextResponse.json({ ok: true, configured: true, suggestions });
    }

    const userAgent = request.headers.get("user-agent") || "";
    const ip = clientIp(request);
    if (!ip || BOT_RE.test(userAgent)) return NextResponse.json({ ok: true, configured: true, city: null });

    const response = await fetch(`${DADATA_URL}/iplocate/address?ip=${encodeURIComponent(ip)}`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ ok: false, configured: true, city: null }, { status: 502 });
    const data = await response.json();
    return NextResponse.json({ ok: true, configured: true, city: cityFromSuggestion(data?.location) || null });
  } catch {
    return NextResponse.json({ ok: false, configured: true, city: null, suggestions: [] }, { status: 502 });
  }
}
