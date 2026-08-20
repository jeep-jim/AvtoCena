import {
  calculateRussiaCustomsForIndividual as calculateLegacyRussiaCustomsForIndividual,
  customsClearanceFeeRub,
  utilizationCoefficient2026,
  utilizationPowerKwForInput,
  type RussiaCustomsAgeBand,
  type RussiaCustomsInput,
  type RussiaCustomsResult,
  type RussiaPowertrainKind,
} from "./russiaCustoms";

export type RussiaVehicleCategory = "M1" | "N1" | "unknown";
export type ProductionReferenceBasis = "exact_date" | "month_midpoint" | "year_midpoint";

export type RussiaCustomsV2Input = RussiaCustomsInput & {
  vehicleCategory?: RussiaVehicleCategory;
  tnVedCode?: string;
  grossVehicleWeightKg?: number;
  bodyType?: string;
};

export type RussiaCustomsV2Result = RussiaCustomsResult & {
  legalRuleRevision: "rf_personal_vehicle_2026-08-20";
  vehicleCategory: RussiaVehicleCategory;
  vehicleCategoryAssumed: boolean;
  personalUseAssumed: boolean;
  productionReferenceDate?: string;
  productionReferenceBasis?: ProductionReferenceBasis;
};

type DateParts = { year: number; month: number; day: number; basis: ProductionReferenceBasis };

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function validDateParts(year: number, month: number, day: number) {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

/**
 * EAEU age reference for personal-use vehicles:
 * - exact source date: use it;
 * - only year/month known: use the 15th of that month;
 * - only year known: use 1 July.
 */
export function legalProductionReference(input: Pick<RussiaCustomsV2Input, "productionDate" | "year">): DateParts | null {
  const text = String(input.productionDate || "").trim();
  const exact = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (exact) {
    const year = Number(exact[1]);
    const month = Number(exact[2]);
    const day = Number(exact[3]);
    if (validDateParts(year, month, day)) return { year, month, day, basis: "exact_date" };
  }
  const compactExact = text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactExact) {
    const year = Number(compactExact[1]);
    const month = Number(compactExact[2]);
    const day = Number(compactExact[3]);
    if (validDateParts(year, month, day)) return { year, month, day, basis: "exact_date" };
  }
  const monthKnown = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b/)
    || text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])\b/);
  if (monthKnown) return { year: Number(monthKnown[1]), month: Number(monthKnown[2]), day: 15, basis: "month_midpoint" };
  const year = Number(input.year || text.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  if (Number.isFinite(year) && year >= 1900) return { year, month: 7, day: 1, basis: "year_midpoint" };
  return null;
}

function utcDateOnly(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function referenceTimestamp(value: DateParts, years = 0) {
  return Date.UTC(value.year + years, value.month - 1, value.day);
}

export function legalVehicleAgeBand(reference: DateParts, importedAt: Date): RussiaCustomsAgeBand {
  const imported = utcDateOnly(importedAt);
  if (imported <= referenceTimestamp(reference, 3)) return "up_to_3_years";
  if (imported <= referenceTimestamp(reference, 5)) return "from_3_to_5_years";
  return "over_5_years";
}

function completedLegalMonths(reference: DateParts, importedAt: Date) {
  let months = (importedAt.getUTCFullYear() - reference.year) * 12 + (importedAt.getUTCMonth() + 1 - reference.month);
  if (importedAt.getUTCDate() < reference.day) months -= 1;
  return Math.max(0, months);
}

// The legacy calculator already contains the audited 2026 tariff matrices. Feed
// it an unambiguous age inside the legally resolved band so those tables remain
// the single tariff source while boundary semantics are corrected here.
function syntheticProductionDate(band: RussiaCustomsAgeBand, importedAt: Date) {
  const yearsBack = band === "up_to_3_years" ? 1 : band === "from_3_to_5_years" ? 4 : 6;
  return `${importedAt.getUTCFullYear() - yearsBack}-${pad(importedAt.getUTCMonth() + 1)}`;
}

function powertrainKind(input: RussiaCustomsV2Input): RussiaPowertrainKind {
  if (input.powertrainKind && input.powertrainKind !== "unknown") return input.powertrainKind;
  const fuel = String(input.fuel || "").toLowerCase();
  if (/series|range|reev|erev|последователь|增程/.test(fuel)) return "series_hybrid";
  if (/hybrid|phev|hev|mhev|гибрид|混合动力/.test(fuel)) return "other_hybrid";
  if (/electric|battery|bev|электро|纯电/.test(fuel) && !positive(input.engineCc)) return "electric";
  if (positive(input.engineCc)) return "combustion";
  return "unknown";
}

function sumPower(values?: number[]) {
  const powers = (values || []).map(positive).filter((value): value is number => value !== undefined);
  return powers.length ? Math.round(powers.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined;
}

/** Maximum 30-minute traction power is the excise power for a BEV. Peak power is never a fallback. */
export function certifiedElectricExcisePowerKw(input: RussiaCustomsV2Input) {
  return sumPower(input.power30MinKwByMotor)
    || positive(input.power30MinKw)
    || positive(input.utilizationPowerKw);
}

function normalizedCategory(input: RussiaCustomsV2Input) {
  const explicit = String(input.vehicleCategory || "").trim().toUpperCase();
  if (explicit === "M1" || explicit === "N1") return { category: explicit as "M1" | "N1", assumed: false };
  const tnVed = String(input.tnVedCode || "").replace(/\D/g, "");
  if (tnVed.startsWith("8704")) return { category: "N1" as const, assumed: false };
  const body = String(input.bodyType || "").toLowerCase();
  if (/\b(?:pickup|pick-up|light\s*truck|truck|commercial)\b|пикап|груз/.test(body)) {
    return { category: "unknown" as const, assumed: false };
  }
  return { category: "M1" as const, assumed: true };
}

function blockedCategoryResult(
  input: RussiaCustomsV2Input,
  category: RussiaVehicleCategory,
  missingKey: string,
  warning: string,
  personalUseAssumed: boolean,
): RussiaCustomsV2Result {
  const customsValueRub = Math.round(positive(input.customsValueRub) || 0);
  const eurRateRub = positive(input.eurRateRub) || 0;
  const clearance = customsValueRub ? customsClearanceFeeRub(customsValueRub) : 0;
  const missing = [
    ...(!customsValueRub ? ["customs_value"] : []),
    ...(!eurRateRub ? ["eur_rate"] : []),
    missingKey,
  ];
  return {
    status: "needs_data",
    ruleVersion: "rf_personal_m1_2026-01-01",
    legalRuleRevision: "rf_personal_vehicle_2026-08-20",
    vehicleCategory: category,
    vehicleCategoryAssumed: false,
    personalUseAssumed,
    customsValueRub,
    customsValueEur: eurRateRub ? Math.round(customsValueRub / eurRateRub * 100) / 100 : 0,
    customsClearanceFeeRub: clearance,
    importDutyRub: 0,
    exciseRub: 0,
    vatRub: 0,
    knownCustomsRub: clearance,
    missing,
    warnings: [warning],
    breakdown: [
      { id: "customs-clearance", title: "Таможенный сбор за оформление", amountRub: clearance },
      { id: "vehicle-category", title: "Категория транспортного средства", note: warning },
    ],
  };
}

/**
 * Guarded 2026 personal-import calculation used by AvtoCena public pricing.
 * M1 tariffs delegate to the audited legacy tariff matrices; category, age and
 * electric-power semantics are resolved here before that calculation.
 */
export function calculateRussiaCustomsForIndividual(input: RussiaCustomsV2Input): RussiaCustomsV2Result {
  const importedAt = input.importedAt || new Date();
  const category = normalizedCategory(input);
  const personalUseAssumed = input.personalUseEligible === undefined;
  const personalUseEligible = input.personalUseEligible !== false;

  if (category.category === "N1") {
    return blockedCategoryResult(
      input,
      "N1",
      "n1_customs_tariff",
      "Категория N1 / ТН ВЭД 8704 требует отдельного грузового тарифа и коэффициента утильсбора. Легковой тариф M1 не подставляется.",
      personalUseAssumed,
    );
  }
  if (category.category === "unknown") {
    return blockedCategoryResult(
      input,
      "unknown",
      "vehicle_category",
      "Для пикапа или коммерческого автомобиля нужно подтвердить категорию M1/N1 или код ТН ВЭД до расчёта таможни и утильсбора.",
      personalUseAssumed,
    );
  }

  const reference = legalProductionReference(input);
  const legalBand = reference ? legalVehicleAgeBand(reference, importedAt) : undefined;
  const kind = powertrainKind(input);
  const electricExcisePowerKw = kind === "electric" ? certifiedElectricExcisePowerKw(input) : undefined;
  const legacyInput: RussiaCustomsInput = {
    ...input,
    personalUseEligible,
    productionDate: legalBand ? syntheticProductionDate(legalBand, importedAt) : input.productionDate,
    year: legalBand ? undefined : input.year,
    ...(kind === "electric" ? {
      // Excise and its VAT increment must use certified maximum 30-minute
      // traction power, never peak motor/system power.
      powerKw: electricExcisePowerKw,
      powerHp: electricExcisePowerKw ? electricExcisePowerKw / 0.75 : undefined,
    } : {}),
  };

  const result = calculateLegacyRussiaCustomsForIndividual(legacyInput);
  const warnings = [...result.warnings];
  if (category.assumed) warnings.push(
    "Категория M1 принята по умолчанию для легкового автомобиля. Для пикапов и коммерческих ТС категория должна быть подтверждена документами.",
  );
  if (personalUseAssumed) warnings.push(
    "Льготный утильсбор рассчитан как для первого ввоза физлицом для личного пользования. Право на льготу должно быть подтверждено перед оплатой.",
  );

  return {
    ...result,
    legalRuleRevision: "rf_personal_vehicle_2026-08-20",
    vehicleCategory: "M1",
    vehicleCategoryAssumed: category.assumed,
    personalUseAssumed,
    ...(reference ? {
      ageMonths: completedLegalMonths(reference, importedAt),
      ageBand: legalBand,
      ageEstimated: false,
      possibleAgeBands: legalBand ? [legalBand] : [],
      productionReferenceDate: `${reference.year}-${pad(reference.month)}-${pad(reference.day)}`,
      productionReferenceBasis: reference.basis,
    } : {}),
    warnings,
  };
}

export { customsClearanceFeeRub, utilizationCoefficient2026, utilizationPowerKwForInput };
export type { RussiaCustomsAgeBand, RussiaCustomsInput, RussiaCustomsResult, RussiaPowertrainKind };
