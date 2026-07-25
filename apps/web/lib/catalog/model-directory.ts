import { cache } from "react";
import { canonicalCatalogBrand, catalogBrandSlug } from "./brands";
import { isCrediblePublicOffer } from "./offer-quality";
import { PUBLIC_CATALOG_MARKETS } from "./runtime-config";
import { readMarketOffers } from "./storage";
import {
  findVehicleModel,
  readVehicleKnowledgeModels,
  vehicleKnowledgeCompact,
  type VehicleKnowledgeModel,
} from "./vehicle-knowledge";

export type CatalogModelDirectoryItem = VehicleKnowledgeModel & {
  slug: string;
  count: number;
  marketCounts: Record<string, number>;
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

export function catalogModelSlug(model: Pick<VehicleKnowledgeModel, "id" | "model">) {
  const idTail = String(model.id || "").split("/").slice(1).join("/");
  return slugify(idTail || model.model);
}

function modelKey(make: unknown, model: unknown) {
  return `${vehicleKnowledgeCompact(canonicalCatalogBrand(clean(make)))}:${vehicleKnowledgeCompact(model)}`;
}

const readLiveOffers = cache(async () => {
  const rows = (await Promise.all(PUBLIC_CATALOG_MARKETS.map((market) => readMarketOffers(market)))).flat();
  return rows.filter((offer) => isCrediblePublicOffer(offer));
});

export const readBrandModelDirectory = cache(async (rawMake: string): Promise<CatalogModelDirectoryItem[]> => {
  const make = canonicalCatalogBrand(rawMake);
  const [knowledge, offers] = await Promise.all([
    readVehicleKnowledgeModels(),
    readLiveOffers(),
  ]);

  const models = knowledge.filter((model) => model.active !== false
    && canonicalCatalogBrand(model.make) === make);
  const modelByKey = new Map(models.map((model) => [modelKey(make, model.model), model]));
  const counters = new Map<string, { count: number; marketCounts: Record<string, number> }>();
  const brandOffers = offers.filter((offer) => canonicalCatalogBrand(offer.make) === make);
  const matches = await Promise.all(brandOffers.map(async (offer) => ({
    offer,
    match: await findVehicleModel(offer),
  })));

  for (const { offer, match } of matches) {
    const recognized = match && canonicalCatalogBrand(match.model.make) === make
      ? match.model
      : modelByKey.get(modelKey(make, offer.model));
    if (!recognized) continue;
    const current = counters.get(recognized.id) || { count: 0, marketCounts: {} };
    current.count += 1;
    current.marketCounts[offer.market] = (current.marketCounts[offer.market] || 0) + 1;
    counters.set(recognized.id, current);
  }

  return models
    .map((model) => {
      const count = counters.get(model.id) || { count: 0, marketCounts: {} };
      return {
        ...model,
        make,
        slug: catalogModelSlug(model),
        count: count.count,
        marketCounts: count.marketCounts,
      };
    })
    .sort((left, right) => Number(right.count > 0) - Number(left.count > 0)
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
