const VARIANT_FIELDS = [
  "name", "market", "yearFrom", "yearTo", "bodyType", "powertrainKind", "fuel", "engineCc", "engineCode",
  "transmission", "gears", "drive", "steeringPosition", "powerHp", "powerHpStandard", "powerKw", "icePowerKw",
  "motorPeakKw", "batteryGrossKwh", "batteryRatedKwh", "batteryUsableKwh", "acChargeKw", "dcChargeKw",
  "rangeKm", "rangeKmMin", "rangeKmMax", "rangeStandard", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
  "groundClearanceMm", "curbWeightKg", "grossWeightKg", "doors", "seats", "tankCapacityL", "topSpeedKmh", "zeroTo100Sec",
];

function clean(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function safeAliases(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => row?.safe === true && clean(row.value))
    .map((row) => clean(row.value)))].sort((left, right) => left.localeCompare(right, "en"));
}

function evidence(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => compactObject({
    sourceId: clean(row?.sourceId),
    fields: Array.isArray(row?.fields) ? [...new Set(row.fields.map(clean).filter(Boolean))].sort() : [],
    status: clean(row?.status),
    confidence: clean(row?.confidence),
  })).filter((row) => row.sourceId);
}

function publicReady(row) {
  if (clean(row?.status) === "verified") return true;
  return clean(row?.status) === "seed" && evidence(row?.evidence).some((item) => item.status === "verified" && item.confidence === "official");
}

export function autocatalogLetter(name) {
  const first = clean(name).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[A-Za-z]/)?.[0];
  return first ? first.toUpperCase() : "#";
}

function sourceSummary(row) {
  return compactObject({
    id: clean(row?.id),
    type: clean(row?.type),
    title: clean(row?.title),
    publisher: clean(row?.publisher),
    url: clean(row?.url),
    documentId: clean(row?.documentId),
    documentDate: clean(row?.documentDate),
    verifiedAt: clean(row?.verifiedAt),
    market: clean(row?.market),
    language: clean(row?.language),
    supportedFields: Array.isArray(row?.supportedFields) ? [...new Set(row.supportedFields.map(clean).filter(Boolean))].sort() : [],
    confidence: clean(row?.confidence),
    license: clean(row?.license),
  });
}

function recordSourceIds(...records) {
  return [...new Set(records.flatMap((row) => evidence(row?.evidence).map((item) => item.sourceId)).filter(Boolean))];
}

function variantRecord(row) {
  const fields = Object.fromEntries(VARIANT_FIELDS.map((field) => [field, row?.[field]]));
  return compactObject({
    id: clean(row?.id),
    generationId: clean(row?.generationId),
    faceliftId: clean(row?.faceliftId),
    aliases: safeAliases(row?.aliases),
    ...fields,
    status: clean(row?.status) || "review",
    publicReady: publicReady(row),
    evidence: evidence(row?.evidence),
    updatedAt: clean(row?.updatedAt),
  });
}

function generationRecord(row) {
  return compactObject({
    id: clean(row?.id),
    name: clean(row?.name),
    aliases: safeAliases(row?.aliases),
    productionFrom: clean(row?.productionFrom),
    productionTo: clean(row?.productionTo),
    bodyTypes: Array.isArray(row?.bodyTypes) ? row.bodyTypes.map(clean).filter(Boolean) : [],
    platformCodes: Array.isArray(row?.platformCodes) ? row.platformCodes.map(clean).filter(Boolean) : [],
    status: clean(row?.status) || "review",
    publicReady: publicReady(row),
    evidence: evidence(row?.evidence),
    updatedAt: clean(row?.updatedAt),
  });
}

function faceliftRecord(row) {
  return compactObject({
    id: clean(row?.id),
    generationId: clean(row?.generationId),
    name: clean(row?.name),
    aliases: safeAliases(row?.aliases),
    productionFrom: clean(row?.productionFrom),
    productionTo: clean(row?.productionTo),
    status: clean(row?.status) || "review",
    publicReady: publicReady(row),
    evidence: evidence(row?.evidence),
    updatedAt: clean(row?.updatedAt),
  });
}

function modelRecord(row, generations, facelifts, variants, coverId) {
  return compactObject({
    id: clean(row?.id),
    name: clean(row?.canonicalName),
    slug: clean(row?.slug),
    aliases: [...new Set([...safeAliases(row?.aliases), ...safeAliases(row?.sourceNames)])].sort((left, right) => left.localeCompare(right, "en")),
    productionFrom: clean(row?.productionFrom),
    productionTo: clean(row?.productionTo),
    bodyTypes: Array.isArray(row?.bodyTypes) ? row.bodyTypes.map(clean).filter(Boolean) : [],
    powertrainKinds: Array.isArray(row?.powertrainKinds) ? row.powertrainKinds.map(clean).filter(Boolean) : [],
    status: clean(row?.status) || "review",
    publicReady: publicReady(row),
    coverId,
    evidence: evidence(row?.evidence),
    generations,
    facelifts,
    variants,
    updatedAt: clean(row?.updatedAt),
  });
}

function brandRecord(row, models) {
  return compactObject({
    id: clean(row?.id),
    name: clean(row?.canonicalName),
    slug: clean(row?.slug),
    aliases: safeAliases(row?.aliases),
    countries: Array.isArray(row?.countries) ? row.countries.map(clean).filter(Boolean) : [],
    status: clean(row?.status) || "review",
    publicReady: publicReady(row),
    evidence: evidence(row?.evidence),
    models,
    updatedAt: clean(row?.updatedAt),
  });
}

export function approvedAutocatalogCovers(media) {
  const result = [];
  const owners = new Set();
  for (const row of media || []) {
    if (row?.ownerType !== "model" || row?.role !== "canonical_cover" || row?.status !== "approved") continue;
    if (!/^exact_(?:model|generation)$/.test(clean(row?.identityStatus))) continue;
    if (!/^(?:CC0|CC BY(?:-SA)?|Public domain)\b/i.test(clean(row?.license))) continue;
    let source;
    let page;
    try { source = new URL(clean(row?.originalUrl)); page = new URL(clean(row?.pageUrl)); } catch { continue; }
    if (!/(?:^|\.)wikimedia\.org$/i.test(source.hostname) || !/(?:^|\.)wikimedia\.org$/i.test(page.hostname)) continue;
    const ownerId = clean(row?.ownerId);
    if (!ownerId || owners.has(ownerId)) continue;
    owners.add(ownerId);
    result.push({
      id: clean(row.id),
      modelId: ownerId,
      sourceId: clean(row.sourceId),
      originalUrl: source.toString(),
      pageUrl: page.toString(),
      license: clean(row.license),
      attribution: clean(row.attribution),
      identityStatus: clean(row.identityStatus),
      verifiedAt: clean(row.verifiedAt),
    });
  }
  return result.sort((left, right) => left.modelId.localeCompare(right.modelId, "en"));
}

export function compileAutocatalogLetters({ brands, models, generations, facelifts, variants, sources, media }) {
  const coverRows = approvedAutocatalogCovers(media);
  const coverIdByModel = new Map(coverRows.map((row) => [row.modelId, row.id]));
  const sourceById = new Map((sources || []).map((row) => [clean(row?.id), sourceSummary(row)]));
  const modelsByBrand = new Map();
  const generationsByModel = new Map();
  const faceliftsByModel = new Map();
  const variantsByModel = new Map();
  const generationModelIds = new Map((generations || []).map((row) => [clean(row?.id), clean(row?.modelId)]));
  for (const row of models || []) modelsByBrand.set(clean(row?.brandId), [...(modelsByBrand.get(clean(row?.brandId)) || []), row]);
  for (const row of generations || []) generationsByModel.set(clean(row?.modelId), [...(generationsByModel.get(clean(row?.modelId)) || []), row]);
  for (const row of facelifts || []) {
    const modelId = generationModelIds.get(clean(row?.generationId));
    if (modelId) faceliftsByModel.set(modelId, [...(faceliftsByModel.get(modelId) || []), row]);
  }
  for (const row of variants || []) variantsByModel.set(clean(row?.modelId), [...(variantsByModel.get(clean(row?.modelId)) || []), row]);

  const grouped = new Map();
  let modelCount = 0;
  let variantCount = 0;
  let publicVariantCount = 0;
  for (const rawBrand of brands || []) {
    const rawModels = (modelsByBrand.get(clean(rawBrand?.id)) || []).sort((left, right) => clean(left.canonicalName).localeCompare(clean(right.canonicalName), "en"));
    const sourceIds = new Set(recordSourceIds(rawBrand));
    const modelRows = rawModels.map((rawModel) => {
      const rawGenerations = generationsByModel.get(clean(rawModel?.id)) || [];
      const rawFacelifts = faceliftsByModel.get(clean(rawModel?.id)) || [];
      const rawVariants = variantsByModel.get(clean(rawModel?.id)) || [];
      for (const id of recordSourceIds(rawModel, ...rawGenerations, ...rawFacelifts, ...rawVariants)) sourceIds.add(id);
      modelCount += 1;
      variantCount += rawVariants.length;
      publicVariantCount += rawVariants.filter(publicReady).length;
      return modelRecord(
        rawModel,
        rawGenerations.map(generationRecord).sort((left, right) => left.id.localeCompare(right.id, "en")),
        rawFacelifts.map(faceliftRecord).sort((left, right) => left.id.localeCompare(right.id, "en")),
        rawVariants.map(variantRecord).sort((left, right) => left.id.localeCompare(right.id, "en")),
        coverIdByModel.get(clean(rawModel?.id)),
      );
    });
    const brand = brandRecord(rawBrand, modelRows);
    const letter = autocatalogLetter(brand.name);
    const row = grouped.get(letter) || { brands: [], sourceIds: new Set() };
    row.brands.push(brand);
    for (const id of sourceIds) row.sourceIds.add(id);
    grouped.set(letter, row);
  }

  const letters = [...grouped.entries()].sort(([left], [right]) => left === "#" ? -1 : right === "#" ? 1 : left.localeCompare(right, "en")).map(([letter, row]) => ({
    letter,
    brands: row.brands.sort((left, right) => left.name.localeCompare(right.name, "en")),
    sources: [...row.sourceIds].map((id) => sourceById.get(id)).filter(Boolean).sort((left, right) => left.id.localeCompare(right.id, "en")),
  }));
  return {
    letters,
    covers: coverRows,
    counts: {
      letters: letters.length,
      brands: (brands || []).length,
      models: modelCount,
      variants: variantCount,
      publicVariants: publicVariantCount,
      approvedCovers: coverRows.length,
    },
  };
}
