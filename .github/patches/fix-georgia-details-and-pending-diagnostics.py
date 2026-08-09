from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, got {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


source = "apps/web/lib/catalog/auto-georgia-strict-source.ts"
replace_once(
    source,
    '''    offer.operational.gallerySourceImageCount = urls.length;
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;''',
    '''    offer.operational.gallerySourceImageCount = urls.length;
    if (process.env.CATALOG_IMAGE_STORAGE_MODE === "source_urls_only") {
      return urls.slice(0, limit).map((url) => {
        const extension = url.match(/\\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
        return {
          id: "",
          url,
          objectKey: "",
          checksum: "",
          size: 0,
          mimeType: extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : extension === "avif" ? "image/avif" : "image/jpeg",
        } as CatalogImage;
      });
    }
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit * 4)) {
      const image = await cacheImageFromUrl(url, this.market, { headers: { ...HEADERS, referer: detailUrl || "https://www.auto.ge/en/auto/index.html" } }).catch(() => null);
      if (image && image.size > 8_000) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;''',
)

script = "scripts/catalog-live-recovery-market.mjs"
replace_once(
    script,
    '''  const rejections = {};
  const errors = [];
  const cursors = new Set();''',
    '''  const rejections = {};
  const errors = [];
  const pendingElectrified = new Map();
  const cursors = new Set();''',
)
replace_once(
    script,
    '''      if (trustedListingImages.length) {
        offer.images = credibleCatalogImages(trustedListingImages).slice(0, 30);
        offer.operational = {
          ...(offer.operational || {}),
          galleryVerified: offer.images.length > 0,
          galleryImageCount: offer.images.length,
          gallerySafetyMode: "auto_georgia_listing_bound_source_urls",
          galleryStoredAs: "json_urls",
        };
      } else {''',
    '''      if (trustedListingImages.length) {
        // AUTO.GE listing images are already bound to the exact listing, but the
        // detail page is still authoritative for missing engine/power fields.
        // In source_urls_only mode the adapter now fetches only the detail HTML
        // and returns URL metadata without downloading/caching every image.
        try {
          if (typeof source.fetchImages === "function") await retry(`${source.sourceId}_details`, () => source.fetchImages(offer));
        } catch (error) {
          errors.push({ stage: "details", sourceOfferId: offer.sourceOfferId, error: errorText(error).slice(0, 500) });
        }
        offer.images = credibleCatalogImages(trustedListingImages).slice(0, 30);
        offer.operational = {
          ...(offer.operational || {}),
          galleryVerified: offer.images.length > 0,
          galleryImageCount: offer.images.length,
          gallerySafetyMode: "auto_georgia_listing_bound_source_urls",
          galleryStoredAs: "json_urls",
        };
      } else {''',
)
replace_once(
    script,
    '''      if (!exactCalculation(calculated)) { reject(rejections, "calculation_pending"); return null; }
      calculated.status = "active";''',
    '''      if (!exactCalculation(calculated)) {
        const kind = String(calculated?.powertrainKind || "");
        const fuel = String(calculated?.fuel || "").toLowerCase();
        if (["electric", "series_hybrid", "other_hybrid"].includes(kind) || fuel === "electric" || fuel === "hybrid") {
          const key = `${String(calculated?.make || "").trim()}|${String(calculated?.model || "").trim()}|${Number(calculated?.year || 0)}|${kind || fuel || "unknown"}`;
          const current = pendingElectrified.get(key) || {
            make: calculated?.make || "",
            model: calculated?.model || "",
            year: Number(calculated?.year || 0),
            powertrainKind: kind || "unknown",
            fuel: calculated?.fuel || "",
            count: 0,
            missing: new Set(),
          };
          current.count += 1;
          if (!(Number(calculated?.utilizationPowerKw || 0) > 0)) current.missing.add("utilizationPowerKw");
          const motor30 = Number(calculated?.power30MinKw || 0) || (Array.isArray(calculated?.power30MinKwByMotor) ? calculated.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
          if (!(motor30 > 0)) current.missing.add("power30MinKw");
          if (kind === "other_hybrid" && !(Number(calculated?.icePowerKw || 0) > 0)) current.missing.add("icePowerKw");
          pendingElectrified.set(key, current);
        }
        reject(rejections, "calculation_pending"); return null;
      }
      calculated.status = "active";''',
)
replace_once(
    script,
    '''  reports.push({ sourceId: source.sourceId, pages, seen, normalized, accepted: accepted.size, rejected: Object.values(rejections).reduce((a, b) => a + b, 0), rejections, errors: errors.slice(0, 100), finished, stopReason });''',
    '''  reports.push({
    sourceId: source.sourceId,
    pages,
    seen,
    normalized,
    accepted: accepted.size,
    rejected: Object.values(rejections).reduce((a, b) => a + b, 0),
    rejections,
    pendingElectrifiedModels: [...pendingElectrified.values()].map((row) => ({ ...row, missing: [...row.missing] })).sort((a, b) => b.count - a.count).slice(0, 100),
    errors: errors.slice(0, 100),
    finished,
    stopReason,
  });''',
)
replace_once(
    script,
    '''  imageStats: offers.length ? {
    min: Math.min(...offers.map((offer) => offer.images?.length || 0)),
    max: Math.max(...offers.map((offer) => offer.images?.length || 0)),
    average: Number((offers.reduce((sum, offer) => sum + Number(offer.images?.length || 0), 0) / offers.length).toFixed(2)),
  } : { min: 0, max: 0, average: 0 },
  sources: reports.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),''',
    '''  imageStats: offers.length ? {
    min: Math.min(...offers.map((offer) => offer.images?.length || 0)),
    max: Math.max(...offers.map((offer) => offer.images?.length || 0)),
    average: Number((offers.reduce((sum, offer) => sum + Number(offer.images?.length || 0), 0) / offers.length).toFixed(2)),
  } : { min: 0, max: 0, average: 0 },
  pendingElectrifiedModels: reports.flatMap((sourceReport) => sourceReport.pendingElectrifiedModels || []).sort((a, b) => b.count - a.count).slice(0, 200),
  sources: reports.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),''',
)
