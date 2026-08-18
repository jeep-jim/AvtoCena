import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-model-official-active-05.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-model-official-active-05-2026-08-17.json");
const VERIFIED_AT = "2026-08-17";

const SOURCES = [
  {
    id: "src-lepas-global-range-2026",
    title: "LEPAS official global brand and current model range",
    publisher: "LEPAS",
    url: "https://www.lepasinternational.com/",
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    notes: "Official global site used only for the LEPAS identity and the currently published L8, L6 and L4 lines. Placeholder or promotional technical values are not retained.",
  },
  {
    id: "src-chery-lepas-launch-2025",
    title: "A new global brand redefining future mobility with elegant designing",
    publisher: "Chery Corporate Malaysia",
    url: "https://www.chery.my/2025/04/28/a-new-global-brand-redefining-future-mobility-with-elegant-designing/",
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "countries", "productionFrom", "bodyTypes"],
    notes: "Official Chery regional release corroborating LEPAS as a distinct global brand and the L8, L6 and L4 product sequence. Only explicit identity and launch timing are retained.",
  },
  {
    id: "src-audi-china-e5-sportback-2025",
    title: "New AUDI brand presents first model, the AUDI E5 Sportback",
    publisher: "AUDI AG",
    url: "https://www.audi.com/de/pressemitteilungen/neue-marke-audi-stellt-erstes-modell-vor-den-audi-e5-sportback-16607",
    market: "China",
    language: "de",
    supportedFields: ["canonicalName", "countries", "name", "productionFrom", "bodyTypes", "powertrainKinds", "platformCodes"],
    notes: "Official AUDI release establishing the China-specific sister brand, its first E5 Sportback model and the ADP platform. Ambiguous all-cap AUDI input is not made a safe global alias for Audi or AUDI China.",
  },
  {
    id: "src-jac-yiwei-brand-launch-2023",
    title: "JAC Yiwei new energy passenger-car brand launch",
    publisher: "JAC Yiwei",
    url: "https://yiwei.jac.com.cn/news/20230413/5601.html",
    market: "China",
    language: "zh",
    supportedFields: ["canonicalName", "countries", "productionFrom", "powertrainKinds"],
    notes: "Official Chinese JAC Yiwei launch release used for the distinct brand identity and Yiwei 3 product identity. The Latin canonical label remains review-only.",
  },
  {
    id: "src-jac-yiwei-3-spec-2026",
    title: "2026 JAC Yiwei 3 official specifications",
    publisher: "JAC Yiwei",
    url: "https://yiwei.jac.com.cn/yw3/",
    market: "China",
    language: "zh",
    supportedFields: ["canonicalName", "name", "market", "productionFrom", "bodyTypes", "powertrainKinds", "yearFrom", "bodyType", "powertrainKind", "motorPeakKw", "batteryRatedKwh", "rangeKm", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats", "doors", "topSpeedKmh"],
    notes: "Official current Yiwei 3 specification page. The 505 km figure is retained without inventing a test standard; peak motor power is not converted into 30-minute power.",
  },
  {
    id: "src-jac-yiwei-e30x-uae-2024",
    title: "JAC Yiwei 3 enters the UAE as E30X",
    publisher: "JAC Yiwei",
    url: "https://yiwei.jac.com.cn/news/20240710/5638.html",
    market: "United Arab Emirates",
    language: "zh",
    supportedFields: ["canonicalName", "aliases"],
    notes: "Official manufacturer release establishing E30X as the UAE market name of Yiwei 3.",
  },
  {
    id: "src-icaur-global-range-2026",
    title: "iCAUR official global model range",
    publisher: "iCAUR",
    url: "https://www.icaurglobal.com/global/",
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "countries", "bodyTypes", "powertrainKinds"],
    notes: "Official global site used for the iCAUR brand and current V23/V27 model identities. iCAUR is kept separate from iCAR until an official identity mapping is staged.",
  },
  {
    id: "src-icaur-v23-spec-2026",
    title: "iCAUR V23 official global specifications",
    publisher: "iCAUR",
    url: "https://www.icaurglobal.com/global/iCAURV23/",
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "name", "market", "productionFrom", "bodyTypes", "powertrainKinds", "yearFrom", "bodyType", "powertrainKind", "motorPeakKw", "batteryRatedKwh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm"],
    notes: "Official global V23 table. The two published battery/motor columns are retained without guessing grade names, drive layout, range or 30-minute power.",
  },
  {
    id: "src-icaur-v27-spec-2026",
    title: "iCAUR V27 official global specifications",
    publisher: "iCAUR",
    url: "https://www.icaurglobal.com/global/iCAURV27/",
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    notes: "Official global V27 page used only for model identity, SUV category and REEV powertrain. The mixed promotional configuration table is not promoted into exact variants.",
  },
];

const BRANDS = [
  {
    id: "lepas",
    canonicalName: "LEPAS",
    countries: ["China"],
    status: "seed",
    sourceIds: ["src-lepas-global-range-2026", "src-chery-lepas-launch-2025"],
    aliases: [{ value: "Lepas", kind: "source_spelling", safe: true, language: "en", market: "Global", sourceIds: ["src-lepas-global-range-2026"] }],
    note: "Official LEPAS and Chery sources establish a distinct current global vehicle brand and its Chinese manufacturer origin.",
  },
  {
    id: "audi-china",
    canonicalName: "AUDI China",
    countries: ["China"],
    status: "review",
    sourceIds: ["src-audi-china-e5-sportback-2025"],
    aliases: [{ value: "AUDI", kind: "market_name", safe: false, language: "en", market: "China", sourceIds: ["src-audi-china-e5-sportback-2025"] }],
    note: "AUDI AG explicitly establishes the all-cap AUDI sister brand for China; the qualified canonical label prevents collision with four-ring Audi.",
  },
  {
    id: "jac-yiwei",
    canonicalName: "JAC Yiwei",
    countries: ["China"],
    status: "review",
    sourceIds: ["src-jac-yiwei-brand-launch-2023"],
    aliases: [
      { value: "Yiwei", kind: "transliteration", safe: false, language: "en", market: "China", sourceIds: ["src-jac-yiwei-brand-launch-2023"] },
      { value: "江淮钇为", kind: "localized", safe: false, language: "zh", market: "China", sourceIds: ["src-jac-yiwei-brand-launch-2023"] },
    ],
    note: "The official Chinese JAC site establishes the identity; Latin normalization stays review-only so it cannot silently rename production listings.",
  },
  {
    id: "icaur",
    canonicalName: "iCAUR",
    countries: ["China"],
    status: "seed",
    sourceIds: ["src-icaur-global-range-2026"],
    aliases: [{ value: "ICAUR", kind: "source_spelling", safe: true, language: "en", market: "Global", sourceIds: ["src-icaur-global-range-2026"] }],
    note: "The official global site establishes iCAUR as the public brand identity. No iCAR equivalence is inferred.",
  },
];

const MODELS = [
  { id: "lepas/l8", brandId: "lepas", canonicalName: "L8", productionFrom: "2025", bodyTypes: ["SUV"], powertrainKinds: ["PHEV"], sourceIds: ["src-lepas-global-range-2026", "src-chery-lepas-launch-2025"] },
  { id: "lepas/l6", brandId: "lepas", canonicalName: "L6", productionFrom: null, bodyTypes: ["SUV"], powertrainKinds: ["PHEV", "BEV"], sourceIds: ["src-lepas-global-range-2026", "src-chery-lepas-launch-2025"] },
  { id: "lepas/l4", brandId: "lepas", canonicalName: "L4", productionFrom: null, bodyTypes: ["SUV"], powertrainKinds: ["ICE", "BEV"], sourceIds: ["src-lepas-global-range-2026", "src-chery-lepas-launch-2025"] },
  { id: "audi-china/e5-sportback", brandId: "audi-china", canonicalName: "E5 Sportback", productionFrom: "2025", bodyTypes: ["Sportback"], powertrainKinds: ["BEV"], sourceIds: ["src-audi-china-e5-sportback-2025"] },
  {
    id: "jac-yiwei/3",
    brandId: "jac-yiwei",
    canonicalName: "3",
    productionFrom: "2023",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    sourceIds: ["src-jac-yiwei-brand-launch-2023", "src-jac-yiwei-3-spec-2026", "src-jac-yiwei-e30x-uae-2024"],
    sourceNames: [
      { value: "钇为3", kind: "localized", safe: true, language: "zh", market: "China", sourceIds: ["src-jac-yiwei-brand-launch-2023", "src-jac-yiwei-3-spec-2026"] },
      { value: "E30X", kind: "market_name", safe: true, language: "en", market: "United Arab Emirates", sourceIds: ["src-jac-yiwei-e30x-uae-2024"] },
    ],
  },
  { id: "icaur/v23", brandId: "icaur", canonicalName: "V23", productionFrom: null, bodyTypes: ["SUV"], powertrainKinds: ["BEV"], sourceIds: ["src-icaur-global-range-2026", "src-icaur-v23-spec-2026"] },
  { id: "icaur/v27", brandId: "icaur", canonicalName: "V27", productionFrom: null, bodyTypes: ["SUV"], powertrainKinds: ["EREV"], sourceIds: ["src-icaur-global-range-2026", "src-icaur-v27-spec-2026"] },
];

const GENERATIONS = [
  {
    id: "audi-china/e5-sportback/adp",
    modelId: "audi-china/e5-sportback",
    name: "ADP",
    platformCodes: ["ADP"],
    productionFrom: "2025",
    bodyTypes: ["Sportback"],
    sourceId: "src-audi-china-e5-sportback-2025",
    fields: ["name", "platformCodes", "productionFrom", "bodyTypes"],
  },
  {
    id: "jac-yiwei/3/current-china-2026",
    modelId: "jac-yiwei/3",
    name: "Current China specification",
    platformCodes: [],
    productionFrom: "2026",
    bodyTypes: ["Hatchback"],
    sourceId: "src-jac-yiwei-3-spec-2026",
    fields: ["name", "productionFrom", "bodyTypes"],
  },
  {
    id: "icaur/v23/current-global-2026",
    modelId: "icaur/v23",
    name: "Current global specification",
    platformCodes: [],
    productionFrom: "2026",
    bodyTypes: ["SUV"],
    sourceId: "src-icaur-v23-spec-2026",
    fields: ["name", "productionFrom", "bodyTypes"],
  },
];

const VARIANTS = [
  {
    id: "jac-yiwei/3/current-china-2026/505-km",
    modelId: "jac-yiwei/3",
    generationId: "jac-yiwei/3/current-china-2026",
    name: "2026 505 km",
    market: "China",
    yearFrom: 2026,
    bodyType: "Hatchback",
    powertrainKind: "BEV",
    motorPeakKw: 100,
    batteryRatedKwh: 51.5,
    rangeKm: 505,
    lengthMm: 4025,
    widthMm: 1770,
    heightMm: 1560,
    wheelbaseMm: 2620,
    seats: 5,
    doors: 5,
    topSpeedKmh: 150,
    sourceId: "src-jac-yiwei-3-spec-2026",
  },
  {
    id: "icaur/v23/current-global-2026/59-93-kwh",
    modelId: "icaur/v23",
    generationId: "icaur/v23/current-global-2026",
    name: "Current Global Specification — 59.93 kWh",
    market: "Global",
    yearFrom: 2026,
    bodyType: "SUV",
    powertrainKind: "BEV",
    motorPeakKw: 100,
    batteryRatedKwh: 59.93,
    lengthMm: 4220,
    widthMm: 1915,
    heightMm: 1845,
    wheelbaseMm: 2735,
    sourceId: "src-icaur-v23-spec-2026",
  },
  {
    id: "icaur/v23/current-global-2026/81-76-kwh",
    modelId: "icaur/v23",
    generationId: "icaur/v23/current-global-2026",
    name: "Current Global Specification — 81.76 kWh",
    market: "Global",
    yearFrom: 2026,
    bodyType: "SUV",
    powertrainKind: "BEV",
    motorPeakKw: 155,
    batteryRatedKwh: 81.76,
    lengthMm: 4220,
    widthMm: 1915,
    heightMm: 1845,
    wheelbaseMm: 2735,
    sourceId: "src-icaur-v23-spec-2026",
  },
];

function chunks(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function evidence(sourceIds, fields, note) {
  const byId = new Map(SOURCES.map((source) => [source.id, source]));
  return sourceIds.map((sourceId) => ({
    sourceId,
    fields: fields.filter((field) => byId.get(sourceId)?.supportedFields.includes(field)),
    status: "verified",
    confidence: "official",
    note,
  })).filter((item) => item.fields.length);
}

export async function buildOfficialActiveBrandModelBatch05({ verifiedAt = VERIFIED_AT } = {}) {
  const workspace = await loadWorkspace();
  const existing = Object.fromEntries(["source", "brand", "model", "generation", "variant"]
    .map((type) => [type, new Set(workspace.records[type].map((record) => record.id))]));

  const sources = SOURCES.filter((source) => !existing.source.has(source.id)).map((source) => ({
    ...source,
    type: "manufacturer",
    documentId: null,
    documentDate: null,
    verifiedAt,
    confidence: "official",
    status: "active",
    license: null,
  }));
  const brands = BRANDS.filter((brand) => !existing.brand.has(brand.id)).map((brand) => ({
    id: brand.id,
    canonicalName: brand.canonicalName,
    slug: brand.id,
    aliases: brand.aliases,
    countries: brand.countries,
    status: brand.status,
    evidence: evidence(brand.sourceIds, ["canonicalName", "countries"], brand.note),
    researchNotes: [
      "No source-traced 90x60 dark/light logo pair is staged; logo identity and publication rights remain blocking gates.",
      "The identity is isolated from production naming, pricing and public encyclopedia routes until review and media approval are complete.",
    ],
    updatedAt: verifiedAt,
  }));
  const models = MODELS.filter((model) => !existing.model.has(model.id)).map((model) => ({
    id: model.id,
    brandId: model.brandId,
    canonicalName: model.canonicalName,
    slug: model.id.split("/").at(-1),
    aliases: [],
    sourceNames: model.sourceNames || [],
    productionFrom: model.productionFrom,
    productionTo: null,
    bodyTypes: model.bodyTypes,
    powertrainKinds: model.powertrainKinds,
    mediaIds: [],
    status: "review",
    evidence: evidence(model.sourceIds, ["canonicalName", ...(model.productionFrom ? ["productionFrom"] : []), "bodyTypes", "powertrainKinds"], "Official current brand/model material explicitly supports the retained identity and category; no unlisted generation, trim or technical value is inferred."),
    researchNotes: [
      "Active 2020-2026 identity checkpoint; review-only until logo, generation and configuration gates are complete.",
      ...(model.id === "icaur/v23" || model.id === "icaur/v27" ? ["Kept under iCAUR; no automatic merge with the separate iCAR staging identity is allowed without official equivalence evidence."] : []),
    ],
    updatedAt: verifiedAt,
  }));
  const generations = GENERATIONS.filter((generation) => !existing.generation.has(generation.id)).map((generation) => ({
    id: generation.id,
    modelId: generation.modelId,
    name: generation.name,
    aliases: [],
    platformCodes: generation.platformCodes,
    productionFrom: generation.productionFrom,
    productionTo: null,
    bodyTypes: generation.bodyTypes,
    status: "review",
    evidence: evidence([generation.sourceId], generation.fields, generation.platformCodes.length
      ? "The official manufacturer release explicitly names the platform and launch period."
      : "A review-only container for the exact current official specification table; it is not asserted to be a manufacturer-defined generation name."),
    researchNotes: ["Review-only; production generation boundaries beyond the cited current specification are not inferred."],
    updatedAt: verifiedAt,
  }));
  const variants = VARIANTS.filter((variant) => !existing.variant.has(variant.id)).map((variant) => {
    const { sourceId, ...fields } = variant;
    const evidenceFields = Object.keys(fields).filter((field) => !["id", "modelId", "generationId"].includes(field));
    return {
      ...fields,
      id: variant.id,
      modelId: variant.modelId,
      generationId: variant.generationId,
      faceliftId: null,
      aliases: [],
      yearTo: null,
      status: "review",
      evidence: evidence([sourceId], evidenceFields, "Exact values copied from the official manufacturer table. Missing drive, grade, charging, range-standard and 30-minute-power fields are intentionally not guessed or derived."),
      researchNotes: [
        "Review-only exact official specification; it cannot feed production pricing until identity and generation matching are approved.",
        "Peak motor power is kept as motorPeakKw and is never copied or converted into power30MinKw.",
      ],
      updatedAt: verifiedAt,
    };
  });

  for (const records of [sources, brands, models, generations, variants]) records.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: {
      newSources: sources.length,
      newBrands: brands.length,
      newModels: models.length,
      newGenerations: generations.length,
      newVariants: variants.length,
    },
    brandIds: brands.map((brand) => brand.id),
    modelIds: models.map((model) => model.id),
    generationIds: generations.map((generation) => generation.id),
    variantIds: variants.map((variant) => variant.id),
    policy: {
      priorityWindow: "Active China/global passenger vehicles, 2020-2026",
      officialManufacturerSourcesOnly: true,
      ambiguousBrandAliasesRemainUnsafe: true,
      icarAndIcaurNotMergedWithoutOfficialEvidence: true,
      promotionalMaximumsNotPromotedToVariants: true,
      missingTechnicalValuesNotDerived: true,
      sourceTracedLogoPairRequired: true,
      automaticPublicationReady: false,
    },
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunks("source", sources),
        ...chunks("brand", brands),
        ...chunks("model", models),
        ...chunks("generation", generations),
        ...chunks("variant", variants),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildOfficialActiveBrandModelBatch05();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
