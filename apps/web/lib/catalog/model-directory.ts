import { cache } from "react";
import { canonicalCatalogBrand, catalogBrandSlug } from "./brands";
import { readEncyclopediaKnowledgeVariants } from "./encyclopedia";
import { readVehiclePowerKnowledge } from "./power-knowledge";
import { readCatalogBrandModelCounts } from "./storage";
import {
  readVehicleKnowledgeModels,
  vehicleKnowledgeCompact,
  type VehicleKnowledgeModel,
} from "./vehicle-knowledge";

export type CatalogNumericRange = { min: number; max: number; count: number };
export type CatalogModelKnowledgeSummary = {
  records: number;
  variants: number;
  references: number;
  powerHp?: CatalogNumericRange;
  powerKw?: CatalogNumericRange;
  power30MinKw?: CatalogNumericRange;
  utilizationPowerKw?: CatalogNumericRange;
  engineCc?: CatalogNumericRange;
  fuels: string[];
  powertrains: string[];
};

export type CatalogModelDirectoryItem = VehicleKnowledgeModel & {
  slug: string;
  count: number;
  marketCounts: Record<string, number>;
  knowledge: CatalogModelKnowledgeSummary;
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value: unknown) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "model";
}

function positive(value: unknown, max = 10_000) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : undefined;
}

function range(values: unknown[], max = 10_000): CatalogNumericRange | undefined {
  const numbers = [...new Set(values.map((value) => positive(value, max)).filter((value): value is number => Boolean(value)).map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
  return numbers.length ? { min: numbers[0], max: numbers[numbers.length - 1], count: numbers.length } : undefined;
}

function unique(values: unknown[]) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
}

function modelKey(make: unknown, model: unknown) {
  return `${vehicleKnowledgeCompact(canonicalCatalogBrand(clean(make)))}:${vehicleKnowledgeCompact(model)}`;
}

function thirtyMinutePower(row: { power30MinKw?: number; power30MinKwByMotor?: number[] }) {
  const direct = positive(row.power30MinKw, 4_000);
  if (direct) return direct;
  const motors = (row.power30MinKwByMotor || []).map((value) => positive(value, 2_000)).filter((value): value is number => Boolean(value));
  return motors.length ? Math.round(motors.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined;
}

export function catalogModelSlug(model: Pick<VehicleKnowledgeModel, "id" | "model">) {
  const idTail = String(model.id || "").split("/").slice(1).join("/");
  return slugify(idTail || model.model);
}

const readKnowledge = cache(async () => {
  const [models, variants, references] = await Promise.all([
    readVehicleKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
    readVehiclePowerKnowledge(),
  ]);
  return { models, variants, references };
});

function summarizeModel(model: VehicleKnowledgeModel, variants: any[], references: any[]): CatalogModelKnowledgeSummary {
  const rows = [...variants, ...references];
  const hp = rows.map((row) => row.powerHp);
  if (model.representativePowerHp) hp.push(model.representativePowerHp);
  return {
    records: rows.length,
    variants: variants.length,
    references: references.length,
    powerHp: range(hp, 2_500),
    powerKw: range(rows.map((row) => row.powerKw || (positive(row.powerHp, 2_500) ? Number(row.powerHp) / 1.35962 : undefined)), 4_000),
    power30MinKw: range(rows.map(thirtyMinutePower), 4_000),
    utilizationPowerKw: range(rows.map((row) => row.utilizationPowerKw), 4_000),
    engineCc: range(rows.map((row) => row.engineCc), 20_000),
    fuels: unique(rows.map((row) => row.fuel)),
    powertrains: unique(rows.map((row) => row.powertrainKind)),
  };
}

export const readBrandModelDirectory = cache(async (rawMake: string): Promise<CatalogModelDirectoryItem[]> => {
  const make = canonicalCatalogBrand(rawMake);
  const [{ models: knowledge, variants, references }, live] = await Promise.all([readKnowledge(), readCatalogBrandModelCounts(make)]);
  const models = knowledge.filter((model) => model.active !== false && canonicalCatalogBrand(model.make) === make);
  const variantsByModel = new Map<string, any[]>();
  for (const row of variants.filter((item) => item.active !== false)) {
    const list = variantsByModel.get(row.modelId) || [];
    list.push(row);
    variantsByModel.set(row.modelId, list);
  }
  const referencesByModel = new Map<string, any[]>();
  for (const row of references.filter((item) => item.active !== false && canonicalCatalogBrand(item.make) === make)) {
    const key = modelKey(make, row.model);
    const list = referencesByModel.get(key) || [];
    list.push(row);
    referencesByModel.set(key, list);
  }
  const modelByAlias = new Map<string, VehicleKnowledgeModel | null>();
  for (const model of models) {
    for (const value of [model.model, ...(model.aliases || [])]) {
      const key = vehicleKnowledgeCompact(value);
      if (!key) continue;
      const current = modelByAlias.get(key);
      if (current && current.id !== model.id) modelByAlias.set(key, null);
      else if (current === undefined) modelByAlias.set(key, model);
    }
  }
  const counters = new Map<string, { count: number; marketCounts: Record<string, number> }>();
  for (const item of live.models) {
    const recognized = modelByAlias.get(vehicleKnowledgeCompact(item.model));
    if (!recognized) continue;
    counters.set(recognized.id, { count: item.count, marketCounts: item.marketCounts });
  }

  return models.map((model) => {
    const count = counters.get(model.id) || { count: 0, marketCounts: {} };
    const modelVariants = variantsByModel.get(model.id) || [];
    const modelReferences = referencesByModel.get(modelKey(make, model.model)) || [];
    return {
      ...model,
      make,
      slug: catalogModelSlug(model),
      count: count.count,
      marketCounts: count.marketCounts,
      knowledge: summarizeModel(model, modelVariants, modelReferences),
    };
  }).sort((left, right) => Number(right.count > 0) - Number(left.count > 0)
    || right.count - left.count
    || Number(left.popularityDecile || 10) - Number(right.popularityDecile || 10)
    || left.model.localeCompare(right.model, "ru"));
});

export const findBrandModelBySlug = cache(async (rawMake: string, rawSlug: string) => {
  const requested = slugify(rawSlug);
  const models = await readBrandModelDirectory(rawMake);
  return models.find((model) => model.slug === requested
    || slugify(model.model) === requested
    || (model.aliases || []).some((alias) => slugify(alias) === requested)) || null;
});

export const readAllModelSeoLinks = cache(async () => {
  const models = (await readVehicleKnowledgeModels()).filter((model) => model.active !== false);
  return models.map((model) => ({
    make: canonicalCatalogBrand(model.make),
    brandSlug: catalogBrandSlug(model.make),
    model: model.model,
    modelSlug: catalogModelSlug(model),
    updatedAt: model.updatedAt,
  }));
});

// Production catalog restart marker: 2026-07-29T13:27:00Z
