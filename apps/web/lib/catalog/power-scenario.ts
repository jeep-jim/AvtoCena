import type { VehicleOffer } from "./types";

export const DEFAULT_CATALOG_POWER_FALLBACK_HP = 100;
export const CATALOG_POWER_SCENARIO_PREFIX = "power_scenario:";

export type CatalogPowerScenarioSource = "fallback_100" | "knowledge_reference" | "source_peak_estimate" | "customer_input";
export type CatalogPowerScenario = {
  horsepower: number;
  utilizationPowerKw: number;
  source: CatalogPowerScenarioSource;
  requiresConfirmation: true;
  userEditable: true;
};

function positive(value: unknown, max = 2_500) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 20 && number <= max ? number : 0;
}

function powertrainKind(offer: Partial<VehicleOffer> | any) {
  const explicit = String(offer?.powertrainKind || "").toLowerCase();
  if (["combustion", "electric", "series_hybrid", "other_hybrid"].includes(explicit)) return explicit;
  const fuel = String(offer?.fuel || "").toLowerCase();
  if (/series|range|reev|erev|последователь|增程/.test(fuel)) return "series_hybrid";
  if (/hybrid|phev|hev|mhev|гибрид|混合动力/.test(fuel)) return "other_hybrid";
  if (/electric|battery|bev|электро|纯电/.test(fuel) && !Number(offer?.engineCc || 0)) return "electric";
  if (Number(offer?.engineCc || 0) > 0) return "combustion";
  return "unknown";
}

export function readCatalogPowerScenario(offer: Partial<VehicleOffer> | any): CatalogPowerScenario | null {
  const snapshot = offer?.calculationSnapshot?.powerScenario;
  if (snapshot && positive(snapshot.horsepower) && Number(snapshot.utilizationPowerKw) > 0) {
    return {
      horsepower: Math.round(Number(snapshot.horsepower) * 10) / 10,
      utilizationPowerKw: Math.round(Number(snapshot.utilizationPowerKw) * 100) / 100,
      source: String(snapshot.source || "fallback_100") as CatalogPowerScenarioSource,
      requiresConfirmation: true,
      userEditable: true,
    };
  }
  if (!String(offer?.powerDataSource || "").startsWith(CATALOG_POWER_SCENARIO_PREFIX)) return null;
  const horsepower = positive(offer?.powerHp) || DEFAULT_CATALOG_POWER_FALLBACK_HP;
  return {
    horsepower,
    utilizationPowerKw: Math.round(horsepower * 0.73549875 * 100) / 100,
    source: String(offer.powerDataSource).slice(CATALOG_POWER_SCENARIO_PREFIX.length) as CatalogPowerScenarioSource,
    requiresConfirmation: true,
    userEditable: true,
  };
}

export function isCatalogPowerScenario(offer: Partial<VehicleOffer> | any) {
  return Boolean(readCatalogPowerScenario(offer));
}

export function resolveCatalogPowerScenario(
  offer: Partial<VehicleOffer> | any,
  options: { requestedHp?: number; representativeHp?: number } = {},
): CatalogPowerScenario | null {
  const requested = positive(options.requestedHp);
  if (requested) {
    return {
      horsepower: requested,
      utilizationPowerKw: Math.round(requested * 0.73549875 * 100) / 100,
      source: "customer_input",
      requiresConfirmation: true,
      userEditable: true,
    };
  }

  const kind = powertrainKind(offer);
  const peakHp = positive(offer?.powerHp)
    || (Number(offer?.powerKw || 0) > 0 ? Math.round(Number(offer.powerKw) / 0.73549875 * 10) / 10 : 0);
  const utilization = Number(offer?.utilizationPowerKw || 0);
  const thirty = Number(offer?.power30MinKw || 0)
    || (Array.isArray(offer?.power30MinKwByMotor)
      ? offer.power30MinKwByMotor.reduce((sum: number, value: unknown) => sum + Math.max(0, Number(value || 0)), 0)
      : 0);

  const alreadySufficient = kind === "combustion"
    ? peakHp > 0
    : kind === "electric" || kind === "series_hybrid"
      ? peakHp > 0 && (utilization > 0 || thirty > 0)
      : kind === "other_hybrid"
        ? peakHp > 0 && utilization > 0
        : false;
  if (alreadySufficient) return null;

  const representative = positive(options.representativeHp);
  const horsepower = peakHp || representative || DEFAULT_CATALOG_POWER_FALLBACK_HP;
  const source: CatalogPowerScenarioSource = peakHp
    ? "source_peak_estimate"
    : representative
      ? "knowledge_reference"
      : "fallback_100";
  return {
    horsepower,
    utilizationPowerKw: Math.round(horsepower * 0.73549875 * 100) / 100,
    source,
    requiresConfirmation: true,
    userEditable: true,
  };
}

export function applyCatalogPowerScenario<T extends VehicleOffer>(offer: T, scenario: CatalogPowerScenario): T {
  const customerOverride = scenario.source === "customer_input";
  const horsepower = scenario.horsepower;
  const powerKw = Math.round(horsepower * 0.73549875 * 100) / 100;
  return {
    ...offer,
    powerHp: customerOverride || !Number(offer.powerHp || 0) ? horsepower : offer.powerHp,
    powerKw: customerOverride || !Number(offer.powerKw || 0) ? powerKw : offer.powerKw,
    utilizationPowerKw: scenario.utilizationPowerKw,
    powerDataConfidence: "estimated",
    powerDataSource: `${CATALOG_POWER_SCENARIO_PREFIX}${scenario.source}`,
    calculationSnapshot: {
      ...(offer.calculationSnapshot || {}),
      powerScenario: scenario,
      powerRequiresConfirmation: true,
    },
  } as T;
}
