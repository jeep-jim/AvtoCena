import type { VehicleOffer } from "./types";

type ExactRule = {
  chassis: string;
  sourceModel: string;
  model?: string;
  generation?: string;
  powertrainKind: "combustion" | "other_hybrid";
  fuel: "hybrid" | "lpg";
  engineCc: number;
  drive?: "rwd";
  officialSources: string[];
};

const RULES: ExactRule[] = [
  {
    chassis: "AZSH36W",
    sourceModel: "CROWN SPORT",
    generation: "Crown Sport",
    powertrainKind: "other_hybrid",
    fuel: "hybrid",
    engineCc: 2487,
    officialSources: [
      "https://toyota.jp/crownsport/specification/index.html",
      "https://www.mlit.go.jp/jidosha/content/3.1_2023_LD_G_WLTC.xlsx",
    ],
  },
  {
    chassis: "AZSH37W",
    sourceModel: "CROWN SPORT",
    generation: "Crown Sport PHEV",
    powertrainKind: "other_hybrid",
    fuel: "hybrid",
    engineCc: 2487,
    officialSources: ["https://toyota.jp/pages/contents/crownsport/001_p_001/pdf/crownsport_spec_202510.pdf"],
  },
  {
    chassis: "AZSH38W",
    sourceModel: "CROWN ESTATE",
    generation: "Crown Estate",
    powertrainKind: "other_hybrid",
    fuel: "hybrid",
    engineCc: 2487,
    officialSources: [
      "https://toyota.jp/crownestate/index.html",
      "https://www.mlit.go.jp/jidosha/content/001986923.xlsx",
    ],
  },
  {
    chassis: "TSS10",
    sourceModel: "CROWN COMFORT",
    model: "Crown Comfort",
    generation: "TSS10",
    powertrainKind: "combustion",
    fuel: "lpg",
    engineCc: 1998,
    drive: "rwd",
    officialSources: [
      "https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60005626/index.html",
      "https://www.mlit.go.jp/common/001225536.xls",
    ],
  },
];

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Enrich only a detail- and photo-bound Prestige row using an exact Toyota
 * model/chassis pair. The rule intentionally never supplies horsepower or
 * 30-minute motor power: those values require separate exact evidence.
 */
export function applyPrestigeJapanExactIdentityKnowledge<T extends Partial<VehicleOffer>>(input: T): T {
  if (input.sourceId !== "prestige_japan_auctions_open" || input.market !== "japan") return input;
  const raw = typeof input.operational?.raw === "object" && input.operational.raw
    ? input.operational.raw as Record<string, unknown>
    : undefined;
  const fields = raw?.fields && typeof raw.fields === "object"
    ? raw.fields as Record<string, unknown>
    : undefined;
  const identityBound = raw?.detailIdentityVerified === true
    && raw?.photoIdentityVerified === true
    && raw?.listingBoundImages === true
    && raw?.recoveryExactSourceUrl === true
    && raw?.recoveryExactPhotoIdentity === true;
  if (!identityBound || clean(fields?.Make) !== "TOYOTA") return input;

  const sourceModel = clean(fields?.Model);
  const chassis = clean(fields?.Chassis).replace(/[^A-Z0-9]/g, "");
  const rule = RULES.find((candidate) => candidate.sourceModel === sourceModel && candidate.chassis === chassis);
  if (!rule) return input;

  return {
    ...input,
    make: "Toyota",
    model: rule.model || input.model,
    generation: rule.generation,
    powertrainKind: rule.powertrainKind,
    fuel: rule.fuel,
    engineCc: rule.engineCc,
    drive: rule.drive || input.drive,
    icePowerKw: undefined,
    utilizationPowerKw: undefined,
    operational: {
      ...(input.operational || {}),
      raw: {
        ...raw,
        prestigeExactIdentityKnowledge: {
          rule: `${rule.sourceModel}:${rule.chassis}`,
          sourceModel,
          chassis,
          officialSources: rule.officialSources,
          powerIntentionallyUnset: true,
        },
      },
    },
  } as T;
}
