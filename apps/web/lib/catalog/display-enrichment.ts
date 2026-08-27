import { applyEncyclopediaDisplayIdentity } from "./display-identity";
import { applyActiveBusinessPricing } from "./live-business-pricing";
import { calculateOfferWithRussiaCustoms } from "./customs-pricing";
import type { VehicleOffer } from "./types";
import {
  findVehicleModel,
  readVehicleKnowledgeVariants,
  vehicleKnowledgeToken,
} from "./vehicle-knowledge";
import { enrichOfferWithKnowledgeCore } from "./knowledge-core";

function meaningful(value: unknown) {
  const text = String(value || "").trim();
  return text && !/^(unknown|неизвестно|не указан[ао]?|уточняется)$/i.test(text) ? text : undefined;
}

function positive(value: unknown, max = 10_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : undefined;
}

function consensus<T>(values: T[]) {
  const unique = [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
  return unique.length === 1 ? unique[0] : undefined;
}

function activeForYear(variant: any, year: number) {
  if (variant.active === false) return false;
  if (variant.yearFrom && year && year < variant.yearFrom) return false;
  if (variant.yearTo && year && year > variant.yearTo) return false;
  return true;
}

function inferPowertrain(text: string) {
  if (/\b(?:phev|plug[ -]?in|подзаряжаем)/i.test(text)) return "other_hybrid" as const;
  if (/\b(?:hybrid|hev|гибрид)/i.test(text)) return "other_hybrid" as const;
  if (/\b(?:bev|electric|электро|электромоб|e[- ]?drive|edrive|leaf|ariya|model\s*[3syx])\b/i.test(text)) return "electric" as const;
  return undefined;
}

function inferTransmission(text: string, electric: boolean) {
  if (electric) return "automatic";
  if (/\b(?:8at|9at|10at|automatic|автомат|steptronic|tiptronic)\b/i.test(text)) return "automatic";
  if (/\b(?:cvt|вариатор|e-cvt)\b/i.test(text)) return "cvt";
  if (/\b(?:dct|dsg|робот)\b/i.test(text)) return "robot";
  if (/\b(?:manual|механика|мкпп|\dmt)\b/i.test(text)) return "manual";
  return undefined;
}

function inferDrive(text: string) {
  if (/\b(?:awd|4wd|xdrive|quattro|4matic|e-4orce|полный привод)\b/i.test(text)) return "awd";
  if (/\b(?:fwd|передний привод)\b/i.test(text)) return "fwd";
  if (/\b(?:rwd|задний привод)\b/i.test(text)) return "rwd";
  if (/\bbmw\s+i3\s+edrive\s*40l\b/i.test(text)) return "rwd";
  return undefined;
}

function pricingSpecificationSignature(offer: Partial<VehicleOffer>) {
  return JSON.stringify({
    engineCc: positive(offer.engineCc),
    powerHp: positive(offer.powerHp),
    powerKw: positive(offer.powerKw),
    icePowerKw: positive(offer.icePowerKw),
    power30MinKw: positive(offer.power30MinKw),
    power30MinKwByMotor: Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor.map(Number) : [],
    utilizationPowerKw: positive(offer.utilizationPowerKw),
    powertrainKind: meaningful(offer.powertrainKind),
    powerDataSource: meaningful(offer.powerDataSource),
  });
}

export function catalogPricingSpecificationsChanged(before: Partial<VehicleOffer>, after: Partial<VehicleOffer>) {
  return pricingSpecificationSignature(before) !== pricingSpecificationSignature(after);
}

export async function enrichOfferForDisplay<T extends VehicleOffer>(input: T): Promise<T> {
  const enriched = await enrichOfferWithKnowledgeCore(input);
  const match = await findVehicleModel(enriched);
  const year = Number(enriched.year || 0);
  const variants = match
    ? (await readVehicleKnowledgeVariants()).filter((variant) => variant.modelId === match.model.id && activeForYear(variant, year))
    : [];
  const text = vehicleKnowledgeToken([
    enriched.make,
    enriched.model,
    enriched.generation,
    enriched.trim,
    enriched.engineType,
    (enriched.operational as any)?.raw?.title,
    (enriched.operational as any)?.raw?.name,
  ].filter(Boolean).join(" "));

  const consensusPowertrain = consensus(variants.map((variant) => variant.powertrainKind));
  const powertrainKind = enriched.powertrainKind && enriched.powertrainKind !== "unknown"
    ? enriched.powertrainKind
    : consensusPowertrain || inferPowertrain(text) || enriched.powertrainKind;
  const electric = powertrainKind === "electric";

  const engineCc = positive(enriched.engineCc)
    || positive(consensus(variants.map((variant) => variant.engineCc)));
  const fuel = meaningful(enriched.fuel)
    || meaningful(consensus(variants.map((variant) => variant.fuel)))
    || (electric ? "electric" : powertrainKind && powertrainKind !== "combustion" ? "hybrid" : undefined);
  const transmission = meaningful(enriched.transmission)
    || meaningful(consensus(variants.map((variant) => variant.transmission)))
    || inferTransmission(text, electric);
  const drive = meaningful(enriched.drive)
    || meaningful(consensus(variants.map((variant) => variant.drive)))
    || inferDrive(text);
  const bodyType = meaningful(enriched.bodyType)
    || meaningful(consensus(variants.map((variant) => variant.bodyType)))
    || match?.model.bodyTypes?.[0];

  const displayEnriched = {
    ...enriched,
    engineCc: electric ? undefined : engineCc || enriched.engineCc,
    fuel: fuel || enriched.fuel,
    transmission: transmission || enriched.transmission,
    drive: drive || enriched.drive,
    bodyType: bodyType || enriched.bodyType,
    powertrainKind,
    operational: {
      ...enriched.operational,
      raw: {
        ...(typeof enriched.operational?.raw === "object" && enriched.operational.raw ? enriched.operational.raw as object : {}),
        displayKnowledgeEnriched: true,
      },
    },
  } as T;

  // Saved market pricing still wins at render time. Canonical public identity is
  // applied last so offer pages use exactly the same make/model labels as cards,
  // facets and SEO read models without touching source/raw identity or pricing.
  const pricingSpecificationsChanged = catalogPricingSpecificationsChanged(input, displayEnriched);
  const priced = pricingSpecificationsChanged && String(displayEnriched.market || "") !== "japan"
    ? await calculateOfferWithRussiaCustoms(displayEnriched)
    : await applyActiveBusinessPricing(displayEnriched);
  return await applyEncyclopediaDisplayIdentity(priced) as T;
}
