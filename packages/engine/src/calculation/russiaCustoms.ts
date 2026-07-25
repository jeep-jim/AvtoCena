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

type CoefficientRow = {
  maxKw: number;
  newVehicle: number;
  usedVehicle: number;
};

const UTILIZATION_BASE_RUB = 20_000;
const VAT_RATE_2026 = 0.22;
const EV_IMPORT_DUTY_RATE = 0.15;
const PERSONAL_COMBUSTION_LIMIT_KW = 117.68;
const PERSONAL_COMBUSTION_LIMIT_CC = 3_000;
const PERSONAL_ELECTRIC_LIMIT_KW = 58.84;

const EV_2026: CoefficientRow[] = [
  { maxKw: 58.84, newVehicle: 40.04, usedVehicle: 70.44 },
  { maxKw: 73.55, newVehicle: 49.56, usedVehicle: 82.08 },
  { maxKw: 95.61, newVehicle: 65.88, usedVehicle: 95.64 },
  { maxKw: 117.68, newVehicle: 78, usedVehicle: 111.36 },
  { maxKw: 139.75, newVehicle: 92.4, usedVehicle: 129.72 },
  { maxKw: 161.81, newVehicle: 109.68, usedVehicle: 151.2 },
  { maxKw: 183.88, newVehicle: 129.96, usedVehicle: 176.16 },
  { maxKw: 205.94, newVehicle: 153.96, usedVehicle: 205.2 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 182.4, usedVehicle: 239.04 },
];

const ICE_UP_TO_1000_2026: CoefficientRow[] = [
  { maxKw: 117.68, newVehicle: 14.88, usedVehicle: 27.6 },
  { maxKw: 139.75, newVehicle: 15.36, usedVehicle: 28.44 },
  { maxKw: 161.81, newVehicle: 15.84, usedVehicle: 29.28 },
  { maxKw: 183.88, newVehicle: 16.2, usedVehicle: 30.12 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 17.28, usedVehicle: 30.12 },
];

const ICE_1000_TO_2000_2026: CoefficientRow[] = [
  { maxKw: 117.68, newVehicle: 40.04, usedVehicle: 70.44 },
  { maxKw: 139.75, newVehicle: 45, usedVehicle: 74.64 },
  { maxKw: 161.81, newVehicle: 47.64, usedVehicle: 79.2 },
  { maxKw: 183.88, newVehicle: 50.52, usedVehicle: 83.88 },
  { maxKw: 205.94, newVehicle: 57.12, usedVehicle: 91.92 },
  { maxKw: 228, newVehicle: 64.56, usedVehicle: 100.56 },
  { maxKw: 250.07, newVehicle: 72.96, usedVehicle: 110.16 },
  { maxKw: 272.13, newVehicle: 83.16, usedVehicle: 120.6 },
  { maxKw: 294.2, newVehicle: 94.8, usedVehicle: 132 },
  { maxKw: 316.26, newVehicle: 108, usedVehicle: 144.6 },
  { maxKw: 338.33, newVehicle: 123.24, usedVehicle: 158.4 },
  { maxKw: 367.75, newVehicle: 140.4, usedVehicle: 173.4 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 160.08, usedVehicle: 189.84 },
];

const ICE_2000_TO_3000_2026: CoefficientRow[] = [
  { maxKw: 117.68, newVehicle: 112.52, usedVehicle: 170.36 },
  { maxKw: 139.75, newVehicle: 115.34, usedVehicle: 172.8 },
  { maxKw: 161.81, newVehicle: 118.2, usedVehicle: 175.08 },
  { maxKw: 183.88, newVehicle: 120.12, usedVehicle: 177.6 },
  { maxKw: 205.94, newVehicle: 126, usedVehicle: 183 },
  { maxKw: 228, newVehicle: 131.04, usedVehicle: 188.52 },
  { maxKw: 250.07, newVehicle: 136.32, usedVehicle: 193.68 },
  { maxKw: 272.13, newVehicle: 141.72, usedVehicle: 199.08 },
  { maxKw: 294.2, newVehicle: 147.48, usedVehicle: 204.72 },
  { maxKw: 316.26, newVehicle: 153.36, usedVehicle: 210.48 },
  { maxKw: 338.33, newVehicle: 159.48, usedVehicle: 216.36 },
  { maxKw: 367.75, newVehicle: 165.84, usedVehicle: 222.36 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 172.44, usedVehicle: 228.6 },
];

const ICE_3000_TO_3500_2026: CoefficientRow[] = [
  { maxKw: 73.55, newVehicle: 129.2, usedVehicle: 197.81 },
  { maxKw: 95.61, newVehicle: 129.2, usedVehicle: 197.81 },
  { maxKw: 117.68, newVehicle: 129.2, usedVehicle: 197.81 },
  { maxKw: 139.75, newVehicle: 131.76, usedVehicle: 200.04 },
  { maxKw: 161.81, newVehicle: 134.4, usedVehicle: 202.2 },
  { maxKw: 183.88, newVehicle: 137.16, usedVehicle: 204.36 },
  { maxKw: 205.94, newVehicle: 140.52, usedVehicle: 207.24 },
  { maxKw: 228, newVehicle: 144, usedVehicle: 212.4 },
  { maxKw: 250.07, newVehicle: 151.92, usedVehicle: 217.8 },
  { maxKw: 272.13, newVehicle: 160.32, usedVehicle: 224.28 },
  { maxKw: 294.2, newVehicle: 169.2, usedVehicle: 231 },
  { maxKw: 316.26, newVehicle: 178.44, usedVehicle: 237.96 },
  { maxKw: 338.33, newVehicle: 188.28, usedVehicle: 245.04 },
  { maxKw: 367.75, newVehicle: 198.6, usedVehicle: 252.48 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 209.52, usedVehicle: 260.04 },
];

const ICE_OVER_3500_2026: CoefficientRow[] = [
  { maxKw: 73.55, newVehicle: 164.53, usedVehicle: 216.29 },
  { maxKw: 95.61, newVehicle: 164.53, usedVehicle: 216.29 },
  { maxKw: 117.68, newVehicle: 164.53, usedVehicle: 216.29 },
  { maxKw: 139.75, newVehicle: 167.28, usedVehicle: 219.48 },
  { maxKw: 161.81, newVehicle: 170.16, usedVehicle: 222.84 },
  { maxKw: 183.88, newVehicle: 173.04, usedVehicle: 226.2 },
  { maxKw: 205.94, newVehicle: 176.52, usedVehicle: 231.36 },
  { maxKw: 228, newVehicle: 180, usedVehicle: 236.64 },
  { maxKw: 250.07, newVehicle: 186.36, usedVehicle: 249.6 },
  { maxKw: 272.13, newVehicle: 192.88, usedVehicle: 263.4 },
  { maxKw: 294.2, newVehicle: 199.68, usedVehicle: 277.92 },
  { maxKw: 316.26, newVehicle: 206.64, usedVehicle: 293.16 },
  { maxKw: 338.33, newVehicle: 213.84, usedVehicle: 309.36 },
  { maxKw: 367.75, newVehicle: 221.28, usedVehicle: 326.4 },
  { maxKw: Number.POSITIVE_INFINITY, newVehicle: 229.08, usedVehicle: 344.28 },
];

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
  return Math.max(
    0,
    (importedAt.getUTCFullYear() - production.year) * 12
      + (importedAt.getUTCMonth() + 1 - production.month),
  );
}

function ageBand(ageMonths: number): RussiaCustomsAgeBand {
  if (ageMonths <= 36) return "up_to_3_years";
  if (ageMonths <= 60) return "from_3_to_5_years";
  return "over_5_years";
}

function possibleProductionMonths(production: { year: number; month?: number }, importedAt: Date) {
  if (production.month) return [{ year: production.year, month: production.month }];
  const lastMonth = production.year === importedAt.getUTCFullYear()
    ? importedAt.getUTCMonth() + 1
    : 12;
  return Array.from(
    { length: Math.max(1, lastMonth) },
    (_, index) => ({ year: production.year, month: index + 1 }),
  );
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
  return Math.max(
    customsValueEur * tier.percent,
    engineCc * tier.minimumPerCc,
  );
}

function usedCarRateEurPerCc(
  engineCc: number,
  band: Exclude<RussiaCustomsAgeBand, "up_to_3_years">,
) {
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

function unifiedDutyRub(
  customsValueEur: number,
  eurRateRub: number,
  engineCc: number,
  band: RussiaCustomsAgeBand,
) {
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
  const powers = (values || [])
    .map(positive)
    .filter((value): value is number => value !== undefined);
  return powers.length
    ? Math.round(powers.reduce((sum, value) => sum + value, 0) * 100) / 100
    : undefined;
}

export function utilizationPowerKwForInput(
  input: RussiaCustomsInput,
  kind = normalizePowertrain(input),
) {
  const explicit = positive(input.utilizationPowerKw);
  if (explicit) return explicit;

  const thirtyMinute = sumPower(input.power30MinKwByMotor)
    || positive(input.power30MinKw);
  const ice = positive(input.icePowerKw)
    || (kind === "combustion"
      ? positive(input.powerKw)
        || (positive(input.powerHp) ? Number(input.powerHp) * 0.73549875 : undefined)
      : undefined);

  if (kind === "electric" || kind === "series_hybrid") return thirtyMinute;
  if (kind === "other_hybrid") {
    return ice && thirtyMinute
      ? Math.round((ice + thirtyMinute) * 100) / 100
      : undefined;
  }
  if (kind === "combustion") return ice;
  return undefined;
}

function coefficientFrom(
  rows: CoefficientRow[],
  powerKw: number,
  band: RussiaCustomsAgeBand,
) {
  const row = rows.find((candidate) => powerKw <= candidate.maxKw)
    || rows[rows.length - 1];
  return band === "up_to_3_years"
    ? row.newVehicle
    : row.usedVehicle;
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
    if (
      personalUse
      && engineCc <= PERSONAL_COMBUSTION_LIMIT_CC
      && params.utilizationPowerKw <= PERSONAL_COMBUSTION_LIMIT_KW
    ) {
      return params.ageBand === "up_to_3_years" ? 0.17 : 0.26;
    }
    return coefficientFrom(
      combustionRows(engineCc),
      params.utilizationPowerKw,
      params.ageBand,
    );
  }

  return undefined;
}

function exciseRateRubPerHp2026(powerKw: number) {
  if (powerKw <= 67.5) return 0;
  if (powerKw <= 112.5) return 63;
  if (powerKw <= 150) return 606;
  if (powerKw <= 225) return 993;
  if (powerKw <= 300) return 1_693;
  if (powerKw <= 375) return 1_752;
  return 1_810;
}

function pureElectricCustomsPayment(
  input: RussiaCustomsInput,
  customsValueRub: number,
  utilizationPowerKw: number,
) {
  const excisePowerKw = positive(input.powerKw)
    || (positive(input.powerHp) ? Number(input.powerHp) * 0.75 : undefined)
    || utilizationPowerKw;
  const excisePowerHp = positive(input.powerHp) || excisePowerKw / 0.75;
  const importDutyRub = Math.round(customsValueRub * EV_IMPORT_DUTY_RATE);
  const exciseRub = Math.round(
    excisePowerHp * exciseRateRubPerHp2026(excisePowerKw),
  );
  const vatRub = Math.round(
    (customsValueRub + importDutyRub + exciseRub) * VAT_RATE_2026,
  );
  return { importDutyRub, exciseRub, vatRub };
}

export function calculateRussiaCustomsForIndividual(
  input: RussiaCustomsInput,
): RussiaCustomsResult {
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
    || powertrainKind === "series_hybrid"
    || powertrainKind === "other_hybrid";

  if (!customsValueRub) missing.push("customs_value");
  if (!eurRateRub) missing.push("eur_rate");
  if (!production) missing.push("production_date");
  if (powertrainKind === "unknown") missing.push("powertrain_kind");
  if (!utilizationPowerKw) {
    missing.push(
      powertrainKind === "electric" || powertrainKind === "series_hybrid"
        ? "certified_30_minute_power_kw"
        : "utilization_power_kw",
    );
  }
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
  const customsClearance = customsValueRub
    ? customsClearanceFeeRub(customsValueRub)
    : 0;

  const calculations = possibleAgeBands.map((band) => {
    const coefficient = utilizationPowerKw
      ? utilizationCoefficient2026({
        powertrainKind,
        utilizationPowerKw,
        engineCc,
        ageBand: band,
        personalUseEligible: input.personalUseEligible,
      })
      : undefined;
    const utilizationFeeRub = coefficient === undefined
      ? undefined
      : Math.round(UTILIZATION_BASE_RUB * coefficient);

    let importDutyRub = 0;
    let exciseRub = 0;
    let vatRub = 0;
    if (customsValueRub && pureElectric && utilizationPowerKw) {
      ({ importDutyRub, exciseRub, vatRub } = pureElectricCustomsPayment(
        input,
        customsValueRub,
        utilizationPowerKw,
      ));
    } else if (customsValueEur && eurRateRub && engineCc && !pureElectric) {
      importDutyRub = unifiedDutyRub(
        customsValueEur,
        eurRateRub,
        engineCc,
        band,
      );
    }

    return {
      band,
      importDutyRub,
      exciseRub,
      vatRub,
      coefficient,
      utilizationFeeRub,
      total: customsClearance
        + importDutyRub
        + exciseRub
        + vatRub
        + (utilizationFeeRub || 0),
    };
  });

  const selected = [...calculations]
    .sort((left, right) => right.total - left.total)[0];
  const band = selected?.band || possibleAgeBands[0];
  const importDutyRub = selected?.importDutyRub || 0;
  const exciseRub = selected?.exciseRub || 0;
  const vatRub = selected?.vatRub || 0;
  const utilizationCoefficient = selected?.coefficient;
  const utilizationFeeRub = selected?.utilizationFeeRub;

  if (ageEstimated && possibleAgeBands.length) {
    warnings.push(
      `Месяц производства не указан: выбран максимальный платёж из категорий ${possibleAgeBands.join(", ")}.`,
    );
  }
  if (
    (powertrainKind === "electric" || powertrainKind === "series_hybrid")
    && !utilizationPowerKw
  ) {
    warnings.push(
      "Нужна максимальная 30-минутная мощность из ОТТС, СБКТС, ЗОЕТС или ЭПТС; пиковая мощность для утильсбора не используется.",
    );
  }
  if (powertrainKind === "other_hybrid" && !utilizationPowerKw) {
    warnings.push(
      "Нужна сумма мощности ДВС и максимальной 30-минутной мощности всех тяговых электромоторов.",
    );
  }
  if (powertrainKind === "series_hybrid") {
    warnings.push(
      "Последовательный гибрид использует 30-минутную мощность для утильсбора, но таможенный платёж рассчитывается по объёму его ДВС, а не как для чистого электромобиля.",
    );
  }
  if (input.personalUseEligible !== false) {
    warnings.push(
      "Льготный коэффициент физического лица применяется только при соблюдении условий личного пользования; для ДВС и иных гибридов дополнительно требуется объём не более 3000 см³ и мощность не более 117,68 кВт, для электромобилей и последовательных гибридов — не более 58,84 кВт.",
    );
  }
  warnings.push(
    "Таможенная стоимость должна включать цену автомобиля и подтверждённые расходы по доставке до границы ЕАЭС; логистика не подставляется автоматически.",
  );

  if (utilizationPowerKw && utilizationCoefficient === undefined) {
    missing.push("utilization_coefficient");
  }
  const knownCustomsRub = customsClearance
    + importDutyRub
    + exciseRub
    + vatRub;
  const complete = missing.length === 0
    && utilizationFeeRub !== undefined
    && Boolean(band);
  const totalCustomsRub = complete
    ? knownCustomsRub + utilizationFeeRub
    : undefined;

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
      {
        id: "customs-clearance",
        title: "Таможенный сбор за оформление",
        amountRub: customsClearance,
      },
      {
        id: "import-duty",
        title: pureElectric
          ? "Ввозная пошлина 15%"
          : "Единая ставка таможенных платежей",
        amountRub: importDutyRub,
        note: ageEstimated
          ? `${band}; месяц оценён консервативно`
          : band,
      },
      ...(pureElectric
        ? [
          {
            id: "excise",
            title: "Акциз",
            amountRub: exciseRub,
            note: "Ставка 2026 года по мощности электродвигателя",
          },
          {
            id: "vat",
            title: "НДС 22%",
            amountRub: vatRub,
            note: "Таможенная стоимость + пошлина + акциз",
          },
        ]
        : []),
      {
        id: "utilization-fee",
        title: "Утилизационный сбор",
        amountRub: utilizationFeeRub,
        note: utilizationCoefficient === undefined
          ? "Требуются точные данные"
          : `20 000 ₽ × ${utilizationCoefficient}`,
      },
    ],
  };
}
