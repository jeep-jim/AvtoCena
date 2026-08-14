import { mashinaKyrgyzstanListSource } from "../apps/web/lib/catalog/mashina-kyrgyzstan-list-source";

process.env.CATALOG_SOURCE_TIMEOUT_MS ||= "15000";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER ||= "5";
process.env.CATALOG_MAX_IMAGES_PER_OFFER ||= "30";

const SAMPLE = Math.max(1, Math.min(8, Number(process.env.MASHINA_DIAG_SAMPLE || 6)));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

function imageIdentity(value: string) {
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"));
    const host = url.hostname.toLowerCase();
    let path = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
    if (!/\.(?:jpe?g|png|webp|avif)$/i.test(path)) return "";
    if (host === "storage.mashina.kg" && path.startsWith("/catalog/images/")) {
      path = path.replace(/_(?:small|medium|large)(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${path}`;
    }
    if (host === "im.mashina.kg" && path.startsWith("/tachka/images/")) {
      path = path.replace(/_\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `${host}${path}`;
    }
    return "";
  } catch { return ""; }
}

function extractMashinaImages(markup: string, base: string) {
  const values = new Set<string>();
  const candidates = [
    ...markup.matchAll(/https?:\\?\/\\?\/(?:storage|im)\.mashina\.kg\/[^"'<>\\\s]+/gi),
    ...markup.matchAll(/(?:src|href|data-src|data-original|content)\s*=\s*["']([^"']+)["']/gi),
  ];
  for (const match of candidates) {
    const raw = String(match[1] || match[0] || "").replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    try {
      const absolute = new URL(raw, base).toString();
      const identity = imageIdentity(absolute);
      if (identity) values.add(identity);
    } catch { /* ignore malformed candidates */ }
  }
  return [...values];
}

function detailVariants(sourceUrl: string) {
  const result = new Set<string>([sourceUrl]);
  try {
    const u = new URL(sourceUrl);
    for (const host of ["www.mashina.kg", "m.mashina.kg"]) {
      const v = new URL(u.toString());
      v.hostname = host;
      result.add(v.toString());
    }
  } catch { /* exact source URL remains */ }
  return [...result];
}

async function probe(url: string, make: string, model: string) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,*/*;q=0.8", "accept-language": "en-US,en;q=0.9,ru;q=0.8", "user-agent": UA, referer: "https://www.mashina.kg/en/search/" },
    }).finally(() => clearTimeout(timer));
    const markup = await response.text();
    const lower = markup.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ");
    const makeOk = lower.includes(make.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim());
    const modelToken = model.toLocaleLowerCase("en-US").split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0] || "";
    const modelOk = !modelToken || lower.includes(modelToken);
    const images = extractMashinaImages(markup, response.url || url);
    return { url, finalUrl: response.url, status: response.status, ms: Date.now() - started, bytes: markup.length, makeOk, modelOk, images: images.length, sampleImages: images.slice(0, 3) };
  } catch (error: any) {
    return { url, status: 0, ms: Date.now() - started, error: String(error?.name || error?.message || error), images: 0 };
  }
}

async function main() {
  const pageStart = Date.now();
  const page = await mashinaKyrgyzstanListSource.fetchPage("1");
  console.log(JSON.stringify({ event: "page", ms: Date.now() - pageStart, count: page.count, health: page.health }, null, 2));

  let sampled = 0;
  for (const raw of page.items as any[]) {
    if (sampled >= SAMPLE) break;
    const offer = mashinaKyrgyzstanListSource.normalizeOffer(raw);
    if (!offer) continue;
    sampled++;
    const listImages = Array.isArray(raw.images) ? raw.images.length : 0;
    const sourceUrl = String(offer.operational.sourceUrl || "");
    const variants = [];
    for (const variant of detailVariants(sourceUrl)) variants.push(await probe(variant, String(offer.make || ""), String(offer.model || "")));
    const adapterStart = Date.now();
    const gallery = await mashinaKyrgyzstanListSource.fetchImages(offer);
    const adapterMs = Date.now() - adapterStart;
    console.log(JSON.stringify({
      event: "listing",
      id: offer.sourceOfferId,
      title: `${offer.make} ${offer.model} ${offer.year}`,
      sourceUrl,
      listImages,
      probes: variants,
      adapter: { ms: adapterMs, images: gallery.length, verified: Boolean(offer.operational.galleryVerified), sampleImages: gallery.slice(0, 3).map((row: any) => row.url || row.sourceUrl || row) },
    }, null, 2));
  }

  if (!sampled) throw new Error("mashina_diag_no_normalized_samples");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
