import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/baojun-mass-models-batch-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/baojun-mass-models-batch-02-2026-08-18.json");

const SOURCES = {
  valliEnglish: "src-gm-baojun-valli-launch-en-2021",
  valliChinese: "src-gm-baojun-valli-launch-zh-2021",
  kiwiEnglish: "src-gm-baojun-kiwi-launch-en-2021",
  kiwiChinese: "src-gm-baojun-kiwi-launch-zh-2021",
  kiwi2023: "src-gm-baojun-kiwi-2023-launch-zh",
  yunduoLaunch: "src-gm-baojun-yunduo-launch-zh-2023",
  cloudBody: "src-wuling-indonesia-cloud-ev-body-en-2024",
  e6Spec: "src-sgmw-baojun-e6-current-spec",
};

const VALLI_VARIANTS = [
  { slug: "moganshan-valley-mt-elite", sourceName: "莫干山谷MT精英型", name: "Moganshan Valley MT Elite", transmission: "Manual" },
  { slug: "ili-pasture-cvt-luxury", sourceName: "伊犁牧场CVT豪华型", name: "Ili Pasture CVT Luxury", transmission: "CVT" },
  { slug: "dali-sky-cvt-premium", sourceName: "大理天空CVT尊享型", name: "Dali Sky CVT Premium", transmission: "CVT" },
  { slug: "nagqu-stars-cvt-flagship", sourceName: "那曲繁星CVT旗舰型", name: "Nagqu Stars CVT Flagship", transmission: "CVT" },
];

const KIWI_VARIANTS = [
  { generation: "2021-launch", year: 2021, slug: "designer", sourceName: "设计师", name: "Designer", motorPeakKw: 40, sourceId: SOURCES.kiwiChinese },
  { generation: "2021-launch", year: 2021, slug: "artist", sourceName: "艺术家", name: "Artist", motorPeakKw: 40, sourceId: SOURCES.kiwiChinese },
  { generation: "2023-model-year", year: 2023, slug: "trend", sourceName: "智潮版", name: "Trend", motorPeakKw: 50, sourceId: SOURCES.kiwi2023 },
  { generation: "2023-model-year", year: 2023, slug: "luxury", sourceName: "智奢版", name: "Luxury", motorPeakKw: 50, sourceId: SOURCES.kiwi2023 },
  { generation: "2023-model-year", year: 2023, slug: "dji-edition", sourceName: "大疆版", name: "DJI Edition", motorPeakKw: 50, sourceId: SOURCES.kiwi2023 },
];

const YUNDUO_VARIANTS = [
  { slug: "360-plus", sourceName: "360 Plus", name: "360 Plus" },
  { slug: "360-pro", sourceName: "360 Pro", name: "360 Pro" },
  { slug: "460-pro", sourceName: "460 Pro", name: "460 Pro" },
  { slug: "460-max", sourceName: "460 Max", name: "460 Max" },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note, confidence = "official") {
  return [{ sourceId, fields, status: "verified", confidence, note }];
}

function localized(value, sourceId) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [sourceId] };
}

function sourceSpelling(value, sourceId, language = "en") {
  return { value, kind: "source_spelling", safe: true, language, market: "China", sourceIds: [sourceId] };
}

function appendUnique(records, candidate) {
  return records.some((record) => record.value === candidate.value) ? records : [...records, candidate];
}

function sourceDefinitions(verifiedAt) {
  const sgmw = {
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    verifiedAt,
    market: "China",
    confidence: "official",
    status: "active",
    license: null,
  };
  return [
    {
      ...sgmw,
      id: SOURCES.valliEnglish,
      type: "manufacturer",
      title: "Baojun Launches Valli Station Wagon",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2021/Jun/0611-baojun.html",
      documentId: "GM China Baojun Valli launch EN",
      documentDate: "2021-06-11",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "bodyType", "powertrainKind", "icePowerKw", "transmission", "lengthMm", "widthMm", "heightMm", "wheelbaseMm"],
      notes: "Official English launch establishes the Valli station-wagon identity, 2021 launch, exact dimensions and shared 108-kW turbo/CVT specification.",
    },
    {
      ...sgmw,
      id: SOURCES.valliChinese,
      type: "manufacturer",
      title: "Valli（向往）7.98-10.58万重磅上市",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2021/Jun/0611-baojun.html",
      documentId: "GM China Baojun Valli launch ZH",
      documentDate: "2021-06-11",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "bodyTypes", "market", "yearFrom", "bodyType", "powertrainKind", "transmission", "seats"],
      notes: "Official China launch lists all four exact sale configurations, identifies the MT/CVT split and describes the five-seat layout.",
    },
    {
      ...sgmw,
      id: SOURCES.kiwiEnglish,
      type: "manufacturer",
      title: "Baojun Launches KiWi Electric Vehicle",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2021/Aug/0831-baojun-kiwi.html",
      documentId: "GM China Baojun KiWi launch EN",
      documentDate: "2021-08-31",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "powertrainKind", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats"],
      notes: "Official English launch supplies the public KiWi EV identity and exact shared values for the two original configurations. The range cycle is not stated.",
    },
    {
      ...sgmw,
      id: SOURCES.kiwiChinese,
      type: "manufacturer",
      title: "“未来感摩登座驾”KiWi EV携手宋茜正式上市",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2021/Aug/0831-baojun-kiwi.html",
      documentId: "GM China Baojun KiWi launch ZH",
      documentDate: "2021-08-31",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "bodyTypes", "market", "yearFrom", "bodyType", "powertrainKind", "motorPeakKw", "rangeKm"],
      notes: "Official China launch names the Designer and Artist configurations and confirms the shared 40-kW motor and 305-km range.",
    },
    {
      ...sgmw,
      id: SOURCES.kiwi2023,
      type: "manufacturer",
      title: "2023款KiWi EV上市 开启“人人都能拥有的智能驾驶”新时代",
      url: "https://media.gm.com/media/cn/zh/baojun/home.detail.html/content/Pages/news/cn/zh/2022/Sept/0915-baojun-kiwi-ev.html",
      documentId: "GM China Baojun KiWi 2023 launch ZH",
      documentDate: "2022-09-15",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "bodyTypes", "market", "yearFrom", "bodyType", "powertrainKind", "motorPeakKw"],
      notes: "Official launch lists all three 2023-model-year configurations and explicitly states a 50-kW motor.",
    },
    {
      ...sgmw,
      id: SOURCES.yunduoLaunch,
      type: "manufacturer",
      title: "9.58万元起！宝骏云朵“史诗级”上市",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2023/Aug/0810-baojun.html",
      documentId: "GM China Baojun Yunduo launch ZH",
      documentDate: "2023-08-10",
      language: "zh-CN",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "powertrainKind", "motorPeakKw", "topSpeedKmh", "seats"],
      notes: "Official China launch lists the four exact Yunduo configurations and confirms five seats, BEV propulsion, a 100-kW motor and 150-km/h top speed. Trim numbers are not reinterpreted as certified range values.",
    },
    {
      id: SOURCES.cloudBody,
      type: "manufacturer",
      title: "Wuling Introduces Cloud EV, Medium Hatchback EV with The Future of Comfort",
      publisher: "PT SGMW Motor Indonesia",
      url: "https://wuling.id/en/blog/press-release/wuling-introduces-cloud-ev-medium-hatchback-ev-with-the-future-of-comfort",
      documentId: "Wuling Indonesia Cloud EV introduction EN",
      documentDate: "2024-02-15",
      verifiedAt,
      market: "Indonesia",
      language: "en",
      supportedFields: ["bodyTypes", "bodyType"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official SGMW Indonesia material identifies the export sibling of Baojun Yunduo as a medium hatchback. No Indonesia-market technical value is copied into the China variants.",
    },
    {
      ...sgmw,
      id: SOURCES.e6Spec,
      type: "manufacturer_technical_document",
      title: "宝骏E6参数配置",
      url: "https://www.sgmw.com.cn/carDetail?id=307",
      documentId: "SGMW carDetail 307",
      documentDate: null,
      language: "zh-CN",
      supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"],
      notes: "Official current technical table supplies one exact 2026 E6 configuration and its dimensions, performance and charging values. Battery energy and range cycle are left uninterpreted because their legal basis is unstated.",
    },
  ];
}

function buildValliVariants(variantIds, verifiedAt) {
  const generationId = "baojun/valli/2021-launch";
  return VALLI_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "baojun/valli",
      generationId,
      faceliftId: null,
      name: `2021 ${definition.name}`,
      aliases: [localized(definition.sourceName, SOURCES.valliChinese)],
      market: "China",
      yearFrom: 2021,
      yearTo: null,
      bodyType: "Wagon",
      powertrainKind: "ICE",
      transmission: definition.transmission,
      icePowerKw: 108,
      lengthMm: 4685,
      widthMm: 1806,
      heightMm: 1485,
      wheelbaseMm: 2700,
      seats: 5,
      status: "review",
      evidence: [
        ...evidence(SOURCES.valliEnglish, ["bodyType", "powertrainKind", "icePowerKw", ...(definition.transmission === "CVT" ? ["transmission"] : []), "lengthMm", "widthMm", "heightMm", "wheelbaseMm"], "Official English launch supplies the shared station-wagon dimensions and 108-kW specification."),
        ...evidence(SOURCES.valliChinese, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "transmission", "seats"], "Official China launch lists this exact configuration and its MT/CVT designation."),
      ],
      researchNotes: [
        "The public 1.5T label is not rounded into an invented exact engine displacement; the simulated CVT ratio count is not stored as physical gears.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildKiwiVariants(variantIds, verifiedAt) {
  return KIWI_VARIANTS
    .filter((definition) => !variantIds.has(`baojun/kiwi-ev/${definition.generation}/${definition.slug}`))
    .map((definition) => {
      const originalLaunch = definition.year === 2021;
      return {
        id: `baojun/kiwi-ev/${definition.generation}/${definition.slug}`,
        modelId: "baojun/kiwi-ev",
        generationId: `baojun/kiwi-ev/${definition.generation}`,
        faceliftId: null,
        name: `${definition.year} ${definition.name}`,
        aliases: [localized(definition.sourceName, definition.sourceId)],
        market: "China",
        yearFrom: definition.year,
        yearTo: null,
        bodyType: "Hatchback",
        powertrainKind: "BEV",
        motorPeakKw: definition.motorPeakKw,
        ...(originalLaunch ? {
          rangeKm: 305,
          topSpeedKmh: 100,
          lengthMm: 2894,
          widthMm: 1655,
          heightMm: 1595,
          wheelbaseMm: 2020,
          seats: 4,
        } : {}),
        status: "review",
        evidence: [
          ...(originalLaunch ? evidence(SOURCES.kiwiEnglish, ["powertrainKind", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats"], "Official English launch supplies exact shared values for the original two configurations.") : []),
          ...evidence(definition.sourceId, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "motorPeakKw", ...(originalLaunch ? ["rangeKm"] : [])], "Official China launch lists this exact configuration and its shared motor output.", originalLaunch ? "official" : "high"),
        ],
        researchNotes: [
          "KiWi is conservatively classified as a hatchback from the official two-box passenger-car presentation; publication remains review-only.",
          ...(originalLaunch ? ["The 305-km release value has no stated certification cycle; no battery-capacity basis or legal 30-minute power is invented."] : ["Carry-over dimensions, range and battery values are deliberately not copied into the 2023 model-year variants without an exact reviewed table."]),
        ],
        updatedAt: verifiedAt,
      };
    });
}

function buildYunduoVariants(variantIds, verifiedAt) {
  const generationId = "baojun/yunduo/2023-launch";
  return YUNDUO_VARIANTS
    .filter((definition) => !variantIds.has(`${generationId}/${definition.slug}`))
    .map((definition) => ({
      id: `${generationId}/${definition.slug}`,
      modelId: "baojun/yunduo",
      generationId,
      faceliftId: null,
      name: `2023 ${definition.name}`,
      aliases: [sourceSpelling(definition.sourceName, SOURCES.yunduoLaunch)],
      market: "China",
      yearFrom: 2023,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      motorPeakKw: 100,
      topSpeedKmh: 150,
      seats: 5,
      status: "review",
      evidence: [
        ...evidence(SOURCES.yunduoLaunch, ["name", "market", "yearFrom", "powertrainKind", "motorPeakKw", "topSpeedKmh", "seats"], "Official China launch lists this exact configuration and the shared five-seat BEV performance values."),
        ...evidence(SOURCES.cloudBody, ["bodyType"], "Official SGMW export material identifies the same vehicle architecture as a medium hatchback."),
      ],
      researchNotes: [
        "The numeric trim prefixes remain part of the official configuration names and are not promoted to rangeKm without a reviewed China technical table.",
        "No battery-capacity basis or legal 30-minute power is inferred.",
      ],
      updatedAt: verifiedAt,
    }));
}

function buildE6Variants(variantIds, verifiedAt) {
  const generationId = "baojun/e6/2026-model-year";
  const id = `${generationId}/500km-enjoyment`;
  if (variantIds.has(id)) return [];
  return [{
    id,
    modelId: "baojun/e6",
    generationId,
    faceliftId: null,
    name: "2026 500 km Enjoyment",
    aliases: [localized("2026款 500km 畅享版", SOURCES.e6Spec)],
    market: "China",
    yearFrom: 2026,
    yearTo: null,
    bodyType: "SUV",
    powertrainKind: "BEV",
    drive: "FWD",
    motorPeakKw: 150,
    rangeKm: 500,
    topSpeedKmh: 170,
    lengthMm: 4541,
    widthMm: 1880,
    heightMm: 1608,
    wheelbaseMm: 2750,
    curbWeightKg: 1675,
    seats: 5,
    acChargeKw: 6.6,
    status: "review",
    evidence: evidence(SOURCES.e6Spec, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "topSpeedKmh", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "acChargeKw"], "Exact values are transcribed column-for-column from SGMW's current E6 technical table."),
    researchNotes: [
      "The table does not state the range certification cycle or whether battery energy is gross, usable or rated; those fields remain empty.",
      "Peak motor output is never reused as legal 30-minute power.",
    ],
    updatedAt: verifiedAt,
  }];
}

export async function buildBaojunMassModelsBatch02({ verifiedAt = "2026-08-18" } = {}) {
  const workspace = await loadWorkspace();
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const modelIds = new Set(workspace.records.model.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));
  const sources = sourceDefinitions(verifiedAt).filter((source) => !sourceIds.has(source.id));

  const modelDefinitions = [
    { id: "baojun/valli", canonicalName: "Valli", slug: "valli", productionFrom: "2021-06", bodyTypes: ["Wagon"], powertrainKinds: ["ICE"], sourceId: SOURCES.valliEnglish, localizedName: "宝骏 Valli" },
    { id: "baojun/kiwi-ev", canonicalName: "KiWi EV", slug: "kiwi-ev", productionFrom: "2021-08", bodyTypes: ["Hatchback"], powertrainKinds: ["BEV"], sourceId: SOURCES.kiwiEnglish, localizedName: "宝骏 KiWi EV" },
    { id: "baojun/yunduo", canonicalName: "Yunduo", slug: "yunduo", productionFrom: "2023-08", bodyTypes: ["Hatchback"], powertrainKinds: ["BEV"], sourceId: SOURCES.yunduoLaunch, localizedName: "宝骏云朵" },
    { id: "baojun/e6", canonicalName: "E6", slug: "e6", productionFrom: null, bodyTypes: ["SUV"], powertrainKinds: ["BEV"], sourceId: SOURCES.e6Spec, localizedName: "宝骏 E6" },
  ];

  let newModels = 0;
  let replacedModels = 0;
  const models = modelDefinitions.map((definition) => {
    const existing = workspace.records.model.find((record) => record.id === definition.id);
    if (existing) replacedModels += 1;
    else newModels += 1;
    const base = existing || {
      id: definition.id,
      brandId: "baojun",
      canonicalName: definition.canonicalName,
      slug: definition.slug,
      aliases: [],
      sourceNames: [],
      productionFrom: definition.productionFrom,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [],
      researchNotes: [],
      updatedAt: verifiedAt,
    };
    const sourceNames = appendUnique(base.sourceNames || [], localized(definition.localizedName, definition.sourceId));
    const evidenceFields = ["canonicalName", "bodyTypes", "powertrainKinds", ...(definition.productionFrom ? ["productionFrom"] : [])];
    return {
      ...base,
      canonicalName: definition.canonicalName,
      slug: definition.slug,
      sourceNames,
      productionFrom: definition.productionFrom,
      bodyTypes: definition.bodyTypes,
      powertrainKinds: definition.powertrainKinds,
      status: "review",
      evidence: [
        ...base.evidence,
        ...evidence(definition.sourceId, evidenceFields, "Official manufacturer material establishes the Latin public identity, body class and powertrain family."),
      ],
      researchNotes: [
        ...base.researchNotes,
        "Exact configurations are staged in a grouped mass-model batch; publication and pricing remain disconnected pending review.",
      ],
      updatedAt: verifiedAt,
    };
  });

  const generationDefinitions = [
    { id: "baojun/valli/2021-launch", modelId: "baojun/valli", name: "Launch generation (2021)", sourceName: "Valli（向往）", sourceId: SOURCES.valliChinese, productionFrom: "2021-06", bodyTypes: ["Wagon"] },
    { id: "baojun/kiwi-ev/2021-launch", modelId: "baojun/kiwi-ev", name: "Launch generation (2021)", sourceName: "KiWi EV", sourceId: SOURCES.kiwiChinese, productionFrom: "2021-08", bodyTypes: ["Hatchback"] },
    { id: "baojun/kiwi-ev/2023-model-year", modelId: "baojun/kiwi-ev", name: "2023 model year", sourceName: "2023款KiWi EV", sourceId: SOURCES.kiwi2023, productionFrom: "2022-09", bodyTypes: ["Hatchback"] },
    { id: "baojun/yunduo/2023-launch", modelId: "baojun/yunduo", name: "Launch generation (2023)", sourceName: "宝骏云朵", sourceId: SOURCES.yunduoLaunch, productionFrom: "2023-08", bodyTypes: ["Hatchback"] },
    { id: "baojun/e6/2026-model-year", modelId: "baojun/e6", name: "2026 model year", sourceName: "宝骏E6 2026款", sourceId: SOURCES.e6Spec, productionFrom: null, bodyTypes: ["SUV"] },
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
      evidence: evidence(definition.sourceId, ["name", ...(definition.productionFrom ? ["productionFrom"] : []), "bodyTypes"], "Official manufacturer material establishes the public lineup container and body class."),
      researchNotes: ["Public lineup container only; no unverified platform or internal generation code is inferred."],
      updatedAt: verifiedAt,
    }));

  const variants = [
    ...buildValliVariants(variantIds, verifiedAt),
    ...buildKiwiVariants(variantIds, verifiedAt),
    ...buildYunduoVariants(variantIds, verifiedAt),
    ...buildE6Variants(variantIds, verifiedAt),
  ];
  const trackedModelIds = modelDefinitions.map((definition) => definition.id);
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, newModels, replacedModels, newGenerations: generations.length, newVariants: variants.length },
    modelIds: trackedModelIds,
    generationIds: generationDefinitions.map((definition) => definition.id),
    variantIds: variants.map((record) => record.id),
    perModel: Object.fromEntries(trackedModelIds.map((modelId) => [modelId, { variants: variants.filter((record) => record.modelId === modelId).length }])),
    policy: {
      groupedMassModelBatch: true,
      officialManufacturerSourcesOnly: true,
      EnglishCanonicalNames: true,
      localizedSourceNamesRetainedAsAliases: true,
      unspecifiedBatteryBasisRejected: true,
      unstatedRangeCycleRejected: true,
      numericTrimNamesNotAssumedToBeRange: true,
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
  const { report, ingestion } = await buildBaojunMassModelsBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ totals: report.totals, perModel: report.perModel }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
