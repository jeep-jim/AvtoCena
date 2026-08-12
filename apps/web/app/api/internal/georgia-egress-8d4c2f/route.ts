import { NextResponse } from "next/server";
import { myAutoListSource } from "@/lib/catalog/myauto-list-source";
import { autoPapaGeorgiaSource, autoPapaDetailOriginalPhotoUrls } from "@/lib/catalog/autopapa-georgia-source";
import type { VehicleOffer } from "@/lib/catalog/types";
import { collectGeorgiaYandexRecoverySnapshot } from "@/lib/catalog/georgia-yandex-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

function absolute(value: string, base: string) {
  try { return new URL(value.replace(/&amp;/g, "&").replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}

function rawImages(offer: VehicleOffer) {
  const raw = (offer.operational?.raw || {}) as { images?: unknown[]; parsed?: { images?: unknown[] } };
  return [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])].map(String).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 30);
}

function scriptUrls(markup: string, base: string) {
  const urls = [...markup.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => absolute(match[1], base))
    .filter(Boolean)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return /(?:^|\.)(?:myauto\.ge|tnet\.ge)$/i.test(parsed.host) && /\.js(?:$|\?)/i.test(parsed.pathname + parsed.search);
      } catch { return false; }
    });
  return [...new Set(urls)];
}

function windowAt(text: string, index: number, before = 2_000, after = 4_000) {
  return text.slice(Math.max(0, index - before), Math.min(text.length, index + after));
}

function helperProof(text: string) {
  const compact = text.replace(/\s+/g, " ");
  const probes = ["E0:()=>", ".E0)(", ".E0)", "myauto/photos/thumbs/", "myauto/photos/"];
  const occurrences: Array<{ probe: string; index: number; snippet: string }> = [];
  for (const probe of probes) {
    let from = 0;
    while (occurrences.length < 24) {
      const index = compact.indexOf(probe, from);
      if (index < 0) break;
      occurrences.push({ probe, index, snippet: windowAt(compact, index, 1_200, 2_200) });
      from = index + probe.length;
    }
  }

  const exportTargets = [...new Set([...compact.matchAll(/E0:\(\)=>([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((match) => match[1]))].slice(0, 8);
  const definitions: Array<{ target: string; pattern: string; index: number; snippet: string }> = [];
  for (const target of exportTargets) {
    const patterns = [`${target}=function`, `function ${target}(`, `${target}=(`, `${target}=e=>`, `${target}=function(`];
    for (const pattern of patterns) {
      let from = 0;
      let hits = 0;
      while (hits < 3 && definitions.length < 24) {
        const index = compact.indexOf(pattern, from);
        if (index < 0) break;
        definitions.push({ target, pattern, index, snippet: windowAt(compact, index, 3_500, 6_500) });
        from = index + pattern.length;
        hits += 1;
      }
    }
  }
  return { exportTargets, occurrences, definitions };
}

async function fetchText(url: string, timeoutMs = 12_000) {
  const response = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { response, text };
}

function safeMyAutoSpecFields(info: Record<string, unknown>) {
  const allowed = /^(?:car_id|photo|photo_ver|pic_number|engine|engine_volume|engine_cc|fuel|fuel_type|power|power_hp|horsepower|cylinders?|transmission|gear|gear_type|drive|drive_type|man_id|model_id)$/i;
  return Object.fromEntries(Object.entries(info || {})
    .filter(([key, value]) => allowed.test(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 40));
}

async function inspectMyAuto() {
  const page = await myAutoListSource.fetchPage("1");
  const offer = (page.items || [])
    .map((item) => myAutoListSource.normalizeOffer(item as never))
    .find((candidate): candidate is VehicleOffer => Boolean(candidate && candidate.year >= 2020));
  if (!offer) return { ok: false, error: "no_current_2020_plus_offer" };

  const id = String(offer.sourceOfferId || "");
  const detailUrl = String(offer.operational?.sourceUrl || "");
  const apiResult = await fetchText(`https://api2.myauto.ge/en/products/${id}`);
  let api: any = null;
  try { api = JSON.parse(apiResult.text); } catch { /* metadata below is enough */ }
  const info = api?.data?.info || {};

  const detail = await fetchText(detailUrl, 15_000);
  const scripts = scriptUrls(detail.text, detail.response.url || detailUrl).slice(0, 16);
  const inspected = await Promise.all(scripts.map(async (url) => {
    try {
      const result = await fetchText(url, 10_000);
      const helper = helperProof(result.text);
      return {
        url,
        status: result.response.status,
        bytes: Buffer.byteLength(result.text),
        helper,
      };
    } catch (error) {
      return { url, error: String((error as Error)?.message || error) };
    }
  }));

  return {
    ok: true,
    id,
    make: offer.make,
    model: offer.model,
    year: offer.year,
    detailUrl,
    listImages: rawImages(offer),
    apiStatus: apiResult.response.status,
    photo: info.photo ?? null,
    photoVer: info.photo_ver ?? null,
    picNumber: info.pic_number ?? null,
    safeSpecFields: safeMyAutoSpecFields(info),
    detailStatus: detail.response.status,
    detailBytes: Buffer.byteLength(detail.text),
    scripts: inspected.filter((item) => "helper" in item && (item.helper.occurrences.length || item.helper.definitions.length)),
  };
}

async function inspectAutoPapa() {
  const page = await autoPapaGeorgiaSource.fetchPage("1");
  const offers = (page.items || [])
    .map((item) => autoPapaGeorgiaSource.normalizeOffer(item as never))
    .filter((offer): offer is VehicleOffer => Boolean(offer && offer.year >= 2020))
    .slice(0, 3);
  const samples = [];
  for (const offer of offers) {
    const detailUrl = String(offer.operational?.sourceUrl || "");
    const detail = await fetchText(detailUrl, 15_000);
    const originals = autoPapaDetailOriginalPhotoUrls(detail.text, detail.response.url || detailUrl).slice(0, 30);
    samples.push({
      id: offer.sourceOfferId,
      make: offer.make,
      model: offer.model,
      year: offer.year,
      sourcePrice: offer.sourcePrice,
      listImages: rawImages(offer),
      detailStatus: detail.response.status,
      originalCount: originals.length,
      originals,
    });
  }
  return { ok: true, fetched: page.items?.length || 0, normalized2020Plus: offers.length, samples };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "recovery") {
    const pages = Number(url.searchParams.get("pages") || 2);
    const snapshot = await collectGeorgiaYandexRecoverySnapshot(pages);
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  }

  const [myauto, autopapa] = await Promise.all([
    inspectMyAuto().catch((error) => ({ ok: false, error: String((error as Error)?.message || error) })),
    inspectAutoPapa().catch((error) => ({ ok: false, error: String((error as Error)?.message || error) })),
  ]);
  return NextResponse.json({
    runtime: "yandex-serverless",
    mode: "georgia-myauto-e0-helper-proof-read-only",
    myauto,
    autopapa,
  }, { headers: { "cache-control": "no-store" } });
}
