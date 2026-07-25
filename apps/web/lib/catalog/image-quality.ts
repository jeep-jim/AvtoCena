type CatalogImageLike = {
  url?: unknown;
  objectKey?: unknown;
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
  // PNG frequently contains source placeholders and interface icons. A real large landscape PNG
  // can still pass through the photo geometry and byte-density bonuses below.
  if (/image\/png/.test(mime) || /\.png(?:\?|$)/i.test(url)) score -= 7;
  if (/image\/(?:jpe?g|webp|avif)/.test(mime) || /\.(?:jpe?g|webp|avif)(?:\?|$)/i.test(url)) score += 3;

  if (width && height) {
    if (width >= 640 && height >= 400) score += 3;
    if (width < 420 || height < 260) score -= 10;
    // Catalog photos must be landscape. Square service pictograms are not vehicle photos.
    if (ratio >= 1.08 && ratio <= 2.2) score += 3;
    else score -= 12;
  }

  // Flat pictograms and banners compress much harder than real photographs.
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
  return images
    .map((image, index) => ({ image, index, url: text(image?.url), score: catalogImageScore(image) }))
    .filter((candidate) => candidate.url && candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.url);
}
