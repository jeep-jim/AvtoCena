import { KCarStrictAdapterV2 } from "./kcar-strict-source-v2";
import type { VehicleOffer } from "./types";

function sourceFuelKind(value: unknown, engineCc: unknown) {
  const fuel = String(value ?? "").replace(/\s+/g, " ").trim();
  const hasEngine = Number(engineCc || 0) > 0;
  if (/전기/.test(fuel) && hasEngine) return "hybrid";
  if (/전기/.test(fuel) && !hasEngine) return "electric";
  return fuel;
}

export class KCarStrictAdapterV3 extends KCarStrictAdapterV2 {
  override normalizeOffer(raw: unknown): VehicleOffer | null {
    if (!raw || typeof raw !== "object") return super.normalizeOffer(raw);
    const row = { ...(raw as Record<string, unknown>) };
    row.fuel = sourceFuelKind(row.fuel, row.engineCc);
    return super.normalizeOffer(row);
  }
}

export const kcarKoreaStrictSourceV3 = new KCarStrictAdapterV3();
