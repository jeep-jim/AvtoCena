import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-mass-models-batch-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-mass-models-batch-02-2026-08-18.json");

const SOURCE_IDS = {
  yangguangEnglish: "src-wuling-red-current-en-2026",
  yangguangSpec: "src-sgmw-yangguang-current-spec",
  yangguangFamily: "src-sgmw-yangguang-family-launch-2025",
  bingoSSpec: "src-sgmw-bingo-s-current-spec",
  bingoSLaunch: "src-sgmw-bingo-s-launch-2025",
  bingoS525: "src-sgmw-bingo-s-525-launch-2026",
  bingoProPresale: "src-sgmw-bingo-pro-presale-2026",
  bingoProLaunch: "src-sgmw-bingo-pro-launch-2026",
};

const MODEL_DEFINITIONS = [
  {
    id: "wuling/yangguang",
    canonicalName: "Yangguang",
    productionFrom: "2024-03",
    bodyTypes: ["Van"],
    powertrainKinds: ["BEV"],
    identitySourceId: SOURCE_IDS.yangguangEnglish,
    identityFields: ["canonicalName"],
    identityNote: "Wuling's official English model inventory uses the public Latin name Yangguang; SGMW dates the original launch to March 2024.",
    factSourceId: SOURCE_IDS.yangguangFamily,
    factFields: ["productionFrom", "bodyTypes", "powertrainKinds"],
    sourceName: "五菱扬光",
    sourceNameSourceId: SOURCE_IDS.yangguangSpec,
  },
  {
    id: "wuling/bingo-s",
    canonicalName: "Bingo S",
    productionFrom: "2025-09",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    identitySourceId: SOURCE_IDS.bingoSLaunch,
    identityFields: ["productionFrom", "bodyTypes", "powertrainKinds"],
    identityNote: "SGMW's official launch dates the five-seat battery-electric Bingo S range to September 2025.",
    sourceName: "五菱缤果S",
    sourceNameSourceId: SOURCE_IDS.bingoSSpec,
  },
  {
    id: "wuling/bingo-pro",
    canonicalName: "Bingo Pro",
    productionFrom: "2026-05",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    identitySourceId: SOURCE_IDS.bingoProLaunch,
    identityFields: ["productionFrom", "bodyTypes", "powertrainKinds"],
    identityNote: "SGMW's official release records the Bingo Pro market launch on 2026-05-22 and identifies its 330 km and 403 km battery-electric range choices.",
    sourceName: "五菱缤果Pro",
    sourceNameSourceId: SOURCE_IDS.bingoProPresale,
  },
];

const YANGGUANG_VARIANTS = [
  { slug: "300km-cargo-practical", sourceName: "300km 封窗版实用型", name: "300 km Cargo Practical", rangeKm: 300, seats: 2, topSpeedKmh: 90, motorPeakKw: 75, lengthMm: 4985, heightMm: 1975, grossWeightKg: 2905 },
  { slug: "300km-cargo-comfort", sourceName: "300km封窗版舒适型", name: "300 km Cargo Comfort", rangeKm: 300, seats: 2, topSpeedKmh: 90, motorPeakKw: 75, lengthMm: 4985, heightMm: 1975, grossWeightKg: 2905 },
  { slug: "330km-passenger-comfort-6-seat", sourceName: "330km 客车版舒适型", name: "330 km Passenger Comfort 6-seat", rangeKm: 330, seats: 6, topSpeedKmh: 100, motorPeakKw: 100, lengthMm: 5010, heightMm: 1975, grossWeightKg: 2305 },
  { slug: "310km-cargo-catl-custom", sourceName: "310km 封窗版宁德时代定制版", name: "310 km Cargo CATL Custom", rangeKm: 310, seats: 2, topSpeedKmh: 90, motorPeakKw: 75, lengthMm: 5010, heightMm: 1975, grossWeightKg: 2905 },
  { slug: "340km-passenger-catl-custom-6-seat", sourceName: "340km 客车版宁德时代定制版", name: "340 km Passenger CATL Custom 6-seat", rangeKm: 340, seats: 6, topSpeedKmh: 100, motorPeakKw: 100, lengthMm: 5010, heightMm: 1975, grossWeightKg: 2305 },
  { slug: "440km-passenger-comfort-6-seat", sourceName: "440km 客车版舒适型", name: "440 km Passenger Comfort 6-seat", rangeKm: 440, seats: 6, topSpeedKmh: 100, motorPeakKw: 100, lengthMm: 5010, heightMm: 1960, grossWeightKg: 2420, aliasSafe: false },
  { slug: "440km-passenger-comfort-9-seat", sourceName: "440km 客车版舒适型", name: "440 km Passenger Comfort 9-seat", rangeKm: 440, seats: 9, topSpeedKmh: 100, motorPeakKw: 100, lengthMm: 5010, heightMm: 1960, grossWeightKg: 2550, aliasSafe: false },
  { slug: "440km-operating-9-seat", sourceName: "440km 营运版", name: "440 km Operating 9-seat", rangeKm: 440, seats: 9, topSpeedKmh: 100, motorPeakKw: 100, lengthMm: 5010, heightMm: 1960, grossWeightKg: 2550 },
];

const BINGO_S_VARIANTS = [
  { slug: "325km-exclusive", sourceName: "325km 尊享款", name: "325 km Exclusive", rangeKm: 325, curbWeightKg: 1250, acChargeKw: 3.3, yearFrom: 2025, launchSourceId: SOURCE_IDS.bingoSLaunch },
  { slug: "325km-flagship", sourceName: "325km 旗舰款", name: "325 km Flagship", rangeKm: 325, curbWeightKg: 1250, acChargeKw: 3.3, yearFrom: 2025, launchSourceId: SOURCE_IDS.bingoSLaunch },
  { slug: "430km-exclusive", sourceName: "430km 尊享款", name: "430 km Exclusive", rangeKm: 430, curbWeightKg: 1325, acChargeKw: 6.6, yearFrom: 2025, launchSourceId: SOURCE_IDS.bingoSLaunch },
  { slug: "430km-flagship", sourceName: "430km 旗舰款", name: "430 km Flagship", rangeKm: 430, curbWeightKg: 1325, acChargeKw: 6.6, yearFrom: 2025, launchSourceId: SOURCE_IDS.bingoSLaunch },
  { slug: "525km-flagship", sourceName: "525km 旗舰款", name: "525 km Flagship", rangeKm: 525, curbWeightKg: 1395, acChargeKw: 6.6, yearFrom: 2026, launchSourceId: SOURCE_IDS.bingoS525 },
];

const BINGO_PRO_VARIANTS = [
  { slug: "330km-exclusive", sourceName: "330km尊享款", name: "330 km Exclusive", rangeKm: 330 },
  { slug: "330km-flagship", sourceName: "330 km旗舰款", name: "330 km Flagship", rangeKm: 330 },
  { slug: "403km-exclusive", sourceName: "403 km尊享款", name: "403 km Exclusive", rangeKm: 403 },
  { slug: "403km-flagship", sourceName: "403 km旗舰款", name: "403 km Flagship", rangeKm: 403 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value, sourceId, safe = true) {
  return { value, kind: "localized", safe, language: "zh-CN", market: "China", sourceIds: [sourceId] };
}

function addSourceName(records, value, sourceId) {
  if (records.some((record) => record.value === value)) return records;
  return [...records, alias(value, sourceId)];
}

function sourceDefinitions(verifiedAt) {
  return [
    {
      id: SOURCE_IDS.yangguangEnglish,
      type: "manufacturer",
      title: "Wuling Red Badge Model Range",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://wuling.com/en/wulingRed",
      documentId: "Wuling Red Badge EN current range",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English model inventory uses Yangguang as the public Latin name. Yangguang is not merged with the separate Wuling Sunshine / 五菱之光 line.",
    },
    {
      id: SOURCE_IDS.yangguangSpec,
      type: "manufacturer_technical_document",
      title: "五菱扬光参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=16",
      documentId: "SGMW carDetail 16",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "grossWeightKg", "seats", "acChargeKw"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official eight-column table supplies exact current cargo/passenger grade names and technical values. Battery energy lacks an explicit capacity basis, range cycle is not stated, and 2C is not a charging-kW value; those fields are intentionally not mapped.",
    },
    {
      id: SOURCE_IDS.yangguangFamily,
      type: "manufacturer",
      title: "五菱扬光家族8款车型上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=51893",
      documentId: "SGMW news 51893",
      documentDate: "2025-08-06",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release states the original Yangguang launch was March 2024 and records the refreshed eight-model family matrix unveiled on 2025-07-31.",
    },
    {
      id: SOURCE_IDS.bingoSSpec,
      type: "manufacturer_technical_document",
      title: "缤果S参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.wuling.com/carDetail?id=306",
      documentId: "Wuling carDetail 306",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official five-column table supplies exact 325 km, 430 km and 525 km configurations and explicitly states CLTC. Battery energy lacks a declared gross/usable/rated basis and is not mapped.",
    },
    {
      id: SOURCE_IDS.bingoSLaunch,
      type: "manufacturer",
      title: "五菱缤果S正式上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=52756",
      documentId: "SGMW news 52756",
      documentDate: "2025-09-28",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "rangeStandard"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official 2025-09-27 launch lists the four 325 km and 430 km Exclusive/Flagship configurations.",
    },
    {
      id: SOURCE_IDS.bingoS525,
      type: "manufacturer",
      title: "五菱缤果S 525km旗舰款上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=55367",
      documentId: "SGMW news 55367",
      documentDate: "2026-03-16",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "rangeStandard"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release adds the exact 525 km Flagship configuration to the Bingo S range in March 2026.",
    },
    {
      id: SOURCE_IDS.bingoProPresale,
      type: "manufacturer",
      title: "全新五菱缤果Pro开启预售",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=55868",
      documentId: "SGMW news 55868",
      documentDate: "2026-04-15",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "lengthMm", "widthMm", "heightMm", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official presale release lists all four 330 km and 403 km grades and exact body dimensions. It does not state a range cycle, battery-capacity basis or motor output, so none is inferred.",
    },
    {
      id: SOURCE_IDS.bingoProLaunch,
      type: "manufacturer",
      title: "全新五菱缤果Pro上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=56650",
      documentId: "SGMW news 56650",
      documentDate: "2026-06-05",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release records the 2026-05-22 market launch and confirms 330 km and 403 km battery-electric choices.",
    },
  ];
}

function buildYangguangVariants(variantIds, verifiedAt) {
  const generationId = "wuling/yangguang/current-family-2025";
  return YANGGUANG_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "wuling/yangguang",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE_IDS.yangguangSpec, definition.aliasSafe ?? true)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "Van",
      powertrainKind: "BEV",
      drive: "RWD",
      motorPeakKw: definition.motorPeakKw,
      rangeKm: definition.rangeKm,
      topSpeedKmh: definition.topSpeedKmh,
      lengthMm: definition.lengthMm,
      widthMm: 1800,
      heightMm: definition.heightMm,
      wheelbaseMm: 3050,
      grossWeightKg: definition.grossWeightKg,
      seats: definition.seats,
      acChargeKw: 6.6,
      status: "review",
      evidence: [
        ...evidence(SOURCE_IDS.yangguangFamily, ["market", "yearFrom", "bodyType", "powertrainKind"], "Official release establishes the refreshed eight-model China family introduced on 2025-07-31."),
        ...evidence(SOURCE_IDS.yangguangSpec, ["name", "market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "grossWeightKg", "seats", "acChargeKw"], "Exact values are transcribed column-for-column from SGMW's current eight-configuration table."),
      ],
      researchNotes: [
        "The English grade label is a conservative translation; matching retains the exact Chinese manufacturer alias.",
        "The source does not identify the range cycle or battery-capacity basis. Peak motor output is never reused as legal 30-minute power, and 2C is not stored as charging kW.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildBingoSVariants(variantIds, verifiedAt) {
  const generationId = "wuling/bingo-s/launch-2025";
  return BINGO_S_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "wuling/bingo-s",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE_IDS.bingoSSpec)],
      market: "China",
      yearFrom: definition.yearFrom,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      drive: "FWD",
      motorPeakKw: 75,
      rangeKm: definition.rangeKm,
      rangeStandard: "CLTC",
      topSpeedKmh: 150,
      lengthMm: 4265,
      widthMm: 1785,
      heightMm: 1600,
      wheelbaseMm: 2610,
      curbWeightKg: definition.curbWeightKg,
      seats: 5,
      acChargeKw: definition.acChargeKw,
      status: "review",
      evidence: [
        ...evidence(definition.launchSourceId, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "rangeStandard"], "Official release establishes the exact grade, launch year and CLTC range."),
        ...evidence(SOURCE_IDS.bingoSSpec, ["name", "market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"], "Exact values are transcribed column-for-column from Wuling's current five-configuration table."),
      ],
      researchNotes: [
        "The English grade label is a conservative translation; matching retains the exact Chinese manufacturer alias.",
        "Battery capacity is omitted because the table does not declare gross, usable or rated basis. Peak motor output is never reused as legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildBingoProVariants(variantIds, verifiedAt) {
  const generationId = "wuling/bingo-pro/launch-2026";
  return BINGO_PRO_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "wuling/bingo-pro",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE_IDS.bingoProPresale)],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      rangeKm: definition.rangeKm,
      lengthMm: 4050,
      widthMm: 1758,
      heightMm: 1580,
      seats: 5,
      status: "review",
      evidence: [
        ...evidence(SOURCE_IDS.bingoProPresale, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "lengthMm", "widthMm", "heightMm", "seats"], "Official presale lists the exact grade, range figure, dimensions and five-seat configuration."),
        ...evidence(SOURCE_IDS.bingoProLaunch, ["market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"], "Official release confirms the May 2026 market launch and both advertised range choices."),
      ],
      researchNotes: [
        "The English grade label is a conservative translation; matching retains the exact Chinese manufacturer alias.",
        "Range cycle, motor power, battery capacity, wheelbase, mass and exact charging kW remain empty because the cited releases do not provide them unambiguously.",
      ],
      updatedAt: verifiedAt,
    }));
}

export async function buildWulingMassModelsBatch02({ verifiedAt = "2026-08-18" } = {}) {
  const workspace = await loadWorkspace();
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sources = sourceDefinitions(verifiedAt).filter((source) => !sourceIds.has(source.id));
  const models = MODEL_DEFINITIONS.map((definition) => {
    const existing = workspace.records.model.find((record) => record.id === definition.id);
    if (!existing) throw new Error(`${definition.id} is missing`);
    return {
      ...existing,
      canonicalName: definition.canonicalName,
      sourceNames: addSourceName(existing.sourceNames, definition.sourceName, definition.sourceNameSourceId),
      productionFrom: definition.productionFrom,
      bodyTypes: definition.bodyTypes,
      powertrainKinds: definition.powertrainKinds,
      evidence: [
        ...existing.evidence,
        ...evidence(definition.identitySourceId, definition.identityFields, definition.identityNote),
        ...(definition.factSourceId ? evidence(definition.factSourceId, definition.factFields, "SGMW's official release establishes the production date, battery-electric powertrain and van family body class.") : []),
      ],
      researchNotes: [
        ...existing.researchNotes,
        "Exact manufacturer configurations are staged below in a grouped mass-model batch; publication and pricing remain disconnected.",
      ],
      updatedAt: verifiedAt,
    };
  });

  const generationDefinitions = [
    {
      id: "wuling/yangguang/current-family-2025",
      modelId: "wuling/yangguang",
      name: "Current family (2025)",
      sourceName: "五菱扬光家族",
      sourceId: SOURCE_IDS.yangguangFamily,
      productionFrom: "2025-07",
      bodyTypes: ["Van"],
    },
    {
      id: "wuling/bingo-s/launch-2025",
      modelId: "wuling/bingo-s",
      name: "Launch generation (2025)",
      sourceName: "五菱缤果S",
      sourceId: SOURCE_IDS.bingoSLaunch,
      productionFrom: "2025-09",
      bodyTypes: ["Hatchback"],
    },
    {
      id: "wuling/bingo-pro/launch-2026",
      modelId: "wuling/bingo-pro",
      name: "Launch generation (2026)",
      sourceName: "全新五菱缤果Pro",
      sourceId: SOURCE_IDS.bingoProLaunch,
      productionFrom: "2026-05",
      bodyTypes: ["Hatchback"],
    },
  ];

  const generations = generationDefinitions
    .filter((definition) => !generationIds.has(definition.id))
    .map((definition) => ({
      id: definition.id,
      modelId: definition.modelId,
      name: definition.name,
      aliases: [alias(definition.sourceName, definition.sourceId)],
      platformCodes: [],
      productionFrom: definition.productionFrom,
      productionTo: null,
      bodyTypes: definition.bodyTypes,
      status: "review",
      evidence: evidence(definition.sourceId, ["name", "productionFrom", "bodyTypes"], "Official manufacturer release establishes the launch-family identity, month and normalized body class."),
      researchNotes: ["Public launch-family container only; no unverified platform or internal generation code is inferred."],
      updatedAt: verifiedAt,
    }));

  const variants = [
    ...buildYangguangVariants(variantIds, verifiedAt),
    ...buildBingoSVariants(variantIds, verifiedAt),
    ...buildBingoProVariants(variantIds, verifiedAt),
  ];

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: {
      newSources: sources.length,
      replacedModels: models.length,
      newGenerations: generations.length,
      newVariants: variants.length,
    },
    modelIds: MODEL_DEFINITIONS.map((definition) => definition.id),
    generationIds: generationDefinitions.map((definition) => definition.id),
    variantIds: variants.map((record) => record.id),
    perModel: {
      "wuling/yangguang": { variants: variants.filter((record) => record.modelId === "wuling/yangguang").length },
      "wuling/bingo-s": { variants: variants.filter((record) => record.modelId === "wuling/bingo-s").length },
      "wuling/bingo-pro": { variants: variants.filter((record) => record.modelId === "wuling/bingo-pro").length },
    },
    policy: {
      groupedMassModelBatch: true,
      officialManufacturerSourcesOnly: true,
      EnglishCanonicalNames: true,
      localizedSourceNamesRetainedAsAliases: true,
      ambiguousDuplicateAliasesMarkedUnsafe: true,
      unspecifiedBatteryBasisRejected: true,
      unstatedRangeCycleRejected: true,
      motorPeakNotPower30Min: true,
      automaticPublicationReady: false,
    },
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        chunk("model", models),
        ...(generations.length ? [chunk("generation", generations)] : []),
        ...(variants.length ? [chunk("variant", variants)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildWulingMassModelsBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ totals: report.totals, perModel: report.perModel }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
