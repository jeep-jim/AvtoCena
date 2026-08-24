import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const LIST_URL = "https://api.encar.com/search/car/list/mobile?count=true&q=%28And.Hidden.N._.CarType.A.%29&sr=%7CMobileModifiedDate%7C0%7C20&inav=%7CMetadata%7CSort";
const CAR_URL = "https://car.encar.com/list/car?page=1&search=%7B%22type%22%3A%22car%22%2C%22action%22%3A%22%28And.Hidden.N._.MultiView2Hidden.N._.MultiViewHidden.N._.CarType.A.%29%22%2C%22toggle%22%3A%7B%7D%2C%22layer%22%3A%22%22%2C%22sort%22%3A%22MobileModifiedDate%22%7D";
const DETAIL_URL = "https://api.encar.com/v1/readside/vehicle/42256805";

function headers(cookie = ""): Record<string, string> {
  return {
    accept: "application/json,text/plain,*/*",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    origin: "https://car.encar.com",
    referer: "https://car.encar.com/",
    "user-agent": UA,
    ...(cookie ? { cookie } : {}),
  };
}

function preview(body: string) {
  return body.replace(/\s+/g, " ").slice(0, 450);
}

async function request(url: string, init: RequestInit = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      ...init,
    });
    const body = await response.text();
    const setCookie = response.headers.get("set-cookie") || "";
    let itemCount: number | null = null;
    let total: number | null = null;
    try {
      const json = JSON.parse(body);
      const items = json?.SearchResults || json?.searchResults || json?.cars || json?.items;
      itemCount = Array.isArray(items) ? items.length : null;
      total = Number(json?.Count ?? json?.count ?? NaN);
      if (!Number.isFinite(total)) total = null;
    } catch {}
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      bytes: body.length,
      itemCount,
      total,
      setCookie: setCookie ? setCookie.slice(0, 500) : "",
      preview: preview(body),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const cause = (error as any)?.cause;
    return {
      ok: false,
      error: String((error as Error)?.message || error),
      causeCode: String(cause?.code || ""),
      cause: String(cause?.message || "").slice(0, 300),
      durationMs: Date.now() - started,
    };
  }
}

export async function GET() {
  const home = await request("https://car.encar.com/", { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9,en;q=0.7" } });
  const rawCookie = typeof (home as any).setCookie === "string" ? (home as any).setCookie : "";
  const cookie = rawCookie
    .split(/,(?=[^;,]+=)/)
    .map((entry: string) => entry.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  const [directList, cookieList, carPage, mobilePage, detail] = await Promise.all([
    request(LIST_URL, { headers: headers() }),
    request(LIST_URL, { headers: headers(cookie) }),
    request(CAR_URL, { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9,en;q=0.7", ...(cookie ? { cookie } : {}) } }),
    request("https://m.encar.com/", { headers: { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9,en;q=0.7", ...(cookie ? { cookie } : {}) } }),
    request(DETAIL_URL, { headers: headers(cookie) }),
  ]);

  return NextResponse.json({
    mode: "temporary_read_only_encar_production_egress_probe",
    checkedAt: new Date().toISOString(),
    home,
    cookiePresent: Boolean(cookie),
    directList,
    cookieList,
    carPage,
    mobilePage,
    detail,
  }, { headers: { "cache-control": "no-store" } });
}
