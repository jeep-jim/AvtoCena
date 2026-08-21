import type { PowerDataConfidence, VehicleOffer } from "./types";
import { findVehicleModel, findVehicleVariant } from "./vehicle-knowledge";

const AUTHORITATIVE_VARIANT_TYPES = new Set(["manufacturer", "official_registry", "manual"]);

function positive(value: unknown, max = 2_500) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : 0;
}

export function shouldPreferKnowledgeVariantPower(input: {
  sourcePowerHp?: unknown;
  sourceConfidence?: PowerDataConfidence | string;
  variantPowerHp?: unknown;
  variantSourceType?: string;
}) {
  const source = positive(input.sourcePowerHp);
  const variant = positive(input.variantPowerHp);
  if (!variant) return false;
  if (!source) return true;
  const deltaRatio = Math.abs(source - variant) / Math.max(source, variant);
  if (deltaRatio < 0.12) return false;

  const confidence = String(input.sourceConfidence || "").toLowerCase();
  if (!confidence || confidence === "estimated") return true;
  if (AUTHORITATIVE_VARIANT_TYPES.has(String(input.variantSourceType || ""))) return true;
  return false;
}

/**
 * Existing source power must not permanently win merely because it is non-zero.
 * When an exact year/engine/trim knowledge variant contradicts an unqualified or
 * estimated source value, use the matched variant for calculations and record the
 * conflict. Documented/source_exact values remain authoritative against secondary
 * catalogue/consensus knowledge unless the matched variant itself is an official,
 * manufacturer or curated-manual record.
 */
export async function reconcileOfferPowerWithKnowledge<T extends VehicleOffer>(input: T): Promise<T> {
  const modelMatch = await findVehicleModel(input);
  if (!modelMatch) return input;
  const variant = await findVehicleVariant(modelMatch.model, input);
  if (!variant) return input;

  const sourcePowerHp = positive(input.powerHp);
  const variantPowerHp = positive(variant.powerHp);
  if (!shouldPreferKnowledgeVariantPower({
    sourcePowerHp,
    sourceConfidence: input.powerDataConfidence,
    variantPowerHp,
    variantSourceType: variant.sourceType,
  })) return input;

  const variantPowerKw = positive(variant.powerKw, 2_000)
    || Math.round((variantPowerHp / 1.35962) * 100) / 100;
  const raw = input.operational?.raw && typeof input.operational.raw === "object"
    ? input.operational.raw as Record<string, unknown>
    : {};

  return {
    ...input,
    powerHp: variantPowerHp,
    powerKw: variantPowerKw,
    icePowerKw: positive(variant.icePowerKw, 2_000) || input.icePowerKw,
    power30MinKw: positive(variant.power30MinKw, 2_000) || input.power30MinKw,
    power30MinKwByMotor: variant.power30MinKwByMotor?.length ? variant.power30MinKwByMotor : input.power30MinKwByMotor,
    utilizationPowerKw: positive(variant.utilizationPowerKw, 2_000) || input.utilizationPowerKw,
    powerDataConfidence: "reference",
    powerDataSource: `vehicle-knowledge:${variant.id}`,
    operational: {
      ...(input.operational || {}),
      raw: {
        ...raw,
        powerConflictResolved: {
          sourcePowerHp: sourcePowerHp || null,
          sourceConfidence: input.powerDataConfidence || null,
          knowledgePowerHp: variantPowerHp,
          knowledgeVariantId: variant.id,
          knowledgeSourceType: variant.sourceType,
          resolvedAt: new Date().toISOString(),
        },
      },
    },
  } as T;
}
