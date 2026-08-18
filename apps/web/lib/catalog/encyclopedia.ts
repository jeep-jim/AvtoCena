import { readBundledChunkedDataJson } from "../bundled-data";
import { readVehicleKnowledgeModels, readVehicleKnowledgeVariants, type VehicleKnowledgeVariant } from "./vehicle-knowledge";

const VERIFIED_V2_VARIANTS_PATH = "catalog/vehicle-knowledge/v2-bridge-verified-variants.json";
let encyclopediaVariantCache: Promise<VehicleKnowledgeVariant[]> | null = null;

function appendNewIds<T extends { id: string }>(base: T[], additions: T[]) {
  const ids = new Set(base.map((row) => row.id));
  return [...base, ...additions.filter((row) => row?.id && !ids.has(row.id))];
}

export async function readEncyclopediaKnowledgeVariants() {
  if (!encyclopediaVariantCache) {
    encyclopediaVariantCache = Promise.all([
      readVehicleKnowledgeVariants(),
      readBundledChunkedDataJson<VehicleKnowledgeVariant>(VERIFIED_V2_VARIANTS_PATH, []),
    ]).then(([runtime, verifiedV2]) => appendNewIds(runtime, verifiedV2.filter((row) => row?.id && row?.modelId && Number(row.powerHp) > 0)));
  }
  return encyclopediaVariantCache;
}

export async function readEncyclopediaStats() {
  const [models, variants] = await Promise.all([
    readVehicleKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
  ]);
  return {
    models: models.length,
    specifications: variants.length,
  };
}
