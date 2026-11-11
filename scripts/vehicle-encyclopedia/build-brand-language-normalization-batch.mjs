import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-language-normalization.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-language-normalization-2026-08-17.json");
const VERIFIED_AT = "2026-08-17";
const NEVO_LOGO_SHA256 = "684c120fead24ea794082ada97f9c75ed728271dc7a528328c4c798e28c069e4";

const SOURCES = [
  {
    id: "src-changan-nevo-thailand-2026",
    type: "manufacturer",
    title: "CHANGAN NEVO brand history",
    publisher: "CHANGAN Thailand",
    url: "https://www.changan.co.th/en/about-nevo/",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Thailand",
    language: "en",
    supportedFields: ["canonicalName", "aliases", "countries"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official CHANGAN market site identifies CHANGAN NEVO as a brand launched in Chongqing, China, in 2023.",
  },
  {
    id: "src-changan-nevo-global-models-2026",
    type: "manufacturer",
    title: "CHANGAN NEVO Q05 global debut",
    publisher: "Global CHANGAN",
    url: "https://www.globalchangan.com/newsroom/changan-showcases-tech-changan-trusted-choice-at-the-47th-bangkok-motor-show-debuts-nevo-q05-in-thailand.html",
    documentId: null,
    documentDate: "2026-03-23",
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "aliases"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Global CHANGAN names CHANGAN NEVO as one of its core brands and uses the English NEVO Q05 model identity.",
  },
  {
    id: "src-changan-nevo-official-logo-2026",
    type: "manufacturer",
    title: "CHANGAN NEVO official logo asset",
    publisher: "CHANGAN Thailand",
    url: "https://www.changan.co.th/images/nevo/logo-nevo.svg",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Thailand",
    language: "en",
    supportedFields: ["brandLogo"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Official SVG normalized without distortion to transparent 90 x 60 PNG canvases. Trademark publication rights remain review-required.",
  },
  {
    id: "src-changan-qiyuan-china-current",
    type: "manufacturer",
    title: "CHANGAN China model and dealer selector",
    publisher: "Chongqing Changan Automobile Co., Ltd.",
    url: "https://www.changan.com.cn/dealer_inquiry",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "aliases"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official China selector places Q05, A06 and Q07 under 长安启源. Together with CHANGAN's English NEVO source this proves the localized Qiyuan/NEVO identity and current model codes.",
  },
  {
    id: "src-changan-oshan-pakistan-current",
    type: "authoritative_catalog",
    title: "Changan Oshan X7",
    publisher: "Master Changan Motors Limited",
    url: "https://changan.com.pk/oshan-x7/",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "Pakistan",
    language: "en",
    supportedFields: ["canonicalName", "aliases", "bodyTypes", "powertrainKinds"],
    confidence: "high",
    status: "active",
    license: null,
    notes: "The authorized Changan market site repeatedly uses Changan Oshan X7 and Oshan X7 for the same SUV identity.",
  },
  {
    id: "src-chery-fulwin-global-2026",
    type: "manufacturer",
    title: "Chery 20 millionth vehicle and the renewed FULWIN line",
    publisher: "Chery International",
    url: "https://www.cheryinternational.com/pc/news/news1/20260727/detail-2618.shtml",
    documentId: null,
    documentDate: "2026-07-27",
    verifiedAt: VERIFIED_AT,
    market: "Global",
    language: "en",
    supportedFields: ["canonicalName", "aliases"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Chery's official English release calls FULWIN a renewed product line/range within Chery, not an independent vehicle marque.",
  },
  {
    id: "src-chery-fulwin-china-current",
    type: "manufacturer",
    title: "Chery China current Chery and Fulwin model ranges",
    publisher: "Chery Automobile Co., Ltd.",
    url: "https://www.chery.cn/home",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "aliases"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official Chery site separates regular Chery models from 风云车型 while retaining both under Chery, and lists the current A, T, X and QQ line identities.",
  },
  {
    id: "src-can-am-on-road-2025",
    type: "manufacturer",
    title: "2025 Can-Am On-Road vehicles",
    publisher: "Bombardier Recreational Products Inc.",
    url: "https://can-am.brp.com/on-road/us/en/models/previous-models/2025.html",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "United States",
    language: "en",
    supportedFields: ["canonicalName"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official range consists of motorcycles and three-wheel vehicles. CAN AM therefore remains outside the passenger/light-passenger brand denominator unless a qualifying vehicle identity is proven separately.",
  },
  {
    id: "src-encar-korean-make-selector-2026",
    type: "authoritative_catalog",
    title: "Encar Korean vehicle make selector",
    publisher: "Encar.com",
    url: "https://www.encar.com/index.do",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "South Korea",
    language: "ko",
    supportedFields: ["aliases"],
    confidence: "high",
    status: "active",
    license: null,
    notes: "Exact Korean make strings are retained as marketplace source aliases only. They do not support technical specifications or cross-brand merges.",
  },
  {
    id: "src-renault-korea-about-current",
    type: "manufacturer",
    title: "About Renault Korea",
    publisher: "Renault Korea Co., Ltd.",
    url: "https://cdn.renault.co.kr/ko/company/about.jsp",
    documentId: null,
    documentDate: null,
    verifiedAt: VERIFIED_AT,
    market: "South Korea",
    language: "ko",
    supportedFields: ["canonicalName", "aliases"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "The official site identifies the current Renault Korea company/source spelling; the Encar composite preserves continuity with the former Samsung name without merging it into the separate global Renault entity.",
  },
];

const CHERY_FULWIN_MODELS = [
  ["a9", "Fulwin A9", "A9", "风云A9"],
  ["a9l", "Fulwin A9L", "A9L", "风云A9L"],
  ["a8l", "Fulwin A8L", "A8L", "风云A8L"],
  ["t9l", "Fulwin T9L", "T9L", "风云T9L"],
  ["t11", "Fulwin T11", "T11", "风云T11"],
  ["t9", "Fulwin T9", "T9", "风云T9"],
  ["t8", "Fulwin T8", "T8", "风云T8"],
  ["t10", "Fulwin T10", "T10", "风云T10"],
  ["x3l", "Fulwin X3L", "X3L", "风云X3L"],
  ["x3", "Fulwin X3", "X3", "风云X3"],
  ["x3-plus", "Fulwin X3 Plus", "X3 PLUS", "风云X3 PLUS"],
  ["qq3", "Fulwin QQ3", "QQ3", "全新QQ3"],
];

const CHANGAN_NEVO_MODELS = [
  ["q05", "Q05", "NEVO Q05", "长安启源Q05"],
  ["a06", "A06", "NEVO A06", "长安启源A06"],
  ["q07", "Q07", "NEVO Q07", "长安启源Q07"],
];

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function addAliases(entity, aliases) {
  const next = [...(entity.aliases || [])];
  const seen = new Set([entity.canonicalName, ...next.map((alias) => alias.value)].map(normalizeTerm));
  for (const alias of aliases) {
    if (seen.has(normalizeTerm(alias.value))) continue;
    seen.add(normalizeTerm(alias.value));
    next.push(alias);
  }
  return { ...entity, aliases: next, updatedAt: VERIFIED_AT };
}

function exactModel({ id, brandId, canonicalName, sourceNames, sourceIds, researchNotes = [] }) {
  return {
    id,
    brandId,
    canonicalName,
    slug: id.split("/").at(-1),
    aliases: [],
    sourceNames,
    productionFrom: null,
    productionTo: null,
    bodyTypes: [],
    powertrainKinds: [],
    mediaIds: [],
    status: "review",
    evidence: sourceIds.map((sourceId) => ({
      sourceId,
      fields: ["canonicalName"],
      status: "verified",
      confidence: "official",
      note: "Exact current manufacturer portfolio identity; generation, powertrain and grade coverage remain pending.",
    })),
    researchNotes,
    updatedAt: VERIFIED_AT,
  };
}

export async function buildBrandLanguageNormalizationBatch() {
  const workspace = await loadWorkspace();
  const brandsById = new Map(workspace.records.brand.map((brand) => [brand.id, brand]));
  const modelsById = new Map(workspace.records.model.map((model) => [model.id, model]));

  const chery = addAliases(brandsById.get("chery"), [
    { value: "Chery Fulwin", kind: "market_name", safe: true, language: "en", market: "China", sourceIds: ["src-chery-fulwin-global-2026", "src-chery-fulwin-china-current"] },
    { value: "Chery Fengyun", kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: ["src-chery-fulwin-global-2026", "src-chery-fulwin-china-current"] },
    { value: "奇瑞风云", kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-chery-fulwin-china-current"] },
  ]);
  const oshan = addAliases(brandsById.get("oshan"), [
    { value: "Changan Oshan", kind: "market_name", safe: true, language: "en", market: "Pakistan", sourceIds: ["src-changan-oshan-pakistan-current"] },
    { value: "Oushan", kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: ["src-changan-oshan-pakistan-current"] },
    { value: "长安欧尚", kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-changan-oshan-pakistan-current"] },
  ]);
  const changanNevo = addAliases(brandsById.get("changan-nevo") || {
    id: "changan-nevo",
    canonicalName: "Changan NEVO",
    slug: "changan-nevo",
    aliases: [],
    countries: ["China"],
    status: "seed",
    evidence: [{
      sourceId: "src-changan-nevo-thailand-2026",
      fields: ["canonicalName", "countries"],
      status: "verified",
      confidence: "official",
      note: "Official CHANGAN source identifies CHANGAN NEVO as a brand launched in Chongqing, China.",
    }],
    researchNotes: ["Authentic source-traced 90 x 60 dark/light logos and full 2020+ China/active-export model, generation and grade coverage remain required."],
    updatedAt: VERIFIED_AT,
  }, [
    { value: "CHANGAN NEVO", kind: "punctuation", safe: true, language: "en", market: "Global", sourceIds: ["src-changan-nevo-thailand-2026", "src-changan-nevo-global-models-2026"] },
    { value: "Changan Qiyuan", kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: ["src-changan-nevo-thailand-2026", "src-changan-qiyuan-china-current"] },
    { value: "长安启源", kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-changan-qiyuan-china-current"] },
  ]);
  const koreanSource = "src-encar-korean-make-selector-2026";
  const localizedBrandUpdates = [
    addAliases(brandsById.get("kia"), [{ value: "기아", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("hyundai"), [{ value: "현대", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("genesis"), [{ value: "제네시스", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("jeep"), [{ value: "지프", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("porsche"), [{ value: "포르쉐", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("mini"), [{ value: "미니", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("mercedes-benz"), [{ value: "벤츠", kind: "source_spelling", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("audi"), [{ value: "아우디", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("ford"), [{ value: "포드", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource] }]),
    addAliases(brandsById.get("kgm"), [
      { value: "KG모빌리티(쌍용)", kind: "source_spelling", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource, "src-kgm-actyon-global-2024"] },
      { value: "KG모빌리티", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource, "src-kgm-actyon-global-2024"] },
      { value: "쌍용", kind: "historical", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource, "src-kgm-actyon-global-2024"] },
    ]),
    addAliases(brandsById.get("renault-samsung"), [
      { value: "Renault Korea", kind: "market_name", safe: true, language: "en", market: "South Korea", sourceIds: ["src-renault-korea-about-current"] },
      { value: "르노코리아(삼성)", kind: "source_spelling", safe: true, language: "ko", market: "South Korea", sourceIds: [koreanSource, "src-renault-korea-about-current"] },
      { value: "르노코리아", kind: "localized", safe: true, language: "ko", market: "South Korea", sourceIds: ["src-renault-korea-about-current"] },
    ]),
    addAliases(brandsById.get("geely"), [{ value: "Geely Auto", kind: "source_spelling", safe: true, language: "en", market: "Global", sourceIds: ["src-geely-company-global"] }]),
  ];

  const models = [];
  for (const [slug, canonicalName, shortName, localizedName] of CHANGAN_NEVO_MODELS) {
    const id = `changan-nevo/${slug}`;
    models.push(modelsById.get(id) || exactModel({
      id,
      brandId: "changan-nevo",
      canonicalName,
      sourceNames: [
        { value: shortName, kind: "market_name", safe: true, language: "en", market: "Global", sourceIds: ["src-changan-nevo-global-models-2026", "src-changan-qiyuan-china-current"] },
        { value: localizedName, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-changan-qiyuan-china-current"] },
      ],
      sourceIds: ["src-changan-qiyuan-china-current"],
    }));
  }
  for (const [slug, canonicalName, shortName, localizedName] of CHERY_FULWIN_MODELS) {
    const id = `chery/fulwin-${slug}`;
    const sourceNames = [
      { value: shortName, kind: "market_name", safe: true, language: "en", market: "China", sourceIds: ["src-chery-fulwin-china-current"] },
      { value: localizedName, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-chery-fulwin-china-current"] },
      { value: `Fengyun ${shortName}`, kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: ["src-chery-fulwin-global-2026", "src-chery-fulwin-china-current"] },
    ];
    if (slug === "t9") sourceNames.push(
      { value: "T9 Long Range", kind: "market_name", safe: true, language: "en", market: "China", sourceIds: ["src-chery-fulwin-china-current"] },
      { value: "T9长续航", kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: ["src-chery-fulwin-china-current"] },
    );
    models.push(modelsById.get(id) || exactModel({
      id,
      brandId: "chery",
      canonicalName,
      sourceNames,
      sourceIds: ["src-chery-fulwin-global-2026", "src-chery-fulwin-china-current"],
      researchNotes: slug === "t9" ? ["The official T9 Long Range/T9长续航 listing is retained as a T9 market alias, not inflated into a separate model."] : [],
    }));
  }
  const oshanX7 = modelsById.get("oshan/x7") || {
    ...exactModel({
      id: "oshan/x7",
      brandId: "oshan",
      canonicalName: "X7",
      sourceNames: [
        { value: "Oshan X7", kind: "market_name", safe: true, language: "en", market: "Pakistan", sourceIds: ["src-changan-oshan-pakistan-current"] },
        { value: "Changan Oshan X7", kind: "market_name", safe: true, language: "en", market: "Pakistan", sourceIds: ["src-changan-oshan-pakistan-current"] },
      ],
      sourceIds: ["src-changan-oshan-pakistan-current"],
    }),
    bodyTypes: ["SUV"],
    powertrainKinds: ["ICE"],
    evidence: [{
      sourceId: "src-changan-oshan-pakistan-current",
      fields: ["canonicalName", "bodyTypes", "powertrainKinds"],
      status: "verified",
      confidence: "high",
      note: "Authorized Changan market specifications identify Oshan X7 as a gasoline SUV.",
    }],
  };
  models.push(oshanX7);
  const media = ["dark", "light"].map((theme) => ({
    id: `brand-logo/changan-nevo/${theme}`,
    ownerType: "brand",
    ownerId: "changan-nevo",
    role: "brand_logo",
    sourceId: "src-changan-nevo-official-logo-2026",
    originalUrl: "https://www.changan.co.th/images/nevo/logo-nevo.svg",
    pageUrl: "https://www.changan.co.th/en/about-nevo/",
    license: "Trademark asset; publication rights review required",
    attribution: "Official CHANGAN NEVO logo; trademark belongs to Changan Automobile",
    identityStatus: "exact_brand",
    theme,
    assetPath: `assets/brand-logos/${theme}/changan-nevo.png`,
    widthPx: 90,
    heightPx: 60,
    sha256: NEVO_LOGO_SHA256,
    rightsStatus: "review_required",
    status: "review",
    verifiedAt: VERIFIED_AT,
  }));

  const canonicalScriptViolations = workspace.records.brand
    .filter((brand) => /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(brand.canonicalName))
    .map((brand) => ({ brandId: brand.id, canonicalName: brand.canonicalName }));
  const report = {
    schemaVersion: 2,
    generatedAt: VERIFIED_AT,
    productionConnected: false,
    policy: {
      canonicalBrandName: "Stable public English/Latin identity",
      localizedNames: "Proven localized, transliterated and source-market names remain aliases",
      distinctSubBrands: "Never merge a real sub-brand merely because the parent name appears in a source spelling",
      productLines: "Do not inflate a manufacturer-declared model line into a duplicate vehicle marque",
    },
    totals: {
      brandsAdded: 1,
      brandsUpdated: 2 + localizedBrandUpdates.length,
      modelsAdded: 16,
      parserRawMakeAliasesStaged: 12,
      technicalLogoPairsAdded: 1,
      canonicalScriptViolations: canonicalScriptViolations.length,
      explicitlyExcludedNonPassengerCandidates: 1,
    },
    decisions: [
      { sourceIdentity: "Changan Qiyuan / 长安启源", canonicalBrandId: "changan-nevo", canonicalName: "Changan NEVO", decision: "separate-brand-with-localized-aliases" },
      { sourceIdentity: "Chery Fengyun / 奇瑞风云 / Chery Fulwin", canonicalBrandId: "chery", canonicalName: "Chery", decision: "manufacturer-product-line-aliases; models stored as Fulwin model family" },
      { sourceIdentity: "Changan Oshan / Oushan / 长安欧尚", canonicalBrandId: "oshan", canonicalName: "Oshan", decision: "distinct-market-brand-with-source-aliases" },
      { sourceIdentity: "CAN AM", canonicalBrandId: null, canonicalName: null, decision: "excluded-from-passenger-light-passenger-denominator; official range is motorcycles and three-wheel vehicles" },
    ],
    parserAliasDecisions: [
      ["기아", "kia", "Kia"], ["현대", "hyundai", "Hyundai"], ["제네시스", "genesis", "Genesis"],
      ["지프", "jeep", "Jeep"], ["포르쉐", "porsche", "Porsche"], ["미니", "mini", "MINI"],
      ["벤츠", "mercedes-benz", "Mercedes-Benz"], ["아우디", "audi", "Audi"], ["포드", "ford", "Ford"],
      ["KG모빌리티(쌍용)", "kgm", "KGM"], ["르노코리아(삼성)", "renault-samsung", "Renault Samsung"],
      ["Geely Auto", "geely", "Geely"],
    ].map(([sourceIdentity, canonicalBrandId, canonicalName]) => ({ sourceIdentity, canonicalBrandId, canonicalName })),
    canonicalScriptViolations,
    stagedModelIds: models.map((model) => model.id).sort(),
    uiObservation: "A wordmark inside a logo and the adjacent accessible brand label may repeat visually without representing duplicate database entities; that presentation issue is outside this isolated V2 task.",
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunk("source", SOURCES),
        ...chunk("brand", [changanNevo, chery, oshan, ...localizedBrandUpdates].sort((left, right) => left.id.localeCompare(right.id, "en"))),
        ...chunk("model", models.sort((left, right) => left.id.localeCompare(right.id, "en"))),
        ...chunk("media", media),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildBrandLanguageNormalizationBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ reportFile: REPORT_FILE, ingestFile: INGEST_FILE, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
