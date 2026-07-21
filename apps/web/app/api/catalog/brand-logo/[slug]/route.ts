import { NextRequest, NextResponse } from "next/server";
import { catalogBrandBySlug, catalogBrandDromSlug } from "@/lib/catalog/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DROM_ORIGIN = "https://auto.drom.ru";
const MANIFEST_TTL = 6 * 60 * 60 * 1000;

type LogoSet = { light?: string; dark?: string; any?: string };
type ManifestCache = { expiresAt: number; logos: Map<string, LogoSet> };

let manifestCache: ManifestCache | null = null;

function normalizedKey(value: string) {
  let decoded = String(value || "");
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded
    .toLowerCase()
    .replace(/\.(?:png|svg|webp)(?:\?.*)?$/i, "")
    .replace(/\.[a-f0-9]{6,}$/i, "")
    .replace(/-(?:dark|light)$/i, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function cleanHtml(text: string) {
  return text
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/");
}

function absoluteDromUrl(value: string) {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, DROM_ORIGIN);
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "drom.ru" || hostname.endsWith(".drom.ru"))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function collectLogos(text: string, target = new Map<string, LogoSet>()) {
  const html = cleanHtml(text);
  const matches = html.match(/(?:(?:https?:)?\/\/|\/)[^"'<>\s]+?\.(?:png|svg|webp)(?:\?[^"'<>\s]*)?/gi) || [];

  for (const raw of matches) {
    const url = absoluteDromUrl(raw);
    if (!url || !/\/js\/bundles\/media\//i.test(url)) continue;
    const filename = new URL(url).pathname.split("/").pop() || "";
    const withoutExtension = filename.replace(/\.(?:png|svg|webp)$/i, "").replace(/\.[a-f0-9]{6,}$/i, "");
    const themeMatch = withoutExtension.match(/^(.*?)-(dark|light)$/i);
    const base = themeMatch?.[1] || withoutExtension;
    const key = normalizedKey(base);
    if (!key) continue;
    const current = target.get(key) || {};
    if (themeMatch?.[2]?.toLowerCase() === "dark") current.dark = url;
    else if (themeMatch?.[2]?.toLowerCase() === "light") current.light = url;
    else current.any = url;
    target.set(key, current);
  }

  return target;
}

async function fetchPage(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 (compatible; AvtoCenaBrandLogos/1.0; +https://avtocena.com)",
    },
  });
  if (!response.ok) return "";
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.toString("latin1");
}

async function loadManifest() {
  if (manifestCache && manifestCache.expiresAt > Date.now()) return manifestCache.logos;

  const logos = new Map<string, LogoSet>();
  const pages = [
    "https://auto.drom.ru/",
    "https://www.drom.ru/",
    "https://moscow.drom.ru/",
  ];

  await Promise.all(pages.map(async (page) => {
    try { collectLogos(await fetchPage(page), logos); } catch {}
  }));

  manifestCache = { expiresAt: Date.now() + MANIFEST_TTL, logos };
  return logos;
}

function logoFor(logos: Map<string, LogoSet>, candidates: string[], theme: "light" | "dark") {
  for (const candidate of candidates) {
    const found = logos.get(normalizedKey(candidate));
    if (!found) continue;
    return found[theme] || found.any || found[theme === "dark" ? "light" : "dark"] || "";
  }
  return "";
}

async function loadBrandPageLogo(dromSlug: string, name: string, theme: "light" | "dark") {
  const logos = new Map<string, LogoSet>();
  const pages = [
    `${DROM_ORIGIN}/${encodeURIComponent(dromSlug)}/`,
    `https://www.drom.ru/catalog/${encodeURIComponent(dromSlug)}/`,
  ];

  await Promise.all(pages.map(async (page) => {
    try { collectLogos(await fetchPage(page), logos); } catch {}
  }));

  return logoFor(logos, [dromSlug, name], theme);
}

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const brand = catalogBrandBySlug(params.slug);
  if (!brand) return new NextResponse(null, { status: 404 });

  const theme = request.nextUrl.searchParams.get("theme") === "dark" ? "dark" : "light";
  const dromSlug = catalogBrandDromSlug(brand.name);
  const candidates = [dromSlug, brand.slug, brand.name];

  const manifest = await loadManifest();
  let source = logoFor(manifest, candidates, theme);
  if (!source) source = await loadBrandPageLogo(dromSlug, brand.name, theme);
  if (!source) return new NextResponse(null, { status: 404 });

  try {
    const response = await fetch(source, {
      next: { revalidate: 86400 },
      headers: {
        accept: "image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; AvtoCenaBrandLogos/1.0; +https://avtocena.com)",
      },
    });
    if (!response.ok) return new NextResponse(null, { status: 404 });
    const contentType = response.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) return new NextResponse(null, { status: 404 });
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
