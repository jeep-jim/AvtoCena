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

// Коэффициенты календарного 2026 года из раздела I перечня к постановлению
// Правительства РФ № 1291 в редакции постановления от 01.11.2025 № 1713.
// В официальной таблице после пары 01.12.2025 идут пары 2026, 2027 и далее;
// здесь зафиксирована именно пара 01.01.2026–31.12.2026. Мощность — кВт.
const EV_2026 = rows([
  [58.84, 40.04, 70.44], [73.55, 49.56, 82.08], [95.61, 65.88, 95.64],
  [117.68, 78, 111.36], [139.75, 92.4, 129.72], [161.81, 109.68, 151.2],
  [183.88, 129.96, 176.16], [205.94, 153.96, 205.2], [Infinity, 182.4, 239.04],
]);

const ICE_UP_TO_1000_2026 = rows([
  [117.68, 14.88, 27.6], [139.75, 15.36, 28.43], [161.81, 15.84, 29.28],
  [183.88, 16.2, 30.12], [Infinity, 17.28, 30.12],
]);

const ICE_1000_TO_2000_2026 = rows([
  [117.68, 40.04, 70.44], [139.75, 45, 74.64], [161.81, 47.64, 79.2],
  [183.88, 50.52, 83.88], [205.94, 57.12, 91.92], [228, 64.56, 100.56],
  [250.07, 72.96, 110.16], [272.13, 83.16, 120.6], [294.2, 94.8, 132],
  [316.26, 108, 144.6], [338.33, 123.24, 158.4], [367.75, 140.4, 173.4],
  [Infinity, 160.08, 189.84],
]);

const ICE_2000_TO_3000_2026 = rows([
  [117.68, 112.52, 170.36], [139.75, 115.34, 172.8], [161.81, 118.2, 175.08],
  [183.88, 120.12, 177.6], [205.94, 126, 183], [228, 131.04, 188.52],
  [250.07, 136.32, 193.68], [272.13, 141.72, 199.08], [294.2, 147.48, 204.72],
  [316.26, 153.36, 210.48], [338.33, 159.48, 216.36], [367.75, 165.84, 222.36],
  [Infinity, 172.44, 228.6],
]);

const ICE_3000_TO_3500_2026 = rows([
  [73.55, 129.2, 197.81], [95.61, 129.2, 197.81], [117.68, 129.2, 197.81],
  [139.75, 131.76, 200.04], [161.81, 134.4, 202.2], [183.88, 137.16, 204.36],
  [205.94, 140.52, 207.24], [228, 144, 212.4], [250.07, 151.92, 217.8],
  [272.13, 160.32, 224.28], [294.2, 169.2, 231], [316.26, 178.44, 237.96],
  [338.33, 188.28, 245.04], [367.75, 198.6, 252.48], [Infinity, 209.52, 260.04],
]);

const ICE_OVER_3500_2026 = rows([
  [73.55, 164.53, 216.29], [95.61, 164.53, 216.29], [117.68, 164.53, 216.29],
  [139.75, 167.28, 219.48], [161.81, 170.16, 222.84], [183.88, 173.04, 226.2],
  [205.94, 176.52, 231.36], [228, 180, 236.64], [250.07, 186.36, 249.6],
  [272.13, 192.88, 263.4], [294.2, 199.68, 277.92], [316.26, 206.64, 293.16],
  [338.33, 213.84, 309.36], [367.75, 221.28, 326.4], [Infinity, 229.08, 344.28],
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

function pureElectricKnownCustomsPayment(input: RussiaCustomsInput, customsValueRub: number) {
  const excisePowerKw = positive(input.powerKw)
    || (positive(input.powerHp) ? Number(input.powerHp) * 0.75 : undefined);
  const importDutyRub = Math.round(customsValueRub * EV_IMPORT_DUTY_RATE);
  if (!excisePowerKw) {
    // We can still calculate the exact 15% duty and the VAT base that does not
    // depend on excise. The unknown excise and its incremental VAT stay excluded
    // from the preliminary lower-bound price until source/certified power is known.
    const vatRub = Math.round((customsValueRub + importDutyRub) * VAT_RATE_2026);
    return { importDutyRub, exciseRub: 0, vatRub, excisePowerKnown: false };
  }
  const excisePowerHp = positive(input.powerHp) || excisePowerKw / 0.75;
  const exciseRub = Math.round(excisePowerHp * exciseRateRubPerHp2026(excisePowerKw));
  const vatRub = Math.round((customsValueRub + importDutyRub + exciseRub) * VAT_RATE_2026);
  return { importDutyRub, exciseRub, vatRub, excisePowerKnown: true };
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
  if (pureElectric && !positive(input.powerKw) && !positive(input.powerHp)) missing.push("electric_excise_power_kw");
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
    if (customsValueRub && pureElectric) {
      ({ importDutyRub, exciseRub, vatRub } = pureElectricKnownCustomsPayment(input, customsValueRub));
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
    "Нужна максимальная 30-минутная мощность из ОТТС, СБКТС, ЗОЕТС или ЭПТС; пиковая мощность для утильсбора не используется. До её получения утильсбор не включается в предварительный итог.",
  );
  if (pureElectric && !positive(input.powerKw) && !positive(input.powerHp)) warnings.push(
    "Мощность электродвигателя для акциза не подтверждена источником: акциз и зависящая от него часть НДС не включены в предварительный итог.",
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
