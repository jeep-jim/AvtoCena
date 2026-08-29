export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE = "https://prestigemotorsport.com.au";
const LANDING = `${BASE}/auctions/`;
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const DETAIL = `${BASE}/auction-vehicle-display/`;
const ALLOWED_ACTIONS = new Set(["search_model_car", "search_results_car_dev"]);
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function response(body: string, status: number, contentType: string) {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType || "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-avtocena-source": "prestige_japan_auctions_open",
    },
  });
}

async function upstream(url: string, init?: RequestInit) {
  try {
    const result = await fetch(url, {
      ...init,
      headers: { ...HEADERS, ...(init?.headers || {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(40_000),
    });
    const body = await result.text();
    return response(body, result.status, result.headers.get("content-type") || "");
  } catch (error) {
    return Response.json({
      sourceId: "prestige_japan_auctions_open",
      error: String((error as Error)?.message || error).slice(0, 300),
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind === "landing") return upstream(LANDING, { headers: { referer: LANDING } });
  if (kind === "detail") {
    const carId = String(url.searchParams.get("carId") || "");
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(carId)) return Response.json({ error: "invalid_car_id" }, { status: 400 });
    return upstream(`${DETAIL}?car_id=${encodeURIComponent(carId)}`, { headers: { referer: LANDING } });
  }
  return Response.json({ error: "unsupported_prestige_egress_operation" }, { status: 400 });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("kind") !== "ajax") return Response.json({ error: "unsupported_prestige_egress_operation" }, { status: 400 });
  const body = await request.text();
  if (!body || body.length > 8_192) return Response.json({ error: "invalid_form_size" }, { status: 400 });
  const params = new URLSearchParams(body);
  const action = String(params.get("action") || "");
  if (!ALLOWED_ACTIONS.has(action)) return Response.json({ error: "unsupported_prestige_ajax_action" }, { status: 400 });
  if (!/^\d{1,8}$/.test(String(params.get("marka_id") || ""))) return Response.json({ error: "invalid_marka_id" }, { status: 400 });
  if (String(params.get("auction-date") || "") !== "Past") return Response.json({ error: "invalid_auction_date" }, { status: 400 });
  if (action === "search_results_car_dev") {
    const offset = Number(params.get("limit_start"));
    const yearFrom = Number(params.get("year_from"));
    const yearTo = Number(params.get("year_to"));
    const modelId = String(params.get("model_id") || "");
    if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return Response.json({ error: "invalid_limit_start" }, { status: 400 });
    if (!Number.isInteger(yearFrom) || yearFrom < 2010 || !Number.isInteger(yearTo) || yearTo < yearFrom || yearTo > 2100) return Response.json({ error: "invalid_year_range" }, { status: 400 });
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(modelId)) return Response.json({ error: "invalid_model_id" }, { status: 400 });
    if (params.getAll("auction_name[]").some((value) => value !== "2")) return Response.json({ error: "invalid_auction_name" }, { status: 400 });
  }
  return upstream(AJAX, {
    method: "POST",
    body: params.toString(),
    headers: {
      accept: "application/json,text/plain,*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      origin: BASE,
      referer: LANDING,
    },
  });
}
