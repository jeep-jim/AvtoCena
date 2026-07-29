export type RussiaCustomsAgeBand = "up_to_3_years" | "from_3_to_5_years" | "over_5_years";
export type RussiaCustomsStatus = "ready" | "needs_data";
export type RussiaPowertrainKind = "combustion" | "electric" | "series_hybrid" | "other_hybrid" | "unknown";

export type RussiaCustomsInput = {
  customsValueRub: number;
  eurRateRub: number;
  engineCc?: number;
  powerHp?: number;
  powerKw?: number;
  icePowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  powertrainKind?: RussiaPowertrainKind;
  productionDate?: string;
  year?: number;
  fuel?: string;
  importedAt?: Date;
  personalUseEligible?: boolean;
};

export type RussiaCustomsResult = {
  status: RussiaCustomsStatus;
  ruleVersion: "rf_personal_m1_2026-01-01";
  ageMonths?: number;
  ageBand?: RussiaCustomsAgeBand;
  ageEstimated?: boolean;
  possibleAgeBands?: RussiaCustomsAgeBand[];
  customsValueRub: number;
  customsValueEur: number;
  customsClearanceFeeRub: number;
  importDutyRub: number;
  exciseRub: number;
  vatRub: number;
  utilizationPowerKw?: number;
  utilizationCoefficient?: number;
  utilizationFeeRub?: number;
  knownCustomsRub: number;
  totalCustomsRub?: number;
  missing: string[];
  warnings: string[];
  breakdown: Array<{ id: string; title: string; amountRub?: number; note?: string }>;
};

type CoefficientRow = { maxKw: number; newVehicle: number; usedVehicle: number };

const UTILIZATION_BASE_RUB = 20_000;
const VAT_RATE_2026 = 0.22;
const EV_IMPORT_DUTY_RATE = 0.15;
const PERSONAL_COMBUSTION_LIMIT_KW = 117.68;
const PERSONAL_COMBUSTION_LIMIT_CC = 3_000;
const PERSONAL_ELECTRIC_LIMIT_KW = 58.84;

function rows(values: Array<[number, number, number]>): CoefficientRow[] {
  return values.map(([maxKw, newVehicle, usedVehicle]) => ({ maxKw, newVehicle, usedVehicle }));
}

// Коэффициенты 2026 года из раздела I перечня к постановлению Правительства РФ № 1291
// в редакции постановления Правительства РФ от 01.11.2025 № 1713. Сноска «6» в
// официальной таблице не является третьим знаком после запятой.
const EV_2026 = rows([
  [58.84, 44.05, 77.48], [73.55, 54.52, 90.29], [95.61, 72.47, 105.2],
  [117.68, 85.8, 122.5], [139.75, 101.64, 142.69], [161.81, 120.65, 166.32],
  [183.88, 142.96, 193.78], [205.94, 169.36, 225.72], [Infinity, 200.64, 262.94],
]);

const ICE_UP_TO_1000_2026 = rows([
  [117.68, 16.37, 30.36], [139.75, 16.9, 31.27], [161.81, 17.42, 32.21],
  [183.88, 17.82, 33.13], [Infinity, 19.01, 33.13],
]);

const ICE_1000_TO_2000_2026 = rows([
  [117.68, 44.04, 77.48], [139.75, 49.5, 82.1], [161.81, 52.4, 87.12],
  [183.88, 55.57, 92.27], [205.94, 62.83, 101.11], [228, 71.02, 110.62],
  [250.07, 80.26, 121.18], [272.13, 91.48, 132.66], [294.2, 104.28, 145.2],
  [316.26, 118.8, 159.06], [338.33, 135.56, 174.24], [367.75, 154.44, 190.74],
  [Infinity, 176.09, 208.82],
]);

const ICE_2000_TO_3000_2026 = rows([
  [117.68, 123.78, 187.4], [139.75, 126.87, 190.08], [161.81, 130.02, 192.59],
  [183.88, 132.13, 195.36], [205.94, 138.6, 201.3], [228, 144.14, 207.37],
  [250.07, 149.95, 213.05], [272.13, 155.89, 218.99], [294.2, 162.23, 225.19],
  [316.26, 168.7, 231.53], [338.33, 175.43, 238], [367.75, 182.42, 244.6],
  [Infinity, 189.68, 251.46],
]);

const ICE_3000_TO_3500_2026 = rows([
  [73.55, 142.12, 217.59], [95.61, 142.12, 217.59], [117.68, 142.12, 217.59],
  [139.75, 144.94, 220.04], [161.81, 147.84, 222.42], [183.88, 150.88, 224.86],
  [205.94, 154.57, 227.96], [228, 158.46, 233.64], [250.07, 167.11, 239.58],
  [272.13, 176.35, 246.71], [294.2, 186.12, 254.1], [316.26, 196.28, 261.76],
  [338.33, 207.11, 269.54], [367.75, 218.46, 277.73], [Infinity, 230.47, 286.04],
]);

const ICE_OVER_3500_2026 = rows([
  [73.55, 180.99, 237.92], [95.61, 180.99, 237.92], [117.68, 180.99, 237.92],
  [139.75, 184.13, 241.43], [161.81, 187.18, 245.12], [183.88, 190.34, 248.82],
  [205.94, 194.17, 254.5], [228, 198, 260.3], [250.07, 205, 274.56],
  [272.13, 212.16, 289.74], [294.2, 219.65, 305.71], [316.26, 227.3, 322.48],
  [338.33, 235.22, 340.3], [367.75, 243.41, 359.04], [Infinity, 251.99, 378.71],
]);

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
  return Math.max(0, (importedAt.getUTCFullYear() - production.year) * 12
    + (importedAt.getUTCMonth() + 1 - production.month));
}

function ageBand(ageMonths: number): RussiaCustomsAgeBand {
  if (ageMonths <= 36) return "up_to_3_years";
  if (ageMonths <= 60) return "from_3_to_5_years";
  return "over_5_years";
}

function possibleProductionMonths(production: { year: number; month?: number }, importedAt: Date) {
  if (production.month) return [{ year: production.year, month: production.month }];
  const lastMonth = production.year === importedAt.getUTCFullYear() ? importedAt.getUTCMonth() + 1 : 12;
  return Array.from({ length: Math.max(1, lastMonth) }, (_, index) => ({ year: production.year, month: index + 1 }));
}

export function customsClearanceFeeRub(customsValueRub: number) {
  if (customsValueRub <= 200_000) return 1_231;
  if (customsValueRub <= 450_000) return 2_462;
  if (customsValueRub <= 1_200_000) return 4_924;
  if (customsValueRub <= 2_700_000) return 13_541;
  if (customsValueRub <= 4_200_000) return 18_465;
  if (customsValueRub <= 5_500_000) return 21_344;
  if (customsValueRub <= 10_000_000) return 49_240;
  return 73_860;
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
    if (engineCc <= 3_000) return 3;
    return 3.6;
  }
  if (engineCc <= 1_000) return 3;
  if (engineCc <= 1_500) return 3.2;
  if (engineCc <= 1_800) return 3.5;
  if (engineCc <= 2_300) return 4.8;
  if (engineCc <= 3_000) return 5;
  return 5.7;
}

function unifiedDutyRub(customsValueEur: number, eurRateRub: number, engineCc: number, band: RussiaCustomsAgeBand) {
  const dutyEur = band === "up_to_3_years"
    ? newCarDutyEur(customsValueEur, engineCc)
    : engineCc * usedCarRateEurPerCc(engineCc, band);
  return Math.round(dutyEur * eurRateRub);
}

function normalizePowertrain(input: RussiaCustomsInput): RussiaPowertrainKind {
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

export function utilizationPowerKwForInput(input: RussiaCustomsInput, kind = normalizePowertrain(input)) {
  const explicit = positive(input.utilizationPowerKw);
  if (explicit) return explicit;
  const thirtyMinute = sumPower(input.power30MinKwByMotor) || positive(input.power30MinKw);
  const ice = positive(input.icePowerKw)
    || (kind === "combustion" ? positive(input.powerKw)
      || (positive(input.powerHp) ? Number(input.powerHp) * 0.73549875 : undefined) : undefined);
  if (kind === "electric" || kind === "series_hybrid") return thirtyMinute;
  if (kind === "other_hybrid") return ice && thirtyMinute ? Math.round((ice + thirtyMinute) * 100) / 100 : undefined;
  if (kind === "combustion") return ice;
  return undefined;
}

function coefficientFrom(coefficientRows: CoefficientRow[], powerKw: number, band: RussiaCustomsAgeBand) {
  const row = coefficientRows.find((candidate) => powerKw <= candidate.maxKw) || coefficientRows[coefficientRows.length - 1];
  return band === "up_to_3_years" ? row.newVehicle : row.usedVehicle;
}

function combustionRows(engineCc: number) {
  if (engineCc <= 1_000) return ICE_UP_TO_1000_2026;
  if (engineCc <= 2_000) return ICE_1000_TO_2000_2026;
  if (engineCc <= 3_000) return ICE_2000_TO_3000_2026;
  if (engineCc <= 3_500) return ICE_3000_TO_3500_2026;
  return ICE_OVER_3500_2026;
}

export function utilizationCoefficient2026(params: {
  powertrainKind: RussiaPowertrainKind;
  utilizationPowerKw: number;
  engineCc?: number;
  ageBand: RussiaCustomsAgeBand;
  personalUseEligible?: boolean;
}) {
  const personalUse = params.personalUseEligible !== false;
  if (params.powertrainKind === "electric" || params.powertrainKind === "series_hybrid") {
    if (personalUse && params.utilizationPowerKw <= PERSONAL_ELECTRIC_LIMIT_KW) {
      return params.ageBand === "up_to_3_years" ? 0.17 : 0.26;
    }
    return coefficientFrom(EV_2026, params.utilizationPowerKw, params.ageBand);
  }
  if (params.powertrainKind === "combustion" || params.powertrainKind === "other_hybrid") {
    const engineCc = positive(params.engineCc);
    if (!engineCc) return undefined;
    if (personalUse && engineCc <= PERSONAL_COMBUSTION_LIMIT_CC
      && params.utilizationPowerKw <= PERSONAL_COMBUSTION_LIMIT_KW) {
      return params.ageBand === "up_to_3_years" ? 0.17 : 0.26;
    }
    return coefficientFrom(combustionRows(engineCc), params.utilizationPowerKw, params.ageBand);
  }
  return undefined;
}

function exciseRateRubPerHp2026(powerKw: number) {
  if (powerKw <= 67.5) return 0;
  if (powerKw <= 112.5) return 64;
  if (powerKw <= 150) return 613;
  if (powerKw <= 225) return 1_004;
  if (powerKw <= 300) return 1_711;
  if (powerKw <= 375) return 1_771;
  return 1_829;
}

function pureElectricCustomsPayment(input: RussiaCustomsInput, customsValueRub: number, utilizationPowerKw: number) {
  const excisePowerKw = positive(input.powerKw)
    || (positive(input.powerHp) ? Number(input.powerHp) * 0.75 : undefined)
    || utilizationPowerKw;
  const excisePowerHp = positive(input.powerHp) || excisePowerKw / 0.75;
  const importDutyRub = Math.round(customsValueRub * EV_IMPORT_DUTY_RATE);
  const exciseRub = Math.round(excisePowerHp * exciseRateRubPerHp2026(excisePowerKw));
  const vatRub = Math.round((customsValueRub + importDutyRub + exciseRub) * VAT_RATE_2026);
  return { importDutyRub, exciseRub, vatRub };
}

export function calculateRussiaCustomsForIndividual(input: RussiaCustomsInput): RussiaCustomsResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const customsValueRub = positive(input.customsValueRub) || 0;
  const eurRateRub = positive(input.eurRateRub) || 0;
  const engineCc = positive(input.engineCc);
  const importedAt = input.importedAt || new Date();
  const production = parseProductionMonth(input.productionDate, input.year);
  const powertrainKind = normalizePowertrain(input);
  const utilizationPowerKw = utilizationPowerKwForInput(input, powertrainKind);
  const pureElectric = powertrainKind === "electric";
  const needsCombustionDisplacement = powertrainKind === "combustion"
    || powertrainKind === "series_hybrid" || powertrainKind === "other_hybrid";

  if (!customsValueRub) missing.push("customs_value");
  if (!eurRateRub) missing.push("eur_rate");
  if (!production) missing.push("production_date");
  if (powertrainKind === "unknown") missing.push("powertrain_kind");
  if (!utilizationPowerKw) missing.push(
    powertrainKind === "electric" || powertrainKind === "series_hybrid"
      ? "certified_30_minute_power_kw" : "utilization_power_kw",
  );
  if (needsCombustionDisplacement && !engineCc) missing.push("engine_cc");

  const ageCandidates = production
    ? possibleProductionMonths(production, importedAt).map((candidate) => {
      const months = completedMonths(candidate, importedAt);
      return { months, band: ageBand(months) };
    })
    : [];
  const possibleAgeBands = [...new Set(ageCandidates.map((candidate) => candidate.band))];
  const ageEstimated = Boolean(production && !production.month);
  const exactAgeMonths = production?.month ? ageCandidates[0]?.months : undefined;
  const customsValueEur = eurRateRub ? customsValueRub / eurRateRub : 0;
  const customsClearance = customsValueRub ? customsClearanceFeeRub(customsValueRub) : 0;

  const calculations = possibleAgeBands.map((band) => {
    const coefficient = utilizationPowerKw ? utilizationCoefficient2026({
      powertrainKind,
      utilizationPowerKw,
      engineCc,
      ageBand: band,
      personalUseEligible: input.personalUseEligible,
    }) : undefined;
    const utilizationFeeRub = coefficient === undefined ? undefined : Math.round(UTILIZATION_BASE_RUB * coefficient);
    let importDutyRub = 0;
    let exciseRub = 0;
    let vatRub = 0;
    if (customsValueRub && pureElectric && utilizationPowerKw) {
      ({ importDutyRub, exciseRub, vatRub } = pureElectricCustomsPayment(input, customsValueRub, utilizationPowerKw));
    } else if (customsValueEur && eurRateRub && engineCc && !pureElectric) {
      importDutyRub = unifiedDutyRub(customsValueEur, eurRateRub, engineCc, band);
    }
    return {
      band, importDutyRub, exciseRub, vatRub, coefficient, utilizationFeeRub,
      total: customsClearance + importDutyRub + exciseRub + vatRub + (utilizationFeeRub || 0),
    };
  });

  const selected = [...calculations].sort((left, right) => right.total - left.total)[0];
  const band = selected?.band || possibleAgeBands[0];
  const importDutyRub = selected?.importDutyRub || 0;
  const exciseRub = selected?.exciseRub || 0;
  const vatRub = selected?.vatRub || 0;
  const utilizationCoefficient = selected?.coefficient;
  const utilizationFeeRub = selected?.utilizationFeeRub;

  if (ageEstimated && possibleAgeBands.length) warnings.push(
    `Месяц производства не указан: выбран максимальный платёж из категорий ${possibleAgeBands.join(", ")}.`,
  );
  if ((powertrainKind === "electric" || powertrainKind === "series_hybrid") && !utilizationPowerKw) warnings.push(
    "Нужна максимальная 30-минутная мощность из ОТТС, СБКТС, ЗОЕТС или ЭПТС; пиковая мощность для утильсбора не используется.",
  );
  if (powertrainKind === "other_hybrid" && !utilizationPowerKw) warnings.push(
    "Нужна сумма мощности ДВС и максимальной 30-минутной мощности всех тяговых электромоторов.",
  );
  if (powertrainKind === "series_hybrid") warnings.push(
    "Последовательный гибрид использует 30-минутную мощность для утильсбора, но таможенный платёж рассчитывается по объёму его ДВС, а не как для чистого электромобиля.",
  );
  if (input.personalUseEligible !== false) warnings.push(
    "Льготный коэффициент физического лица применяется только при соблюдении условий личного пользования; для ДВС и иных гибридов дополнительно требуется объём не более 3000 см³ и мощность не более 117,68 кВт, для электромобилей и последовательных гибридов — не более 58,84 кВт.",
  );
  warnings.push(
    "Таможенная стоимость должна включать цену автомобиля и подтверждённые расходы по доставке до границы ЕАЭС; логистика не подставляется автоматически.",
  );

  if (utilizationPowerKw && utilizationCoefficient === undefined) missing.push("utilization_coefficient");
  const knownCustomsRub = customsClearance + importDutyRub + exciseRub + vatRub;
  const complete = missing.length === 0 && utilizationFeeRub !== undefined && Boolean(band);
  const totalCustomsRub = complete ? knownCustomsRub + utilizationFeeRub : undefined;

  return {
    status: complete ? "ready" : "needs_data",
    ruleVersion: "rf_personal_m1_2026-01-01",
    ageMonths: exactAgeMonths,
    ageBand: band,
    ageEstimated,
    possibleAgeBands,
    customsValueRub,
    customsValueEur: Math.round(customsValueEur * 100) / 100,
    customsClearanceFeeRub: customsClearance,
    importDutyRub,
    exciseRub,
    vatRub,
    utilizationPowerKw,
    utilizationCoefficient,
    utilizationFeeRub,
    knownCustomsRub,
    totalCustomsRub,
    missing: [...new Set(missing)],
    warnings,
    breakdown: [
      { id: "customs-clearance", title: "Таможенный сбор за оформление", amountRub: customsClearance },
      {
        id: "import-duty",
        title: pureElectric ? "Ввозная пошлина 15%" : "Единая ставка таможенных платежей",
        amountRub: importDutyRub,
        note: ageEstimated ? `${band}; месяц оценён консервативно` : band,
      },
      ...(pureElectric ? [
        { id: "excise", title: "Акциз", amountRub: exciseRub, note: "Ставка 2026 года по мощности электродвигателя" },
        { id: "vat", title: "НДС 22%", amountRub: vatRub, note: "Таможенная стоимость + пошлина + акциз" },
      ] : []),
      {
        id: "utilization-fee",
        title: "Утилизационный сбор",
        amountRub: utilizationFeeRub,
        note: utilizationCoefficient === undefined ? "Требуются точные данные" : `20 000 ₽ × ${utilizationCoefficient}`,
      },
    ],
  };
}
