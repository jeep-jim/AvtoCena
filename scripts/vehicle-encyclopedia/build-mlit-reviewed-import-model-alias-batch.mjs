import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-mlit-reviewed-import-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-mlit-reviewed-import-aliases-2026-08-17.json");

const REVIEWED_IDENTITIES = [
  { modelId: "lexus/ct", names: ["CT200h"] },
  { modelId: "lexus/es", names: ["ES300h", "ES350h"] },
  { modelId: "lexus/gs", names: ["GS200t", "GS250", "GS300", "GS300h", "GS350", "GS450h"] },
  { modelId: "lexus/gs-f", names: ["GS F"] },
  { modelId: "lexus/gx", names: ["GX550"] },
  { modelId: "lexus/hs", names: ["HS250h"] },
  { modelId: "lexus/is", names: ["IS200t", "IS250", "IS300", "IS300h", "IS350", "IS500"] },
  { modelId: "lexus/lbx", names: ["LBX"] },
  { modelId: "lexus/lc", names: ["LC500", "LC500h"] },
  { modelId: "lexus/lm", names: ["LM350h", "LM500h"] },
  { modelId: "lexus/ls", names: ["LS460", "LS460L", "LS500", "LS500h", "LS600h", "LS600hL"] },
  { modelId: "lexus/lx", names: ["LX570", "LX600", "LX700h"] },
  { modelId: "lexus/nx", names: ["NX200t", "NX250", "NX300", "NX300h", "NX350", "NX350h"] },
  { modelId: "lexus/rc", names: ["RC200t", "RC300", "RC300h", "RC350"] },
  { modelId: "lexus/rc-f", names: ["RC F"] },
  { modelId: "lexus/rx", names: ["RX200t", "RX270", "RX300", "RX350", "RX350h", "RX450h", "RX450hL", "RX500h"] },
  { modelId: "lexus/ux", names: ["UX200", "UX250h", "UX300h"] },

  { modelId: "land-rover/defender", names: ["DEFENDER 110", "ディフェンダー110 (エアサスペンション)", "ディフェンダー110 (コイルサスペンション)", "ディフェンダー130", "ディフェンダー130 / ディフェンダー130 Outbound", "ディフェンダー90 (エアサスペンション)", "ディフェンダー90 (コイルサスペンション)", "ディフェンダー Trophy Edition"] },
  { modelId: "land-rover/discovery", names: ["ディスカバリー", "ディスカバリー4", "ニューディスカバリー"] },
  { modelId: "land-rover/discovery-sport", names: ["ディスカバリー スポーツ", "ディスカバリースポーツ"] },
  { modelId: "land-rover/freelander-2", names: ["フリーランダー 2"] },
  { modelId: "land-rover/range-rover", names: ["レンジローバー", "レンジローバー 280kW仕様", "レンジローバーLWB", "レンジローバー VOGUE ロングホイールベース、280kW仕様", "レンジローバー ロングホイールベース", "レンジローバー ロングホイールベース 405kW仕様"] },
  { modelId: "land-rover/range-rover-evoque", names: ["レンジローバーEvoque", "レンジローバーEvoque Convertible", "レンジローバーイヴォーク"] },
  { modelId: "land-rover/range-rover-sport", names: ["レンジローバー スポーツ", "レンジローバースポーツ", "レンジローバー スポーツ HST 280kW仕様", "レンジローバー スポーツ SVR"] },
  { modelId: "land-rover/range-rover-velar", names: ["レンジローバーベラール", "レンジローバーベラール (エアサスペンション)", "レンジローバーベラール (コイルサスペンション)", "レンジローバーヴェラール", "レンジローバーヴェラール (エアサスペンション)", "レンジローバーヴェラール (コイルサスペンション)"] },

  { modelId: "volvo/s60", names: ["ボルボ S60", "ボルボS60"] },
  { modelId: "volvo/s80", names: ["ボルボS80"] },
  { modelId: "volvo/s90", names: ["ボルボ S90", "ボルボS90"] },
  { modelId: "volvo/v40", names: ["ボルボV40"] },
  { modelId: "volvo/v40-cross-country", names: ["ボルボV40クロスカントリー"] },
  { modelId: "volvo/v60", names: ["ボルボ V60", "ボルボV60"] },
  { modelId: "volvo/v60-cross-country", names: ["ボルボ V60クロスカントリー", "ボルボV60クロスカントリー"] },
  { modelId: "volvo/v70", names: ["ボルボV70"] },
  { modelId: "volvo/v90", names: ["ボルボ V90", "ボルボV90"] },
  { modelId: "volvo/v90-cross-country", names: ["ボルボ V90クロスカントリー", "ボルボV90クロスカントリー"] },
  { modelId: "volvo/xc40", names: ["ボルボ XC40", "ボルボXC40"] },
  { modelId: "volvo/xc60", names: ["ボルボ XC60", "ボルボXC60"] },
  { modelId: "volvo/xc70", names: ["ボルボXC70"] },
  { modelId: "volvo/xc90", names: ["ボルボ XC90", "ボルボXC90"] },

  { modelId: "jeep/avenger", names: ["アベンジャー 4xe"] },
  { modelId: "jeep/grand-cherokee", names: ["グランド チェロキー"] },
  { modelId: "jeep/commander", names: ["コマンダー"] },
  { modelId: "jeep/compass", names: ["コンパス"] },
  { modelId: "jeep/cherokee", names: ["チェロキー"] },
  { modelId: "jeep/wrangler", names: ["ラングラー"] },
  { modelId: "jeep/wrangler-unlimited", names: ["ラングラー アンリミッテド", "ラングラー アンリミテッド"] },
  { modelId: "jeep/renegade", names: ["レネゲード"] },

  { modelId: "citroen/c3", names: ["C3"] },
  { modelId: "citroen/c3-aircross", names: ["C3 エアクロス", "C3エアクロス"] },
  { modelId: "citroen/c4", names: ["C4"] },
  { modelId: "citroen/c4-spacetourer", names: ["C4 スペースツアラー"] },
  { modelId: "citroen/c4-picasso", names: ["C4 ピカソ"] },
  { modelId: "citroen/c5-aircross", names: ["C5 エアクロス", "C5エアクロス"] },
  { modelId: "citroen/ds4", names: ["DS4"] },
  { modelId: "citroen/ds5", names: ["DS5"] },
  { modelId: "citroen/berlingo", names: ["ベルランゴ"] },

  { modelId: "smart/fortwo", names: ["フォーツー", "フォーツーBRABUS", "フォーツー カブリオ", "フォーツー カブリオ BRABUS", "フォーツー カブリオ ターボ", "フォーツー クーペ", "フォーツー クーペ ターボ", "フォーツー ターボ"] },
  { modelId: "smart/forfour", names: ["フォーフォー", "フォーフォー ターボ"] },
  { modelId: "renault/kangoo", names: ["カングー"] },
  { modelId: "renault/captur", names: ["キャプチャー"] },
  { modelId: "renault/twingo", names: ["トゥインゴ"] },
  { modelId: "renault/clio", names: ["ルーテシア"] },
  { modelId: "abarth/124-spider", names: ["Abarth 124 Spider"] },
  { modelId: "dodge/nitro", names: ["ナイトロ"] },
  { modelId: "peugeot/rifter", names: ["リフター"] },
  { modelId: "alfa-romeo/mito", names: ["MiTo"] },
  { modelId: "alfa-romeo/junior", names: ["ジュニア イブリダ"] },
  { modelId: "alfa-romeo/giulia", names: ["ジュリア"] },
  { modelId: "alfa-romeo/giulietta", names: ["ジュリエッタ"] },
  { modelId: "alfa-romeo/stelvio", names: ["ステルヴィオ"] },
  { modelId: "alfa-romeo/tonale", names: ["トナーレ"] },

  { modelId: "jaguar/e-pace", names: ["E-PACE"] },
  { modelId: "jaguar/f-pace", names: ["F-PACE"] },
  { modelId: "jaguar/f-type", names: ["F-TYPE", "F-TYPE SVR"] },
  { modelId: "jaguar/xe", names: ["XE", "XE AWD"] },
  { modelId: "jaguar/xf", names: ["XF", "XF AWD", "XF Premium Luxury/ XF Portfolio", "XF Sport Brake", "XF Sport brake", "XF Sportbrake", "XF Sport Brake AWD"] },
  { modelId: "jaguar/xfr", names: ["XFR"] },
  { modelId: "jaguar/xj", names: ["XJ Luxury/ Premium Luxury", "XJ Supersport", "XJ Supersport LWB/ XJ Portolio LWB", "XJ Supersport LWB リアビジネスシート仕様"] },
  { modelId: "fiat/500", names: ["500, 500C", "500,500C", "500、 500C"] },
  { modelId: "fiat/500-x", names: ["500X"] },
  { modelId: "fiat/doblo", names: ["ドブロ"] },
  { modelId: "jeep/grand-cherokee", sourceBrandId: "chrysler", names: ["ジープ・グランド チェロキー"] },
  { modelId: "jeep/cherokee", sourceBrandId: "chrysler", names: ["ジープ・チェロキー"] },
  { modelId: "jeep/patriot", sourceBrandId: "chrysler", names: ["ジープ・パトリオット"] },
  { modelId: "jeep/wrangler", sourceBrandId: "chrysler", names: ["ジープ・ラングラー"] },
  { modelId: "jeep/wrangler-unlimited", sourceBrandId: "chrysler", names: ["ジープ・ラングラー アンリミッテド"] },
  { modelId: "jeep/renegade", sourceBrandId: "chrysler", names: ["ジープ・レネゲード"] }
];

const REVIEWED_REJECTIONS = [
  { brandId: "abarth", sourceName: "595、595C", reason: "combined_multi_model_row" },
  { brandId: "abarth", sourceName: "595、595C、695", reason: "combined_multi_model_row" },
  { brandId: "volvo", sourceName: "ボルボV40/V40クロスカントリー", reason: "combined_multi_model_row" },
  { brandId: "volvo", sourceName: "Mini クーパーD クロスオーバー", reason: "wrong_brand_contamination" },
  { brandId: "citroen", sourceName: "Mini クーパーD クロスオーバー", reason: "wrong_brand_contamination" }
  ,{ brandId: "jaguar", sourceName: "Mini クーパーD クロスオーバー", reason: "wrong_brand_contamination" }
  ,{ brandId: "jaguar", sourceName: "XFR/ XF Supercharged", reason: "combined_multi_model_row" }
  ,{ brandId: "jaguar", sourceName: "XJ Supersport/XJR", reason: "combined_multi_model_row" }
];

function mlitSourceId(url) {
  return `src-mlit-passenger-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250)
  }));
}

function language(value) {
  return /^[\x00-\x7F]+$/.test(value) ? "en" : "ja";
}

export async function buildMlitReviewedImportModelAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const sources = new Map();
  const updatedModelById = new Map();
  const accepted = [];

  for (const reviewed of REVIEWED_IDENTITIES) {
    const model = updatedModelById.get(reviewed.modelId) || modelById.get(reviewed.modelId);
    if (!model) throw new Error(`Missing reviewed imported MLIT target ${reviewed.modelId}`);
    const sourceBrandId = reviewed.sourceBrandId || model.brandId;
    const rows = mlit.candidates.filter((candidate) => candidate.brandId === sourceBrandId && candidate.sourceNames.some((name) => reviewed.names.includes(name)));
    const found = new Set(rows.flatMap((candidate) => candidate.sourceNames.filter((name) => reviewed.names.includes(name))));
    const missing = reviewed.names.filter((name) => !found.has(name));
    if (missing.length) throw new Error(`No MLIT source identity for ${reviewed.modelId}: ${missing.join(", ")}`);

    const sourceNames = structuredClone(model.sourceNames || []);
    for (const sourceName of reviewed.names) {
      const matchedRows = rows.filter((candidate) => candidate.sourceNames.includes(sourceName));
      const workbookUrls = [...new Set(matchedRows.flatMap((candidate) => candidate.workbookUrls || []))].sort();
      const sourceIds = workbookUrls.map(mlitSourceId);
      for (const url of workbookUrls) {
        const id = mlitSourceId(url);
        if (existingSourceIds.has(id) || sources.has(id)) continue;
        sources.set(id, {
          id,
          type: "government_registry",
          title: `Japan passenger-car inventory workbook ${path.basename(new URL(url).pathname)}`,
          publisher: "Ministry of Land, Infrastructure, Transport and Tourism of Japan",
          url,
          documentId: path.basename(new URL(url).pathname),
          documentDate: null,
          verifiedAt,
          market: "Japan",
          language: "ja",
          supportedFields: ["canonicalName"],
          confidence: "official",
          status: "active",
          license: null,
          notes: "Official MLIT passenger-car inventory workbook. The exact common name is retained as an observation; grades and technical suffixes are not promoted to separate canonical models."
        });
      }

      const existing = sourceNames.find((row) => normalizeTerm(row.value) === normalizeTerm(sourceName));
      if (existing) {
        existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...sourceIds])].sort();
      } else {
        sourceNames.push({ value: sourceName, kind: "source_spelling", safe: true, language: language(sourceName), market: "Japan", sourceIds });
      }
      accepted.push({
        modelId: reviewed.modelId,
        canonicalName: model.canonicalName,
        sourceBrandId,
        sourceName,
        observedInventoryYears: [...new Set(matchedRows.flatMap((row) => row.observedInventoryYears || []))].sort((left, right) => left - right),
        typeCodes: [...new Set(matchedRows.flatMap((row) => row.typeCodes || []))].sort(),
        sourceIds
      });
    }
    updatedModelById.set(reviewed.modelId, { ...model, sourceNames, updatedAt: verifiedAt });
  }

  const rejected = REVIEWED_REJECTIONS.map((rejection) => {
    const rows = mlit.candidates.filter((candidate) => candidate.brandId === rejection.brandId && candidate.sourceNames.includes(rejection.sourceName));
    if (!rows.length) throw new Error(`Reviewed MLIT rejection disappeared: ${rejection.brandId}/${rejection.sourceName}`);
    return {
      ...rejection,
      observedInventoryYears: [...new Set(rows.flatMap((row) => row.observedInventoryYears || []))].sort((left, right) => left - right),
      typeCodes: [...new Set(rows.flatMap((row) => row.typeCodes || []))].sort()
    };
  });

  const updatedModels = [...updatedModelById.values()].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  accepted.sort((left, right) => left.modelId.localeCompare(right.modelId, "en", { numeric: true }) || left.sourceName.localeCompare(right.sourceName, "ja", { numeric: true }));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactMlitSourceNamesOnly: true,
      manuallyReviewedEnglishCanonicalTarget: true,
      gradeAndPowertrainSuffixesRemainSourceSpellings: true,
      combinedMultiModelRowsRejected: true,
      wrongBrandRowsRejected: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedModels: REVIEWED_IDENTITIES.length,
      updatedModels: updatedModels.length,
      acceptedSourceNames: accepted.length,
      rejectedSourceNames: rejected.length,
      sourcesAdded: sources.size,
      referencedOfficialSources: new Set(accepted.flatMap((row) => row.sourceIds)).size
    },
    accepted,
    rejected
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunk("source", [...sources.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))),
        ...chunk("model", updatedModels)
      ]
    }
  };
}

async function main() {
  const { report, ingestion } = await buildMlitReviewedImportModelAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
