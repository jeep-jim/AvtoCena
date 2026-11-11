import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-current-edition-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-current-edition-aliases-2026-08-17.json");

const DEFINITIONS = [
  { modelId: "wuling/hongguang", value: "五菱 宏光纯电版", sourceId: "src-sgmw-wuling-hongguang-bev-spec" },
  { modelId: "wuling/hongguang", value: "五菱 宏光增程版", sourceId: "src-sgmw-wuling-hongguang-erev-spec" },
  { modelId: "wuling/bingo-plus", value: "五菱 缤果SUV五座版", sourceId: "src-sgmw-wuling-bingo-suv-five-seat-launch-2024" },
  { modelId: "wuling/zhiguang", value: "五菱 之光EV", sourceId: "src-sgmw-wuling-zhiguang-ev-spec" },
];

function alias(definition) {
  return { value: definition.value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [definition.sourceId] };
}

export async function buildWulingCurrentEditionAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const modelsById = new Map(workspace.records.model.map((record) => [record.id, record]));
  const grouped = new Map();
  for (const definition of DEFINITIONS) {
    if (!modelsById.has(definition.modelId)) throw new Error(`${definition.modelId} is missing`);
    const values = grouped.get(definition.modelId) || [];
    values.push(definition);
    grouped.set(definition.modelId, values);
  }

  const replacements = [...grouped].map(([modelId, definitions]) => {
    const current = modelsById.get(modelId);
    const sourceNames = [...(current.sourceNames || [])];
    for (const definition of definitions) {
      if (!sourceNames.some((item) => item.value === definition.value)) sourceNames.push(alias(definition));
    }
    return {
      ...current,
      sourceNames,
      researchNotes: [...(current.researchNotes || []), "Current full Chinese edition titles are retained as source-backed aliases of one English canonical model, never as duplicate models."],
      updatedAt: verifiedAt,
    };
  });

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { replacedModels: replacements.length, newAliases: DEFINITIONS.length },
    aliases: DEFINITIONS,
    policy: {
      oneEnglishCanonicalModel: true,
      localizedEditionNamesAreAliases: true,
      duplicateModelsCreated: false,
      automaticPublicationReady: false,
    },
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [{ schemaVersion: 2, entityType: "model", chunk: 1, maxRecords: 250, records: replacements }],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildWulingCurrentEditionAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
