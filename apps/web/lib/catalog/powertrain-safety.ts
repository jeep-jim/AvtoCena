import type { VehicleOffer } from "./types";

const HYBRID_PRIMARY_RE = /series[ -]?hybrid|range[ -]?extender|\b(?:reev|erev|phev|hev|mhev)\b|plug[ -]?in|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|混合动力|增程|하이브리드/i;
const COMBUSTION_FUELS = new Set(["petrol", "diesel", "lpg", "gasoline", "benzin"]);

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * A listing's raw payload can contain unrelated words or numbers in image paths,
 * recommendation blocks or surrounding page markup. Source-explicit powertrain
 * semantics win over such fallback enrichment.
 */
export function preferExplicitCombustionPowertrain<T extends Partial<VehicleOffer>>(input: T): T {
  const fuel = String(input.fuel || "").trim().toLocaleLowerCase("en-US");
  const engineCc = positive(input.engineCc);

  // A pure EV cannot have combustion-engine displacement. If a broad raw-payload
  // fallback inferred one, remove it before customs so an unrelated value such as
  // 3000 cannot move the vehicle into an ICE duty/utilization band.
  if ((input.powertrainKind === "electric" || fuel === "electric") && engineCc) {
    return {
      ...input,
      engineCc: undefined,
      icePowerKw: undefined,
      operational: {
        ...input.operational,
        raw: {
          ...(typeof input.operational?.raw === "object" && input.operational.raw ? input.operational.raw as object : {}),
          powertrainSafety: {
            correctedTo: "electric",
            reason: "electric_powertrain_cannot_have_engine_displacement",
            removedEngineCc: engineCc,
          },
        },
      },
    } as T;
  }

  const primary = [input.make, input.model, input.generation, input.trim, input.engineType, input.fuel]
    .filter(Boolean)
    .join(" ");
  if (!engineCc || !COMBUSTION_FUELS.has(fuel) || HYBRID_PRIMARY_RE.test(primary)) return input;

  const powerKw = positive(input.icePowerKw) || positive(input.powerKw)
    || (positive(input.powerHp) ? Math.round((Number(input.powerHp) / 1.35962) * 100) / 100 : undefined);
  return {
    ...input,
    powertrainKind: "combustion",
    icePowerKw: positive(input.icePowerKw) || powerKw,
    power30MinKw: undefined,
    power30MinKwByMotor: undefined,
    utilizationPowerKw: powerKw,
    operational: {
      ...input.operational,
      raw: {
        ...(typeof input.operational?.raw === "object" && input.operational.raw ? input.operational.raw as object : {}),
        powertrainSafety: {
          correctedTo: "combustion",
          reason: "explicit_combustion_fuel_and_engine",
        },
      },
    },
  } as T;
}
