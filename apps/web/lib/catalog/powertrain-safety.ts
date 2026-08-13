import type { VehicleOffer } from "./types";

const HYBRID_PRIMARY_RE = /series[ -]?hybrid|range[ -]?extender|\b(?:reev|erev|phev|hev|mhev)\b|plug[ -]?in|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|混合动力|增程|하이브리드/i;
const COMBUSTION_FUELS = new Set(["petrol", "diesel", "lpg", "gasoline", "benzin"]);

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * A listing's raw payload can contain unrelated words such as "hybrid" in image paths,
 * recommendation blocks or surrounding page markup. An explicit combustion fuel plus a
 * real engine displacement wins unless the vehicle's own title/specification says hybrid.
 *
 * Pure EVs can never have an ICE displacement. Some broad legacy payloads contained
 * unrelated displacement-like numbers; fail closed by clearing them before customs.
 */
export function preferExplicitCombustionPowertrain<T extends Partial<VehicleOffer>>(input: T): T {
  const fuel = String(input.fuel || "").trim().toLocaleLowerCase("en-US");
  const kind = String(input.powertrainKind || "").trim();
  const engineCc = positive(input.engineCc);

  if ((kind === "electric" || fuel === "electric") && engineCc) {
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
            reason: "pure_ev_cannot_have_engine_displacement",
            rejectedEngineCc: engineCc,
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
