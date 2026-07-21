type CatalogImageLike = {
  url?: unknown;
  objectKey?: unknown;
  width?: unknown;
  height?: unknown;
  size?: unknown;
  mimeType?: unknown;
};

const promoUrlPattern = /(?:^|[\/_-])(banner|bnr|campaign|promo|promotion|advert|ad_|loan|credit|warranty|guarantee|inspection|diagnosis|service|support|campaign|feature|header|footer|sprite|icon|logo|obd|low[-_]?rate)(?:[\/_\-.]|$)/i;

function text(value: unknown) {
  return String(value || "").trim();
}

function finite(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function imageScore(image: CatalogImageLike) {
  const url = text(image.url || image.objectKey);
  const mime = text(image.mimeType).toLowerCase();
  const width = finite(image.width);
  const height = finite(image.height);
  const size = finite(image.size);
  const pixels = width && height ? width * height : 0;
  const density = pixels && size ? size / pixels : 0;
  const ratio = width && height ? width / height : 0;
  let score = 0;

  if (promoUrlPattern.test(url)) score -= 12;
  if (/image\/(?:svg|gif)/.test(mime) || /\.(?:svg|gif)(?:\?|$)/i.test(url)) score -= 12;
  if (/image\/png/.test(mime) || /\.png(?:\?|$)/i.test(url)) score -= 3;
  if (/image\/(?:jpe?g|webp|avif)/.test(mime) || /\.(?:jpe?g|webp|avif)(?:\?|$)/i.test(url)) score += 2;

  if (width && height) {
    if (width >= 640 && height >= 400) score += 2;
    if (width < 420 || height < 260) score -= 5;
    if (ratio >= 1.15 && ratio <= 1.85) score += 1;
    else if (ratio < 0.8 || ratio > 2.15) score -= 4;
  }

  // Flat banners usually compress much harder than photographs at the same dimensions.
  if (density) {
    if (density < 0.035) score -= 6;
    else if (density < 0.06) score -= 2;
    else if (density > 0.11) score += 2;
  }
  if (size && size < 28_000) score -= 5;
  else if (size >= 90_000) score += 1;

  return score;
}

export function rankedCatalogImageUrls(offer: any) {
  const images: CatalogImageLike[] = Array.isArray(offer?.images) ? offer.images : [];
  const candidates = images
    .map((image, index) => ({ image, index, url: text(image?.url), score: imageScore(image) }))
    .filter((candidate) => candidate.url);

  if (String(offer?.market || "").toLowerCase() !== "japan") return candidates.map((candidate) => candidate.url);

  const ranked = [...candidates].sort((left, right) => right.score - left.score || left.index - right.index);
  const usable = ranked.filter((candidate) => candidate.score > -6);
  return (usable.length >= 2 ? usable : ranked).map((candidate) => candidate.url);
}
