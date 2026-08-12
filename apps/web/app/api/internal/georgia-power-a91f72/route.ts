import { NextResponse } from "next/server";
import { autoPapaDetailPowerHp } from "../../../../lib/catalog/autopapa-georgia-source";
import { readMarketOffers } from "../../../../lib/catalog/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

const TARGETS = [
  ["Honda", "Civic"], ["Chevrolet", "Trax"], ["Hyundai", "Elantra"], ["Toyota", "Prius"],
  ["Skoda", "Octavia"], ["Kia", "Forte"], ["Nissan", "Kicks"], ["Land Rover", "Range Rover Velar"],
  ["Chevrolet", "Trailblazer"], ["Mazda", "CX-30"], ["Acura", "Integra"], ["Infiniti", "QX50"],
  ["Tesla", "Model Y"], ["Subaru", "WRX"], ["Toyota", "Corolla"], ["Mazda", "CX-5"],
] as const;

function plain(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordSnippets(markup: string) {
  const text = plain(markup);
  const matches: Array<{ keyword: string; snippet: string }> = [];
  const re = /\b(?:horsepower|horse power|power|hp|kw|kilowatt|engine|motor|electric|hybrid)\b/gi;
  for (const match of text.matchAll(re)) {
    const index = match.index || 0;
    const snippet = text.slice(Math.max(0, index - 180), Math.min(text.length, index + 260)).trim();
    if (!matches.some((row) => row.snippet === snippet)) matches.push({ keyword: match[0], snippet });
    if (matches.length >= 30) break;
  }
  return matches;
}

function structuredPowerFields(markup: string) {
  const hits: Array<{ path: string; value: string }> = [];
  const scripts = [...markup.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 10 || hits.length >= 80 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.slice(0, 100).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/power|horse|\bhp\b|kilowatt|\bkw\b|engine|motor|electric|hybrid/i.test(key) && ["string", "number", "boolean"].includes(typeof child)) {
        hits.push({ path: childPath, value: String(child).slice(0, 300) });
      }
      visit(child, childPath, depth + 1);
    }
  };
  for (const script of scripts) {
    try { visit(JSON.parse(script[1]), "", 0); } catch { /* not valid JSON */ }
  }
  return hits;
}

function exactAutoPapaUrl(offer: any) {
  const id = String(offer?.sourceOfferId || "");
  const sourceUrl = String(offer?.operational?.sourceUrl || "");
  if (!/^\d{5,}$/.test(id) || !sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.hostname !== "autopapa.ge") return "";
    if (!new RegExp(`/${id}/?$`).test(url.pathname)) return "";
    return url.toString();
  } catch { return ""; }
}

async function inspect(offer: any, verbose = false) {
  const id = String(offer?.sourceOfferId || "");
  const url = exactAutoPapaUrl(offer);
  if (!url) return { sourceOfferId: id, error: "missing_exact_autopapa_source_url" };
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const markup = await response.text();
    const finalUrl = response.url || url;
    let finalIdentity = false;
    try { finalIdentity = new URL(finalUrl).hostname === "autopapa.ge" && new RegExp(`/${id}/?$`).test(new URL(finalUrl).pathname); } catch { /* false */ }
    if (!response.ok || !finalIdentity) {
      return { sourceOfferId: id, make: offer.make, model: offer.model, exactSourceUrl: url, status: response.status,
        error: !response.ok ? `http_${response.status}` : "redirect_identity", ms: Date.now() - started };
    }
    const base = {
      id: offer.id,
      sourceOfferId: id,
      make: offer.make,
      model: offer.model,
      year: offer.year,
      engineCc: offer.engineCc,
      fuel: offer.fuel,
      powertrainKind: offer.powertrainKind,
      currentPowerHp: offer.powerHp,
      detailPowerHp: autoPapaDetailPowerHp(markup),
      calculationStatus: offer.calculationStatus,
      exactSourceUrl: url,
      status: response.status,
      bytes: Buffer.byteLength(markup),
      ms: Date.now() - started,
    };
    return verbose ? { ...base, snippets: keywordSnippets(markup), structured: structuredPowerFields(markup) } : base;
  } catch (error) {
    return { sourceOfferId: id, make: offer.make, model: offer.model, exactSourceUrl: url,
      error: String((error as Error)?.message || error), ms: Date.now() - started };
  }
}

async function pool(rows: any[], concurrency: number, verbose: boolean) {
  const results = new Array<any>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, rows.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      results[index] = await inspect(rows[index], verbose);
    }
  }));
  return results;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const allOffers = (await readMarketOffers("georgia"))
    .filter((offer) => offer.sourceId === "autopapa_georgia_open" && Number(offer.year || 0) >= 2020);

  if (requestUrl.searchParams.get("batch") === "1") {
    const candidates = allOffers
      .filter((offer) => String(offer.powertrainKind || "") === "combustion" && !(Number(offer.powerHp || 0) > 0) && exactAutoPapaUrl(offer))
      .sort((left, right) => String(left.sourceOfferId || "").localeCompare(String(right.sourceOfferId || "")) || String(left.id).localeCompare(String(right.id)));
    const offset = Math.max(0, Math.floor(Number(requestUrl.searchParams.get("offset") || 0)));
    const limit = Math.max(1, Math.min(80, Math.floor(Number(requestUrl.searchParams.get("limit") || 40))));
    const selected = candidates.slice(offset, offset + limit);
    const results = await pool(selected, 6, false);
    return NextResponse.json({
      runtime: "yandex-serverless",
      mode: "read-only-exact-autopapa-power-batch",
      liveGeorgia: allOffers.length,
      totalCandidates: candidates.length,
      offset,
      limit,
      inspected: results.length,
      parsedExactPowerCount: results.filter((row) => Number(row?.detailPowerHp || 0) > 0).length,
      nextOffset: offset + selected.length < candidates.length ? offset + selected.length : null,
      results,
    }, { headers: { "cache-control": "no-store" } });
  }

  const selected: any[] = [];
  for (const [make, model] of TARGETS) {
    const row = allOffers.find((offer) => String(offer.make) === make && String(offer.model) === model && !selected.some((item) => item.id === offer.id));
    if (row) selected.push(row);
  }
  for (const row of allOffers.filter((offer) => ["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || "")))) {
    if (selected.length >= 24) break;
    if (!selected.some((item) => item.id === row.id)) selected.push(row);
  }
  const results = await pool(selected, 4, true);
  return NextResponse.json({
    runtime: "yandex-serverless",
    mode: "read-only-exact-autopapa-power-detail",
    liveGeorgia: allOffers.length,
    inspected: results.length,
    results,
  }, { headers: { "cache-control": "no-store" } });
}