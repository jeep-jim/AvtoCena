import { NextRequest, NextResponse } from "next/server";
import { searchRussianCities } from "../../../../lib/location/cities";

export const dynamic = "force-dynamic";



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
    return NextResponse.json({ suggestions: searchRussianCities(query.slice(0, 100)) }, { headers: { "Cache-Control": "public, max-age=86400" } });
  }

  const ip = clientIp(request);
  if (!ip) return NextResponse.json({ city: "" });
  const data = await dadata(`iplocate/address?ip=${encodeURIComponent(ip)}`, { method: "GET" }).catch(() => null);
  const suggestion = cityFromSuggestion(data?.location);
  return NextResponse.json({ city: suggestion?.city || "", region: suggestion?.region || "" });
}
