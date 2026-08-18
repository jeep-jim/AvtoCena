import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/baojun-mass-models-batch-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/baojun-mass-models-batch-01-2026-08-18.json");

const SOURCES = {
  yunhaiLaunch: "src-gm-baojun-yun-hai-2026-launch-en",
  yunhaiSpec: "src-sgmw-baojun-yunhai-current-spec",
  yepPlusLaunch: "src-sgmw-baojun-yep-plus-2026-launch",
  yepPlusSpec: "src-sgmw-baojun-yep-plus-current-spec",
  xiangjingEnglish: "src-gm-baojun-xiang-jing-unveil-en-2024",
  xiangjingSpec: "src-sgmw-baojun-xiangjing-current-spec",
  xiangjingLaunchPlan: "src-sgmw-baojun-xiangjing-april-launch-plan-2025",
};

const YUNHAI_VARIANTS = [
  { slug: "2026-140km-phev-standard", sourceName: "2026款 140km 插混标准版", name: "2026 140 km PHEV Standard", powertrainKind: "PHEV", rangeKm: 140, lengthMm: 4590, curbWeightKg: 1700, acChargeKw: 3.3, icePowerKw: 78 },
  { slug: "2026-500km-ev-standard", sourceName: "2026款 500km 纯电标准版", name: "2026 500 km EV Standard", powertrainKind: "BEV", rangeKm: 500, lengthMm: 4541, curbWeightKg: 1675, acChargeKw: 6.6 },
  { slug: "2026-600km-ev-standard", sourceName: "2026款 600km 纯电标准版", name: "2026 600 km EV Standard", powertrainKind: "BEV", rangeKm: 600, lengthMm: 4541, curbWeightKg: 1760, acChargeKw: 6.6 },
  { slug: "2026-500km-ev", sourceName: "2026款 500km 纯电版", name: "2026 500 km EV", powertrainKind: "BEV", rangeKm: 500, lengthMm: 4541, curbWeightKg: 1675, acChargeKw: 6.6 },
  { slug: "2026-600km-ev", sourceName: "2026款 600km 纯电版", name: "2026 600 km EV", powertrainKind: "BEV", rangeKm: 600, lengthMm: 4541, curbWeightKg: 1760, acChargeKw: 6.6 },
];

const YEP_PLUS_VARIANTS = [
  { slug: "2026-301km-flagship", sourceName: "2026款 301km旗舰版", name: "2026 301 km Flagship", rangeKm: 301, curbWeightKg: 1255 },
  { slug: "2026-401km-flagship", sourceName: "2026款 401km旗舰版", name: "2026 401 km Flagship", rangeKm: 401, curbWeightKg: 1325 },
  { slug: "2026-501km-flagship", sourceName: "2026款 501km旗舰版", name: "2026 501 km Flagship", rangeKm: 501, curbWeightKg: 1410 },
  { slug: "2026-501km-intelligent-premium", sourceName: "2026款 501km智尊版", name: "2026 501 km Intelligent Premium", rangeKm: 501, curbWeightKg: 1410 },
];

const XIANGJING_VARIANTS = [
  { slug: "140km-phev-standard", sourceName: "140km 插混标准版", name: "140 km PHEV Standard", powertrainKind: "PHEV", rangeKm: 140, heightMm: 1505, motorPeakKw: 160, topSpeedKmh: 190, acChargeKw: 3.3, icePowerKw: 105 },
  { slug: "140km-phev-luxury", sourceName: "140km 插混豪华版", name: "140 km PHEV Luxury", powertrainKind: "PHEV", rangeKm: 140, heightMm: 1505, motorPeakKw: 160, topSpeedKmh: 190, acChargeKw: 3.3, icePowerKw: 105 },
  { slug: "600km-ev-standard", sourceName: "600km 纯电标准版", name: "600 km EV Standard", powertrainKind: "BEV", rangeKm: 600, heightMm: 1490, motorPeakKw: 186, topSpeedKmh: 170, acChargeKw: 6.6 },
  { slug: "600km-ev-luxury", sourceName: "600km 纯电豪华版", name: "600 km EV Luxury", powertrainKind: "BEV", rangeKm: 600, heightMm: 1490, motorPeakKw: 186, topSpeedKmh: 170, acChargeKw: 6.6 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function localized(value, sourceId) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [sourceId] };
}

function sourceSpelling(value, sourceId) {
  return { value, kind: "source_spelling", safe: true, language: "en", market: "China", sourceIds: [sourceId] };
}

function appendUnique(records, candidate) {
  return records.some((record) => record.value === candidate.value) ? records : [...records, candidate];
}

function sourceDefinitions(verifiedAt) {
  const common = {
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    verifiedAt,
    market: "China",
    confidence: "official",
    status: "active",
    license: null,
  };
  return [
    {
      ...common,
      id: SOURCES.yunhaiLaunch,
      type: "manufacturer",
      title: "Baojun launches the 2026 Yun Hai SUV featuring enhanced comfort",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2025/jul/0717-baojun.html",
      documentId: "GM China Baojun Yun Hai 2026 launch EN",
      documentDate: "2025-07-17",
      language: "en",
      supportedFields: ["productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"],
      notes: "Official English launch lists exactly five 2026 Yun Hai variants and establishes the SUV body and BEV/PHEV choices. Its range figures are retained without inventing an unstated certification cycle.",
    },
    {
      ...common,
      id: SOURCES.yunhaiSpec,
      type: "manufacturer_technical_document",
      title: "宝骏云海参数配置",
      url: "https://www.sgmw.com.cn/carDetail?id=267",
      documentId: "SGMW carDetail 267",
      documentDate: null,
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "icePowerKw", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"],
      notes: "Official multi-column table supplies exact 2026 grade names and technical values. Battery energy lacks an explicit capacity basis and the pure-electric range row does not identify a cycle, so neither is over-interpreted.",
    },
    {
      ...common,
      id: SOURCES.yepPlusLaunch,
      type: "manufacturer",
      title: "大空间方盒子闯入七万级，宝骏悦也Plus 2026款正式上市",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=50930",
      documentId: "SGMW news 50930",
      documentDate: "2025-05-28",
      language: "zh-CN",
      supportedFields: ["productionFrom", "bodyTypes", "name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"],
      notes: "Official release records the 2025-05-27 launch of the four exact 2026-model-year Yep Plus configurations.",
    },
    {
      ...common,
      id: SOURCES.yepPlusSpec,
      type: "manufacturer_technical_document",
      title: "宝骏悦也Plus参数配置",
      url: "https://www.sgmw.com.cn/carDetail?id=292",
      documentId: "SGMW carDetail 292",
      documentDate: null,
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"],
      notes: "Official table supplies exact 2026 grades and values. Battery energy has no declared gross/usable/rated basis and the range row has no certification cycle, so those interpretations remain empty.",
    },
    {
      ...common,
      id: SOURCES.xiangjingEnglish,
      type: "manufacturer",
      title: "Meet Baojun's Xiang Jing Intelligent Flagship Sedan",
      url: "https://news.gm.com.cn/en/home.detail.print.html/content/Pages/news/cn/en/2024/dec/1230-baojun.html",
      documentId: "GM China Baojun Xiang Jing reveal EN",
      documentDate: "2024-12-30",
      language: "en",
      supportedFields: ["productionFrom", "bodyTypes", "powertrainKinds", "bodyType", "powertrainKind", "lengthMm", "widthMm", "heightMm", "wheelbaseMm"],
      notes: "Official English reveal uses the spaced source spelling Xiang Jing, identifies the flagship sedan as BEV/PHEV, supplies exact dimensions and records first production on 2024-12-29.",
    },
    {
      ...common,
      id: SOURCES.xiangjingSpec,
      type: "manufacturer_technical_document",
      title: "宝骏享境参数配置",
      url: "https://www.wuling.com/carDetail?id=280",
      documentId: "Wuling carDetail 280",
      documentDate: null,
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "bodyType", "powertrainKind", "fuel", "drive", "icePowerKw", "motorPeakKw", "rangeKm", "rangeStandard", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "tankCapacityL", "acChargeKw"],
      notes: "Official four-column table supplies the exact launch grades and technical values, including explicit CLTC range. Battery energy remains unmapped because no gross/usable/rated basis is declared.",
    },
    {
      ...common,
      id: SOURCES.xiangjingLaunchPlan,
      type: "manufacturer",
      title: "上汽通用五菱一季度实销377257辆",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=50227",
      documentId: "SGMW news 50227",
      documentDate: "2025-04-02",
      language: "zh-CN",
      supportedFields: ["productionFrom", "bodyTypes", "name", "market", "yearFrom", "bodyType", "powertrainKind"],
      notes: "Official company release states Xiangjing had entered production and would launch in April 2025, bounding the four public sale grades to the 2025 China lineup.",
    },
  ];
}

function buildYunhaiVariants(variantIds, verifiedAt) {
  const generationId = "baojun/yunhai/2026-model-year";
  return YUNHAI_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "baojun/yunhai",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [localized(definition.sourceName, SOURCES.yunhaiSpec)],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: definition.powertrainKind,
      drive: "FWD",
      ...(definition.icePowerKw ? { icePowerKw: definition.icePowerKw } : {}),
      motorPeakKw: 150,
      rangeKm: definition.rangeKm,
      topSpeedKmh: 170,
      lengthMm: definition.lengthMm,
      widthMm: 1880,
      heightMm: 1608,
      wheelbaseMm: 2750,
      curbWeightKg: definition.curbWeightKg,
      seats: 5,
      acChargeKw: definition.acChargeKw,
      status: "review",
      evidence: [
        ...evidence(SOURCES.yunhaiLaunch, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"], "Official English launch identifies this exact 2026 variant and its public range figure."),
        ...evidence(SOURCES.yunhaiSpec, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", ...(definition.icePowerKw ? ["icePowerKw"] : []), "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"], "Exact values are transcribed column-for-column from SGMW's current table."),
      ],
      researchNotes: [
        "The technical page does not state the range certification cycle or battery-capacity basis. Peak motor output is never reused as legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildYepPlusVariants(variantIds, verifiedAt) {
  const generationId = "baojun/yep-plus/2026-model-year";
  return YEP_PLUS_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "baojun/yep-plus",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [localized(definition.sourceName, SOURCES.yepPlusSpec)],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: "BEV",
      drive: "FWD",
      motorPeakKw: 75,
      rangeKm: definition.rangeKm,
      topSpeedKmh: 150,
      lengthMm: 3996,
      widthMm: 1760,
      heightMm: 1726,
      wheelbaseMm: 2560,
      curbWeightKg: definition.curbWeightKg,
      seats: 5,
      acChargeKw: 6.6,
      status: "review",
      evidence: [
        ...evidence(SOURCES.yepPlusLaunch, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"], "Official release lists this exact 2026-model-year configuration."),
        ...evidence(SOURCES.yepPlusSpec, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"], "Exact values are transcribed column-for-column from SGMW's current table."),
      ],
      researchNotes: [
        "The technical page does not state the range certification cycle or battery-capacity basis. Peak motor output is never reused as legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildXiangjingVariants(variantIds, verifiedAt) {
  const generationId = "baojun/xiangjing/launch-2025";
  return XIANGJING_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "baojun/xiangjing",
      generationId,
      faceliftId: null,
      name: definition.name,
      aliases: [localized(definition.sourceName, SOURCES.xiangjingSpec)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "Sedan",
      powertrainKind: definition.powertrainKind,
      ...(definition.powertrainKind === "PHEV" ? { fuel: "Petrol", icePowerKw: definition.icePowerKw, tankCapacityL: 53 } : {}),
      drive: "FWD",
      motorPeakKw: definition.motorPeakKw,
      rangeKm: definition.rangeKm,
      rangeStandard: "CLTC",
      topSpeedKmh: definition.topSpeedKmh,
      lengthMm: 5005,
      widthMm: 1900,
      heightMm: definition.heightMm,
      wheelbaseMm: 2900,
      acChargeKw: definition.acChargeKw,
      status: "review",
      evidence: [
        ...evidence(SOURCES.xiangjingEnglish, ["bodyType", "powertrainKind", "lengthMm", "widthMm", "heightMm", "wheelbaseMm"], "Official English reveal identifies the sedan, both powertrains and exact powertrain-specific dimensions."),
        ...evidence(SOURCES.xiangjingLaunchPlan, ["name", "market", "yearFrom", "bodyType", "powertrainKind"], "Official company release bounds the public sale lineup to April 2025."),
        ...evidence(SOURCES.xiangjingSpec, ["name", "market", "yearFrom", "bodyType", "powertrainKind", ...(definition.powertrainKind === "PHEV" ? ["fuel", "icePowerKw", "tankCapacityL"] : []), "drive", "motorPeakKw", "rangeKm", "rangeStandard", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "acChargeKw"], "Exact values are transcribed column-for-column from SGMW's four-grade table."),
      ],
      researchNotes: [
        "The manufacturer explicitly states CLTC range. Battery capacity remains empty because the table does not declare gross, usable or rated basis.",
        "Peak motor output is never reused as legal 30-minute power; no engine displacement is rounded from the public 1.5T label.",
      ],
      updatedAt: verifiedAt,
    }));
}

export async function buildBaojunMassModelsBatch01({ verifiedAt = "2026-08-18" } = {}) {
  const workspace = await loadWorkspace();
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));
  const sources = sourceDefinitions(verifiedAt).filter((source) => !sourceIds.has(source.id));

  const definitions = [
    { id: "baojun/yunhai", productionFrom: "2024-09", bodyTypes: ["SUV"], powertrainKinds: ["BEV", "PHEV"], sourceId: SOURCES.yunhaiLaunch, fields: ["productionFrom", "bodyTypes", "powertrainKinds"], englishAlias: "Yun Hai" },
    { id: "baojun/yep-plus", productionFrom: "2024-04", bodyTypes: ["SUV"], powertrainKinds: ["BEV"], sourceId: "src-sgmw-baojun-yep-plus-launch-2024", fields: ["productionFrom", "bodyTypes", "powertrainKinds"] },
    { id: "baojun/xiangjing", productionFrom: "2024-12", bodyTypes: ["Sedan"], powertrainKinds: ["BEV", "PHEV"], sourceId: SOURCES.xiangjingEnglish, fields: ["productionFrom", "bodyTypes", "powertrainKinds"], englishAlias: "Xiang Jing" },
  ];

  const models = definitions.map((definition) => {
    const existing = workspace.records.model.find((record) => record.id === definition.id);
    if (!existing) throw new Error(`${definition.id} is missing`);
    return {
      ...existing,
      aliases: definition.englishAlias
        ? appendUnique(existing.aliases, sourceSpelling(definition.englishAlias, definition.sourceId))
        : existing.aliases,
      productionFrom: definition.productionFrom,
      bodyTypes: definition.bodyTypes,
      powertrainKinds: definition.powertrainKinds,
      evidence: [
        ...existing.evidence,
        ...evidence(definition.sourceId, definition.fields, "Official manufacturer material establishes the production start, body class and exact powertrain family."),
      ],
      researchNotes: [
        ...existing.researchNotes,
        "Exact current configurations are staged below in a grouped mass-model batch; publication and pricing remain disconnected.",
      ],
      updatedAt: verifiedAt,
    };
  });

  const generationDefinitions = [
    { id: "baojun/yunhai/2026-model-year", modelId: "baojun/yunhai", name: "2026 model year", sourceName: "宝骏云海2026款", sourceId: SOURCES.yunhaiLaunch, productionFrom: "2025-07", bodyTypes: ["SUV"] },
    { id: "baojun/yep-plus/2026-model-year", modelId: "baojun/yep-plus", name: "2026 model year", sourceName: "宝骏悦也Plus 2026款", sourceId: SOURCES.yepPlusLaunch, productionFrom: "2025-05", bodyTypes: ["SUV"] },
    { id: "baojun/xiangjing/launch-2025", modelId: "baojun/xiangjing", name: "Launch generation (2025)", sourceName: "宝骏享境", sourceId: SOURCES.xiangjingLaunchPlan, productionFrom: "2025-04", bodyTypes: ["Sedan"] },
  ];
  const generations = generationDefinitions
    .filter((definition) => !generationIds.has(definition.id))
    .map((definition) => ({
      id: definition.id,
      modelId: definition.modelId,
      name: definition.name,
      aliases: [localized(definition.sourceName, definition.sourceId)],
      platformCodes: [],
      productionFrom: definition.productionFrom,
      productionTo: null,
      bodyTypes: definition.bodyTypes,
      status: "review",
      evidence: evidence(definition.sourceId, ["name", "productionFrom", "bodyTypes"], "Official manufacturer material establishes the public lineup identity, launch month and body class."),
      researchNotes: ["Public lineup container only; no unverified platform or internal generation code is inferred."],
      updatedAt: verifiedAt,
    }));

  const variants = [
    ...buildYunhaiVariants(variantIds, verifiedAt),
    ...buildYepPlusVariants(variantIds, verifiedAt),
    ...buildXiangjingVariants(variantIds, verifiedAt),
  ];
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: models.length, newGenerations: generations.length, newVariants: variants.length },
    modelIds: definitions.map((definition) => definition.id),
    generationIds: generationDefinitions.map((definition) => definition.id),
    variantIds: variants.map((record) => record.id),
    perModel: {
      "baojun/yunhai": { variants: variants.filter((record) => record.modelId === "baojun/yunhai").length },
      "baojun/yep-plus": { variants: variants.filter((record) => record.modelId === "baojun/yep-plus").length },
      "baojun/xiangjing": { variants: variants.filter((record) => record.modelId === "baojun/xiangjing").length },
    },
    policy: {
      groupedMassModelBatch: true,
      officialManufacturerSourcesOnly: true,
      EnglishCanonicalNames: true,
      officialEnglishSourceSpellingsSearchable: true,
      localizedSourceNamesRetainedAsAliases: true,
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
  const { report, ingestion } = await buildBaojunMassModelsBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ totals: report.totals, perModel: report.perModel }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
