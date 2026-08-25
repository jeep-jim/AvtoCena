import type { Currency } from "../types";

export type RussiaCustomsAgeBand = "up_to_3_years" | "from_3_to_5_years" | "over_5_years";

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
  powertrainKind?: "combustion" | "electric" | "series_hybrid" | "other_hybrid" | "unknown";
  productionDate?: string;
  year?: number;
  fuel?: string;
  vehicleCategory?: "M1" | "N1" | "unknown";
  tnVedCode?: string;
  grossVehicleWeightKg?: number;
  bodyType?: string;
  make?: string;
  model?: string;
  sourceTitle?: string;
  personalUseEligible?: boolean;
  importedAt?: Date;
};

export type RussiaCustomsResult = {
  status: "ready" | "needs_data";
  ageBand: RussiaCustomsAgeBand;
  vehicleCategory: "M1" | "N1" | "unknown";
  personalUseEligible: boolean;
  customsClearanceRub: number;
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
// Используем именно колонку 01.01.2026–31.12.2026 по дате ввоза; следующая
// годовая пара в официальной таблице относится уже к 2027 году. Мощность — кВт.
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

function legalProductionReference(input: RussiaCustomsInput) {
  const production = parseProductionMonth(input.productionDate, input.year);
  if (!production) return null;
  const importedAt = input.importedAt || new Date();
  const candidates = possibleProductionMonths(production, importedAt)
    .map((item) => ({ item, age: ageBand(completedMonths(item, importedAt)) }));
  const unique = [...new Set(candidates.map((item) => item.age))];
  if (unique.length !== 1) return null;
  const item = candidates[Math.floor((candidates.length - 1) / 2)]?.item || candidates[0]?.item;
  if (!item) return null;
  return { production: item, ageBand: unique[0], importedAt };
}

function vehicleCategoryForInput(input: RussiaCustomsInput) {
  const explicit = String(input.vehicleCategory || "").toUpperCase();
  if (explicit === "M1" || explicit === "N1") return explicit as "M1" | "N1";
  const text = `${input.tnVedCode || ""} ${input.bodyType || ""} ${input.make || ""} ${input.model || ""} ${input.sourceTitle || ""}`.toLowerCase();
  if (/\b8704\b|\bn1\b|pickup|pick-up|пикап|cargo|commercial/.test(text)) return "N1";
  if (/sedan|suv|crossover|coupe|hatch|wagon|minivan|mpv|roadster|convertible|cabrio|offroad|кроссовер|седан|хэтч|универсал|минивэн|купе/.test(text)) return "M1";
  return "unknown";
}

function personalUseEligible(input: RussiaCustomsInput, category: "M1" | "N1" | "unknown") {
  if (typeof input.personalUseEligible === "boolean") return input.personalUseEligible;
  if (category !== "M1") return false;
  return true;
}

export function customsClearanceFeeRub(customsValueRub: number) {
  if (customsValueRub <= 200_000) return 1_231;
  if (customsValueRub <= 450_000) return 2_462;
  if (customsValueRub <= 1_200_000) return 4_924;
  if (customsValueRub <= 2_700_000) return 13_541;
  if (customsValueRub <= 4_200_000) return 18_465;
  if (customsValueRub <= 5_500_000) return 24_617;
  if (customsValueRub <= 7_000_000) return 27_079;
  return 30_800;
}

const UP_TO_3_YEARS_DUTY = [
  { maxEur: 8_500, rate: 0.54, minEurPerCc: 2.5 },
  { maxEur: 16_700, rate: 0.48, minEurPerCc: 3.5 },
  { maxEur: 42_300, rate: 0.48, minEurPerCc: 5.5 },
  { maxEur: 84_500, rate: 0.48, minEurPerCc: 7.5 },
  { maxEur: 169_000, rate: 0.48, minEurPerCc: 15 },
  { maxEur: Infinity, rate: 0.48, minEurPerCc: 20 },
];

function dutyForYoungVehicle(customsValueRub: number, eurRateRub: number, engineCc: number) {
  const customsValueEur = customsValueRub / eurRateRub;
  const row = UP_TO_3_YEARS_DUTY.find((item) => customsValueEur <= item.maxEur) || UP_TO_3_YEARS_DUTY[UP_TO_3_YEARS_DUTY.length - 1];
  return Math.round(Math.max(customsValueRub * row.rate, engineCc * row.minEurPerCc * eurRateRub));
}

function dutyForUsedVehicle(engineCc: number, eurRateRub: number, ageBandValue: RussiaCustomsAgeBand) {
  const old = ageBandValue === "over_5_years";
  const eurPerCc = engineCc <= 1_000 ? (old ? 3 : 1.5)
    : engineCc <= 1_500 ? (old ? 3.2 : 1.7)
      : engineCc <= 1_800 ? (old ? 3.5 : 2.5)
        : engineCc <= 2_300 ? (old ? 4.8 : 2.7)
          : engineCc <= 3_000 ? (old ? 5 : 3)
            : (old ? 5.7 : 3.6);
  return Math.round(engineCc * eurPerCc * eurRateRub);
}

function exactThirtyMinutePower(input: RussiaCustomsInput) {
  const byMotor = Array.isArray(input.power30MinKwByMotor)
    ? input.power30MinKwByMotor.map(positive).filter((item): item is number => Boolean(item))
    : [];
  return positive(input.power30MinKw) || (byMotor.length ? byMotor.reduce((sum, item) => sum + item, 0) : undefined);
}

export function utilizationPowerKwForInput(input: RussiaCustomsInput) {
  const explicit = positive(input.utilizationPowerKw);
  if (explicit) return explicit;
  const kind = input.powertrainKind || "combustion";
  const motor = exactThirtyMinutePower(input);
  if (kind === "electric") return motor;
  if (kind === "series_hybrid" || kind === "other_hybrid") {
    const ice = positive(input.icePowerKw);
    if (!ice || !motor) return undefined;
    return ice + motor;
  }
  return positive(input.powerKw) || (positive(input.powerHp) ? Number(input.powerHp) * 0.73549875 : undefined);
}

function electricExcisePowerKw(input: RussiaCustomsInput) {
  if (input.powertrainKind === "electric") return exactThirtyMinutePower(input);
  return undefined;
}

function combustionExcisePowerHp(input: RussiaCustomsInput) {
  if (input.powertrainKind === "combustion" || !input.powertrainKind) {
    return positive(input.powerHp) || (positive(input.powerKw) ? Number(input.powerKw) / 0.73549875 : undefined);
  }
  return undefined;
}

function utilizationCoefficientForPower(input: RussiaCustomsInput, utilizationPowerKw: number, ageBandValue: RussiaCustomsAgeBand) {
  const used = ageBandValue !== "up_to_3_years";
  const kind = input.powertrainKind || "combustion";
  if (kind === "electric" || kind === "series_hybrid" || kind === "other_hybrid") {
    return coefficient(EV_2026, utilizationPowerKw, used);
  }
  const cc = Number(input.engineCc || 0);
  if (cc <= 1_000) return coefficient(ICE_UP_TO_1000_2026, utilizationPowerKw, used);
  if (cc <= 2_000) return coefficient(ICE_1000_TO_2000_2026, utilizationPowerKw, used);
  if (cc <= 3_000) return coefficient(ICE_2000_TO_3000_2026, utilizationPowerKw, used);
  if (cc <= 3_500) return coefficient(ICE_3000_TO_3500_2026, utilizationPowerKw, used);
  return coefficient(ICE_OVER_3500_2026, utilizationPowerKw, used);
}

export function utilizationCoefficient2026(input: RussiaCustomsInput, utilizationPowerKw: number, ageBandValue: RussiaCustomsAgeBand) {
  const personalEligible = personalUseEligible(input, vehicleCategoryForInput(input));
  const kind = input.powertrainKind || "combustion";
  if (personalEligible && ageBandValue === "up_to_3_years") {
    if (kind === "combustion" && Number(input.engineCc || 0) <= PERSONAL_COMBUSTION_LIMIT_CC && utilizationPowerKw <= PERSONAL_COMBUSTION_LIMIT_KW) return 0.17;
    if (kind === "electric" && utilizationPowerKw <= PERSONAL_ELECTRIC_LIMIT_KW) return 0.17;
  }
  if (personalEligible && ageBandValue !== "up_to_3_years") {
    if (kind === "combustion" && Number(input.engineCc || 0) <= PERSONAL_COMBUSTION_LIMIT_CC && utilizationPowerKw <= PERSONAL_COMBUSTION_LIMIT_KW) return 0.26;
    if (kind === "electric" && utilizationPowerKw <= PERSONAL_ELECTRIC_LIMIT_KW) return 0.26;
  }
  return utilizationCoefficientForPower(input, utilizationPowerKw, ageBandValue);
}

function coefficient(table: CoefficientRow[], powerKw: number, used: boolean) {
  const row = table.find((item) => powerKw <= item.maxKw) || table[table.length - 1];
  return used ? row.usedVehicle : row.newVehicle;
}

function exciseRateRubPerHp(powerHp: number) {
  if (powerHp <= 90) return 0;
  if (powerHp <= 150) return 61;
  if (powerHp <= 200) return 583;
  if (powerHp <= 300) return 955;
  if (powerHp <= 400) return 1_628;
  if (powerHp <= 500) return 1_685;
  return 1_740;
}

function exciseRubForPowerHp(powerHp: number) {
  return Math.round(powerHp * exciseRateRubPerHp(powerHp));
}

function zeroDutyVehicle(input: RussiaCustomsInput) {
  const text = `${input.tnVedCode || ""} ${input.fuel || ""}`.toLowerCase();
  return input.powertrainKind === "electric" || /\b8703\s*80\b/.test(text);
}

function passengerCustoms(input: RussiaCustomsInput, ageBandValue: RussiaCustomsAgeBand) {
  const engineCc = positive(input.engineCc);
  const kind = input.powertrainKind || "combustion";
  if (!zeroDutyVehicle(input) && !engineCc) return { dutyRub: 0, exciseRub: 0, vatRub: 0, missing: ["engine_cc"] };
  if (zeroDutyVehicle(input)) {
    const powerKw = electricExcisePowerKw(input);
    if (!powerKw) return { dutyRub: 0, exciseRub: 0, vatRub: 0, missing: ["electric_excise_power_kw"] };
    const powerHp = powerKw / 0.73549875;
    const exciseRub = exciseRubForPowerHp(powerHp);
    const dutyRub = Math.round(input.customsValueRub * EV_IMPORT_DUTY_RATE);
    const vatRub = Math.round((input.customsValueRub + dutyRub + exciseRub) * VAT_RATE_2026);
    return { dutyRub, exciseRub, vatRub, missing: [] as string[] };
  }
  const dutyRub = ageBandValue === "up_to_3_years"
    ? dutyForYoungVehicle(input.customsValueRub, input.eurRateRub, engineCc!)
    : dutyForUsedVehicle(engineCc!, input.eurRateRub, ageBandValue);
  return { dutyRub, exciseRub: 0, vatRub: 0, missing: [] as string[] };
}

export function calculateRussiaCustomsForIndividual(input: RussiaCustomsInput): RussiaCustomsResult {
  const production = legalProductionReference(input);
  const category = vehicleCategoryForInput(input);
  const personalEligible = personalUseEligible(input, category);
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!production) missing.push("production_date");
  if (category === "unknown") missing.push("vehicle_category");
  if (category === "N1") missing.push("n1_customs_tariff");

  const ageBandValue = production?.ageBand || "up_to_3_years";
  const customsClearanceRub = customsClearanceFeeRub(input.customsValueRub);
  const utilizationPowerKw = utilizationPowerKwForInput(input);
  if (!utilizationPowerKw) missing.push("utilization_power_kw");

  const passenger = category === "M1" ? passengerCustoms(input, ageBandValue) : { dutyRub: 0, exciseRub: 0, vatRub: 0, missing: [] as string[] };
  missing.push(...passenger.missing);

  const utilizationCoefficient = utilizationPowerKw
    ? utilizationCoefficient2026(input, utilizationPowerKw, ageBandValue)
    : undefined;
  const utilizationFeeRub = utilizationCoefficient ? Math.round(UTILIZATION_BASE_RUB * utilizationCoefficient) : undefined;

  const knownCustomsRub = customsClearanceRub + passenger.dutyRub + passenger.exciseRub + passenger.vatRub + (utilizationFeeRub || 0);
  const totalCustomsRub = missing.length ? undefined : knownCustomsRub;
  if (!personalEligible) warnings.push("Льготный утилизационный коэффициент для личного использования не применён.");
  if (missing.includes("utilization_power_kw")) warnings.push("Для расчёта утилизационного сбора требуется мощность в кВт по правилам категории M1.");
  if (missing.includes("vehicle_category")) warnings.push("Категория транспортного средства не подтверждена. Расчёт M1 не применяется автоматически.");
  if (missing.includes("n1_customs_tariff")) warnings.push("Для N1 требуется отдельная таможенная методика; тариф M1 не применяется.");

  return {
    status: missing.length ? "needs_data" : "ready",
    ageBand: ageBandValue,
    vehicleCategory: category,
    personalUseEligible: personalEligible,
    customsClearanceRub,
    importDutyRub: passenger.dutyRub,
    exciseRub: passenger.exciseRub,
    vatRub: passenger.vatRub,
    utilizationPowerKw,
    utilizationCoefficient,
    utilizationFeeRub,
    knownCustomsRub,
    totalCustomsRub,
    missing: [...new Set(missing)],
    warnings,
    breakdown: [
      { id: "customs-clearance", title: "Таможенное оформление", amountRub: customsClearanceRub },
      { id: "import-duty", title: "Единая ставка / пошлина", amountRub: passenger.dutyRub },
      { id: "excise", title: "Акциз", amountRub: passenger.exciseRub },
      { id: "vat", title: "НДС", amountRub: passenger.vatRub },
      { id: "utilization-fee", title: "Утилизационный сбор", amountRub: utilizationFeeRub },
    ],
  };
}
