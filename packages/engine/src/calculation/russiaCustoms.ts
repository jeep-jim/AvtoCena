export type RussiaCustomsAgeBand = "up_to_3_years" | "from_3_to_5_years" | "over_5_years";
export type RussiaCustomsStatus = "ready" | "needs_data" | "unsupported";

export type RussiaCustomsInput = {
  customsValueRub: number;
  eurRateRub: number;
  engineCc?: number;
  powerHp?: number;
  powerKw?: number;
  productionDate?: string;
  year?: number;
  fuel?: string;
  importedAt?: Date;
};

export type RussiaCustomsResult = {
  status: RussiaCustomsStatus;
  ruleVersion: "rf_personal_m1_2026-01-01";
  ageMonths?: number;
  ageBand?: RussiaCustomsAgeBand;
  customsValueRub: number;
  customsValueEur: number;
  customsClearanceFeeRub: number;
  importDutyRub: number;
  utilizationFeeRub?: number;
  knownCustomsRub: number;
  totalCustomsRub?: number;
  missing: string[];
  warnings: string[];
  breakdown: Array<{ id: string; title: string; amountRub?: number; note?: string }>;
};

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseProductionMonth(value?: string, fallbackYear?: number) {
  const text = String(value || "").trim();
  const separated = text.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])\b/);
  if (separated) return { year: Number(separated[1]), month: Number(separated[2]) };
  const compact = text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])\b/);
  if (compact) return { year: Number(compact[1]), month: Number(compact[2]) };
  const year = Number(fallbackYear || text.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  return Number.isFinite(year) && year >= 1900 ? { year, month: undefined } : null;
}

function completedMonths(production: { year: number; month: number }, importedAt: Date) {
  return Math.max(0, (importedAt.getUTCFullYear() - production.year) * 12 + (importedAt.getUTCMonth() + 1 - production.month));
}

function ageBand(ageMonths: number): RussiaCustomsAgeBand {
  if (ageMonths <= 36) return "up_to_3_years";
  if (ageMonths <= 60) return "from_3_to_5_years";
  return "over_5_years";
}

export function customsClearanceFeeRub(customsValueRub: number) {
  if (customsValueRub <= 200_000) return 775;
  if (customsValueRub <= 450_000) return 1_550;
  if (customsValueRub <= 1_200_000) return 3_100;
  if (customsValueRub <= 2_700_000) return 8_530;
  if (customsValueRub <= 4_200_000) return 12_000;
  if (customsValueRub <= 5_500_000) return 15_500;
  if (customsValueRub <= 7_000_000) return 20_000;
  if (customsValueRub <= 8_000_000) return 23_000;
  if (customsValueRub <= 9_000_000) return 25_000;
  if (customsValueRub <= 10_000_000) return 27_000;
  return 30_000;
}

function newCarDutyEur(customsValueEur: number, engineCc: number) {
  const tier = customsValueEur <= 8_500
    ? { percent: 0.54, minimumPerCc: 2.5 }
    : customsValueEur <= 16_700
      ? { percent: 0.48, minimumPerCc: 3.5 }
      : customsValueEur <= 42_300
        ? { percent: 0.48, minimumPerCc: 5.5 }
        : customsValueEur <= 84_500
          ? { percent: 0.48, minimumPerCc: 7.5 }
          : customsValueEur <= 169_000
            ? { percent: 0.48, minimumPerCc: 15 }
            : { percent: 0.48, minimumPerCc: 20 };
  return Math.max(customsValueEur * tier.percent, engineCc * tier.minimumPerCc);
}

function usedCarRateEurPerCc(engineCc: number, band: Exclude<RussiaCustomsAgeBand, "up_to_3_years">) {
  if (band === "from_3_to_5_years") {
    if (engineCc <= 1_000) return 1.5;
    if (engineCc <= 1_500) return 1.7;
    if (engineCc <= 1_800) return 2.5;
    if (engineCc <= 2_300) return 2.7;
    if (engineCc <= 3_000) return 3.0;
    return 3.6;
  }
  if (engineCc <= 1_000) return 3.0;
  if (engineCc <= 1_500) return 3.2;
  if (engineCc <= 1_800) return 3.5;
  if (engineCc <= 2_300) return 4.8;
  if (engineCc <= 3_000) return 5.0;
  return 5.7;
}

function normalizedFuel(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function isSpecialPowertrain(fuel: string) {
  return /electric|hybrid|phev|hev|mhev|reev|range|электро|гибрид/.test(fuel);
}

export function calculateRussiaCustomsForIndividual(input: RussiaCustomsInput): RussiaCustomsResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const customsValueRub = positive(input.customsValueRub) || 0;
  const eurRateRub = positive(input.eurRateRub) || 0;
  const engineCc = positive(input.engineCc);
  const powerHp = positive(input.powerHp) || (positive(input.powerKw) ? Number(input.powerKw) * 1.35962 : undefined);
  const importedAt = input.importedAt || new Date();
  const production = parseProductionMonth(input.productionDate, input.year);

  if (!customsValueRub) missing.push("customs_value");
  if (!eurRateRub) missing.push("eur_rate");
  if (!engineCc) missing.push("engine_cc");
  if (!production) missing.push("production_date");
  else if (!production.month) missing.push("production_month");

  const ageMonths = production?.month ? completedMonths({ year: production.year, month: production.month }, importedAt) : undefined;
  const band = ageMonths === undefined ? undefined : ageBand(ageMonths);
  const customsValueEur = eurRateRub ? customsValueRub / eurRateRub : 0;
  const customsClearance = customsValueRub ? customsClearanceFeeRub(customsValueRub) : 0;
  let importDutyRub = 0;

  if (customsValueEur && engineCc && band) {
    const dutyEur = band === "up_to_3_years"
      ? newCarDutyEur(customsValueEur, engineCc)
      : engineCc * usedCarRateEurPerCc(engineCc, band);
    importDutyRub = Math.round(dutyEur * eurRateRub);
  }

  const fuel = normalizedFuel(input.fuel);
  let utilizationFeeRub: number | undefined;
  let unsupported = false;
  if (isSpecialPowertrain(fuel)) {
    unsupported = true;
    missing.push("powertrain_power_breakdown");
    warnings.push("Для электромобиля или гибрида нужны применяемая для утильсбора мощность и тип силовой установки.");
  } else if (!powerHp) {
    missing.push("power_hp");
  } else if (powerHp <= 160 && band) {
    utilizationFeeRub = band === "up_to_3_years" ? 3_400 : 5_200;
  } else if (powerHp > 160) {
    unsupported = true;
    missing.push("full_utilization_coefficient");
    warnings.push("Для автомобиля мощнее 160 л.с. льготный утильсбор физлица не применяется; требуется полный коэффициент 2026 года.");
  }

  warnings.push("Таможенная стоимость временно принимается равной цене автомобиля; доставка до границы должна добавляться отдельным входным параметром.");
  const knownCustomsRub = customsClearance + importDutyRub;
  const complete = missing.length === 0 && utilizationFeeRub !== undefined;
  const totalCustomsRub = complete ? knownCustomsRub + utilizationFeeRub : undefined;

  return {
    status: complete ? "ready" : unsupported ? "unsupported" : "needs_data",
    ruleVersion: "rf_personal_m1_2026-01-01",
    ageMonths,
    ageBand: band,
    customsValueRub,
    customsValueEur: Math.round(customsValueEur * 100) / 100,
    customsClearanceFeeRub: customsClearance,
    importDutyRub,
    utilizationFeeRub,
    knownCustomsRub,
    totalCustomsRub,
    missing: [...new Set(missing)],
    warnings,
    breakdown: [
      { id: "customs-clearance", title: "Таможенный сбор за оформление", amountRub: customsClearance },
      { id: "import-duty", title: "Единая ставка таможенных платежей", amountRub: importDutyRub, note: band },
      { id: "utilization-fee", title: "Утилизационный сбор", amountRub: utilizationFeeRub, note: utilizationFeeRub === undefined ? "Требуются мощность и применимый коэффициент" : "Льготная ставка для физлица" },
    ],
  };
}
