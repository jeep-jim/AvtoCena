import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

const myAutoIds = ["120324181", "122993216"];
const autoPapaDetails = [
  "https://autopapa.ge/en/usd/chevrolet/captiva/932906",
  "https://autopapa.ge/en/usd/toyota/camry/953315",
];

function imageLike(value: string) {
  return /(?:https?:\/\/|\/)[^\s"'<>]+\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/i.test(value);
}

function summarizeJson(value: unknown) {
  const imageRefs: Array<{ path: string; value: string }> = [];
  const imageKeyPaths = new Set<string>();
  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 10 || imageRefs.length >= 100) return;
    if (typeof node === "string") {
      if (imageLike(node)) imageRefs.push({ path, value: node.slice(0, 500) });
      return;
    }
    if (Array.isArray(node)) {
      node.slice(0, 80).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/image|photo|gallery|media|picture|thumb/i.test(key)) imageKeyPaths.add(childPath);
      visit(child, childPath, depth + 1);
    }
  };
  visit(value, "", 0);
  return { imageKeyPaths: [...imageKeyPaths].slice(0, 100), imageRefs };
}

function autoPapaPhotos(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|href|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => {
    try { return new URL(value.replace(/&amp;/g, "&"), base).toString(); } catch { return ""; }
  }).filter((url) => {
    try { const parsed = new URL(url); return parsed.host === "autopapa.ge" && /\/system\/car\/photos\//i.test(parsed.pathname); } catch { return false; }
  }))].slice(0, 100);
}

export async function GET() {
  const myauto = [];
  for (const id of myAutoIds) {
    const url = `https://api2.myauto.ge/en/products/${id}`;
    const started = Date.now();
    try {
      const response = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const text = await response.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* status metadata is still useful */ }
      myauto.push({ id, status: response.status, bytes: Buffer.byteLength(text), ms: Date.now() - started,
        topKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data as Record<string, unknown>).slice(0, 80) : [],
        ...summarizeJson(data) });
    } catch (error) {
      myauto.push({ id, error: String((error as Error)?.message || error), ms: Date.now() - started });
    }
  }

  const autopapa = [];
  for (const url of autoPapaDetails) {
    const started = Date.now();
    try {
      const response = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const markup = await response.text();
      autopapa.push({ id: new URL(url).pathname.split("/").filter(Boolean).at(-1), status: response.status,
        bytes: Buffer.byteLength(markup), ms: Date.now() - started, photos: autoPapaPhotos(markup, response.url || url) });
    } catch (error) {
      autopapa.push({ id: new URL(url).pathname.split("/").filter(Boolean).at(-1), error: String((error as Error)?.message || error), ms: Date.now() - started });
    }
  }

  return NextResponse.json({ runtime: "yandex-serverless", mode: "fixed-gallery-schema-diagnostic", myauto, autopapa }, { headers: { "cache-control": "no-store" } });
}
