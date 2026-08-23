type CatalogImageLike = {
  id?: unknown;
  url?: unknown;
  objectKey?: unknown;
  checksum?: unknown;
  width?: unknown;
  height?: unknown;
  size?: unknown;
  mimeType?: unknown;
};

const promoUrlPattern = /(?:^|[\/_-])(banner|bnr|campaign|promo|promotion|advert|ad_|loan|credit|warranty|guarantee|inspection|diagnosis|service|support|feature|header|footer|sprite|icon|logo|users|obd|low[-_]?rate|placeholder|no[-_ ]?photo|no[-_ ]?image|coming[-_ ]?soon|repair|maintenance|wrench|spanner|tools?|camera[-_ ]?off|car[-_ ]?silhouette|dummy|cdn[-_]?cgi|challenge[-_]?platform)(?:[\/_\-.]|$)/i;

function text(value: unknown) {
  return String(value || "").trim();
}

function finite(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

export function catalogImageDeliveryUrl(value: unknown) {
  const source = text(value);
  if (!source) return "";
  try {
    const url = new URL(source);
    // Carused list cards deliberately request 133px thumbnails. The same exact
    // listing-bound object returns its source 640x480 JPEG when the resize query
    // is omitted. Never stretch the 133x100 thumbnail in the customer UI.
    if (url.hostname.toLowerCase() === "d1og64tg0ubvon.cloudfront.net"
      && /^\/refno-cars\//i.test(url.pathname)) {
      url.searchParams.delete("w");
      return url.toString();
    }
    return source;
  } catch {
    return source;
  }
}

function stablePublicImageUrl(image: CatalogImageLike) {
  const sourceUrl = text(image.url);
  const id = text(image.id);
  const objectKey = text(image.objectKey);
  if (id && objectKey) return `/api/catalog/images/${encodeURIComponent(id)}`;
  return catalogImageDeliveryUrl(sourceUrl);
}

function canonicalUrl(value: unknown) {
  const source = text(value);
  if (!source) return "";
  try {
    const url = new URL(source, "https://catalog.local");
    url.hash = "";
    url.search = "";
    const hostname = url.hostname.toLowerCase();
    let pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
    // Mashina.kg exposes one exact source photo through multiple delivery sizes.
    // Collapse only the known size suffix, never the source-photo hash itself.
    if (hostname === "storage.mashina.kg") {
      pathname = pathname.replace(/_(?:small|medium|large)(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
    } else if (hostname === "im.mashina.kg") {
      pathname = pathname.replace(/_\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
    }
    return `${hostname}${pathname}`;
  } catch {
    return source.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/").toLowerCase();
  }
}

function autoHomePhotoIdentity(value: unknown) {
  const source = text(value);
  if (!source) return "";
  try {
    const url = new URL(source, "https://catalog.local");
    if (!/(?:^|\.)autoimg\.cn$/i.test(url.hostname)) return "";
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "")
      .replace(/^\d{2,4}x\d{1,4}_c\d+_/i, "")
      .toLowerCase();
    return filename.includes("autohomecar__") ? `autohome:${filename}` : "";
  } catch { return ""; }
}

function catalogImageDedupKey(image: CatalogImageLike) {
  const sourceUrl = text(image.url);
  const autohomeIdentity = autoHomePhotoIdentity(sourceUrl);
  if (autohomeIdentity) return autohomeIdentity;
  // Source-URL identity must win for Mashina because source_urls_only stores
  // different delivery renditions as separate image records/checksums.
  if (/^https?:\/\/(?:storage|im)\.mashina\.kg\//i.test(sourceUrl)) {
    const canonical = canonicalUrl(sourceUrl);
    if (canonical) return `mashina:${canonical}`;
  }
  const checksum = text(image.checksum).toLowerCase();
  if (checksum) return `checksum:${checksum}`;
  const objectKey = canonicalUrl(image.objectKey);
  if (objectKey) return `object:${objectKey}`;
  const canonicalSource = canonicalUrl(sourceUrl);
  if (canonicalSource) return `url:${canonicalSource}`;
  const id = text(image.id);
  return id ? `id:${id}` : "";
}

function hasImageEvidence(image: CatalogImageLike) {
  const url = text(image.url || image.objectKey);
  const mime = text(image.mimeType).toLowerCase();
  const width = finite(image.width);
  const height = finite(image.height);
  const id = text(image.id);
  const objectKey = text(image.objectKey);

  // Stored binaries were already decoded/validated by the importer.
  if (id && objectKey) return true;
  if (/^image\/(?:jpe?g|png|webp|avif|gif)$/i.test(mime)) return true;
  if (/\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i.test(url)) return true;
  if (width >= 420 && height >= 260) return true;

  // Explicit source-image delivery contracts whose URLs intentionally have no
  // ordinary file extension. Arbitrary website/root/listing URLs are not images.
  if (/^https?:\/\/[^/]*apollo\.olxcdn\.com\/v1\/files\/[^/]+\/image(?:[;/?#]|$)/i.test(url)) return true;
  if (/^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\/[^/?#]+\/\d{2,5}x\d{2,5}\.(?:jpe?g|webp|avif|png)(?:[?#]|$)/i.test(url)) return true;
  if (/^https?:\/\/(?:storage|im)\.mashina\.kg\//i.test(url)) return true;
  if (/^https?:\/\/(?:car\d+|g)\.autoimg\.cn\//i.test(url)) return true;

  return false;
}

export function catalogImageScore(image: CatalogImageLike) {
  const url = text(image.url || image.objectKey);
  const mime = text(image.mimeType).toLowerCase();
  const width = finite(image.width);
  const height = finite(image.height);
  const size = finite(image.size);
  const pixels = width && height ? width * height : 0;
  const density = pixels && size ? size / pixels : 0;
  const ratio = width && height ? width / height : 0;
  let score = 0;

  if (promoUrlPattern.test(url)) score -= 20;
  if (/image\/(?:svg|gif)/.test(mime) || /\.(?:svg|gif)(?:\?|$)/i.test(url)) score -= 20;
  if (/image\/png/.test(mime) || /\.png(?:\?|$)/i.test(url)) score -= 7;
  if (/image\/(?:jpe?g|webp|avif)/.test(mime) || /\.(?:jpe?g|webp|avif)(?:\?|$)/i.test(url)) score += 3;

  // Prefer the largest known rendition before canonical identity collapses the
  // delivery-size variants into one gallery frame.
  if (/^https?:\/\/storage\.mashina\.kg\/.*_large\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) score += 4;
  else if (/^https?:\/\/storage\.mashina\.kg\/.*_medium\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) score += 2;
  else if (/^https?:\/\/storage\.mashina\.kg\/.*_small\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) score -= 2;
  const legacySize = url.match(/^https?:\/\/im\.mashina\.kg\/.*_(\d{2,5})x(\d{2,5})\.(?:jpe?g|png|webp|avif)(?:\?|$)/i);
  if (legacySize) score += Math.min(4, Math.max(0, Math.log2((Number(legacySize[1]) * Number(legacySize[2])) / (640 * 480))));

  if (width && height) {
    if (width >= 640 && height >= 400) score += 3;
    if (width < 420 || height < 260) score -= 10;
    if (ratio >= 1.08 && ratio <= 2.2) score += 3;
    else score -= 12;
  }

  if (density) {
    if (density < 0.035) score -= 8;
    else if (density < 0.06) score -= 3;
    else if (density > 0.11) score += 2;
  }
  if (size && size < 28_000) score -= 8;
  else if (size >= 90_000) score += 2;

  return score;
}

export function isLikelyVehicleImage(image: CatalogImageLike) {
  return Boolean(text(image?.url || image?.objectKey)) && hasImageEvidence(image) && catalogImageScore(image) >= 0;
}

export function rankedCatalogImageUrls(offer: any) {
  const images: CatalogImageLike[] = Array.isArray(offer?.images) ? offer.images : [];
  const candidates = images
    .map((image, index) => ({
      image, index, url: stablePublicImageUrl(image), key: catalogImageDedupKey(image), score: catalogImageScore(image),
      sourceUrl: text(image.url),
    }))
    .filter((candidate) => candidate.url && isLikelyVehicleImage(candidate.image));

  // AutoHome legacy public rows can contain one 900px image followed by 240px
  // thumbnails even when a full-size exact gallery exists upstream. Do not render
  // those tiny delivery renditions in the customer gallery. The exact-gallery
  // refresh replaces them in storage; this display guard prevents blur meanwhile.
  const displayCandidates = candidates.filter((candidate) =>
    !/^https?:\/\/g\.autoimg\.cn\/@img\/.*\/(?:240|300|320|360|400)x0_c\d+_/i.test(candidate.sourceUrl));
  const usable = displayCandidates.length ? displayCandidates : candidates;

  // Preserve source gallery/cover order. For duplicate delivery renditions of the
  // same source photo, keep the highest-quality rendition but retain the original
  // photo's first source position. Global score sorting used to move dashboards or
  // inspection frames ahead of a source-designated exterior cover.
  const groups = new Map<string, { firstIndex: number; best: typeof usable[number] }>();
  for (const candidate of usable) {
    const renderedUrl = canonicalUrl(candidate.url);
    const key = candidate.key || (renderedUrl ? `rendered:${renderedUrl}` : `index:${candidate.index}`);
    const existing = groups.get(key);
    const directAutoHome = /^https?:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i.test(candidate.sourceUrl) ? 8 : 0;
    const existingDirect = existing && /^https?:\/\/car\d+\.autoimg\.cn\/cardfs\/product\//i.test(existing.best.sourceUrl) ? 8 : 0;
    if (!existing) groups.set(key, { firstIndex: candidate.index, best: candidate });
    else if (candidate.score + directAutoHome > existing.best.score + existingDirect) groups.set(key, { firstIndex: existing.firstIndex, best: candidate });
  }

  const seenUrls = new Set<string>();
  const result: string[] = [];
  for (const group of [...groups.values()].sort((a, b) => a.firstIndex - b.firstIndex)) {
    const renderedUrl = canonicalUrl(group.best.url);
    if (renderedUrl && seenUrls.has(renderedUrl)) continue;
    if (renderedUrl) seenUrls.add(renderedUrl);
    result.push(group.best.url);
    if (result.length >= 30) break;
  }
  return result;
}
