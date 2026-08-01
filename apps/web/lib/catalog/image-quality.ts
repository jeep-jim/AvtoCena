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

const promoUrlPattern = /(?:^|[\/_-])(banner|bnr|campaign|promo|promotion|advert|ad_|loan|credit|warranty|guarantee|inspection|diagnosis|service|support|feature|header|footer|sprite|icon|logo|obd|low[-_]?rate|placeholder|no[-_ ]?photo|no[-_ ]?image|coming[-_ ]?soon|repair|maintenance|wrench|spanner|tools?|camera[-_ ]?off|car[-_ ]?silhouette|dummy)(?:[\/_\-.]|$)/i;

function text(value: unknown) {
  return String(value || "").trim();
}

function finite(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function stablePublicImageUrl(image: CatalogImageLike) {
  const id = text(image.id);
  return id ? `/api/catalog/images/${encodeURIComponent(id)}` : text(image.url);
}

function canonicalUrl(value: unknown) {
  const source = text(value);
  if (!source) return "";
  try {
    const url = new URL(source, "https://catalog.local");
    url.hash = "";
    url.search = "";
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/")}`;
  } catch {
    return source.replace(/[?#].*$/, "").replace(/\/{2,}/g, "/").toLowerCase();
  }
}

function catalogImageDedupKey(image: CatalogImageLike) {
  const checksum = text(image.checksum).toLowerCase();
  if (checksum) return `checksum:${checksum}`;
  const objectKey = canonicalUrl(image.objectKey);
  if (objectKey) return `object:${objectKey}`;
  const sourceUrl = canonicalUrl(image.url);
  if (sourceUrl) return `url:${sourceUrl}`;
  const id = text(image.id);
  return id ? `id:${id}` : "";
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
  return Boolean(text(image?.url || image?.objectKey)) && catalogImageScore(image) >= 0;
}

export function rankedCatalogImageUrls(offer: any) {
  const images: CatalogImageLike[] = Array.isArray(offer?.images) ? offer.images : [];
  const candidates = images
    .map((image, index) => ({
      image,
      index,
      url: stablePublicImageUrl(image),
      key: catalogImageDedupKey(image),
      score: catalogImageScore(image),
    }))
    .filter((candidate) => candidate.url && candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const seenKeys = new Set<string>();
  const seenUrls = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const renderedUrl = canonicalUrl(candidate.url);
    if ((candidate.key && seenKeys.has(candidate.key)) || (renderedUrl && seenUrls.has(renderedUrl))) continue;
    if (candidate.key) seenKeys.add(candidate.key);
    if (renderedUrl) seenUrls.add(renderedUrl);
    result.push(candidate.url);
    if (result.length >= 30) break;
  }
  return result;
}
