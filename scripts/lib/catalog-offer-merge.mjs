export function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

export function uniqueImages(images) {
  const seen = new Set();
  const result = [];
  for (const image of Array.isArray(images) ? images : []) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= 30) break;
  }
  return result;
}

/** The existing fresh-only publication path. Retained-row independence is
 * compared against this same function, never a caller-supplied callback. */
export function mergeFreshCatalogOffer(primary) {
  return {...primary, images: uniqueImages(primary?.images)};
}

function overlayDefined(base, overlay) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === undefined || value === null || value === "") continue;
    result[key] = value;
  }
  return result;
}

export function mergeOfferVersions(primary, retained) {
  if (!retained) return mergeFreshCatalogOffer(primary);
  const merged = overlayDefined(retained, primary);
  const primaryRaw = typeof primary?.operational?.raw === "object" && primary.operational.raw ? primary.operational.raw : {};
  const retainedRaw = typeof retained?.operational?.raw === "object" && retained.operational.raw ? retained.operational.raw : {};
  const firstSeen = [primary?.firstSeenAt, retained?.firstSeenAt]
    .filter(Boolean)
    .sort((left, right) => Date.parse(String(left)) - Date.parse(String(right)))[0];
  const updatedAt = [primary?.updatedAt, retained?.updatedAt]
    .filter(Boolean)
    .sort((left, right) => Date.parse(String(right)) - Date.parse(String(left)))[0];
  return {
    ...merged,
    firstSeenAt: firstSeen || primary?.firstSeenAt || retained?.firstSeenAt,
    updatedAt: updatedAt || primary?.updatedAt || retained?.updatedAt,
    images: uniqueImages([...(primary?.images || []), ...(retained?.images || [])]),
    calculationSnapshot: overlayDefined(retained?.calculationSnapshot, primary?.calculationSnapshot),
    operational: {
      ...overlayDefined(retained?.operational, primary?.operational),
      raw: overlayDefined(retainedRaw, primaryRaw),
    },
  };
}
