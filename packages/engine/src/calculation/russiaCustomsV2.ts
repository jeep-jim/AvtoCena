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
  n1IceFuel?: "petrol" | "diesel";
  bodyType?: string;
  make?: string;
  model?: string;
  sourceTitle?: string;
};

export type RussiaCustomsV2Result = RussiaCustomsResult & {
  legalRuleRevision: "rf_personal_vehicle_2026-08-20" | "rf_n1_8704_2026-09-09";
  tariffCode?: string;
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
    return null;
  }
  const compactExact = text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactExact) {
    const year = Number(compactExact[1]);
    const month = Number(compactExact[2]);
    const day = Number(compactExact[3]);
    if (validDateParts(year, month, day)) return { year, month, day, basis: "exact_date" };
    return null;
  }
  const monthKnown = text.match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])$/)
    || text.match(/\b((?:19|20)\d{2})(0[1-9]|1[0-2])\b/);
  if (monthKnown) return { year: Number(monthKnown[1]), month: Number(monthKnown[2]), day: 15, basis: "month_midpoint" };
  if (text && !/^(19|20)\d{2}$/.test(text)) return null;
  const year = Number(input.year || text.match(/\b(?:19|20)\d{2}\b/)?.[0]);
  if (Number.isInteger(year) && year >= 1900) return { year, month: 7, day: 1, basis: "year_midpoint" };
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

export function normalizedCategory(input: Pick<RussiaCustomsV2Input, "vehicleCategory" | "tnVedCode" | "bodyType" | "make" | "model" | "sourceTitle">) {
  const explicit = String(input.vehicleCategory || "").trim().toUpperCase();
  if (explicit === "M1" || explicit === "N1") return { category: explicit as "M1" | "N1", assumed: false };
  const tnVed = String(input.tnVedCode || "").replace(/\D/g, "");
  if (tnVed.startsWith("8704")) return { category: "N1" as const, assumed: false };
  const body = String(input.bodyType || "").toLowerCase();
  const identity = `${String(input.make || "")} ${String(input.model || "")} ${String(input.sourceTitle || "")}`.toLowerCase();
  const pickupBody = /\b(?:pickup|pick-up|light\s*truck|truck|commercial)\b|пикап|груз/.test(body);
  const pickupModel = /\b(?:hilux|tacoma|tundra|ranger|amarok|colorado|gladiator|navara|frontier|d-?max|triton|l200|musso|rexton\s+sports|silverado|f-?150|ram\s*1500|poer|cannon)\b/.test(identity);
  if (pickupBody || pickupModel) {
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
  const code = String(input.tnVedCode || "").replace(/\D/g, "");
  if (input.vehicleCategory === "M1" && code.startsWith("8704")) return blockedCategoryResult(input,"M1","tn_ved_conflict","Категория M1 противоречит грузовому коду ТН ВЭД 8704.",false);
  const personalUseAssumed = input.personalUseEligible === undefined;
  const personalUseEligible = input.personalUseEligible !== false;

  if (category.category === "N1") {
    return calculateN1Customs(input);
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
  if (!reference || !Number.isFinite(importedAt.getTime()) || utcDateOnly(importedAt) < referenceTimestamp(reference)) return blockedCategoryResult(input,"M1","production_date","Дата выпуска должна быть не позже даты ввоза.",personalUseAssumed);
  if (importedAt.getUTCFullYear() !== 2026) return blockedCategoryResult(input,"M1","tariff_year","Для выбранного года ввоза нужны ставки этого года; таблица расчёта действует в 2026 году.",personalUseAssumed);
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
  if (reference && reference.basis !== "exact_date") warnings.push(reference.basis === "month_midpoint"
    ? "День выпуска неизвестен: для расчёта принято 15-е число указанного месяца. Уточните день перед переходом возрастной границы."
    : "Месяц выпуска неизвестен: для расчёта принято 1 июля указанного года. Уточните дату перед переходом возрастной границы.");
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
      ageEstimated: reference.basis !== "exact_date",
      possibleAgeBands: legalBand ? [legalBand] : [],
      productionReferenceDate: `${reference.year}-${pad(reference.month)}-${pad(reference.day)}`,
      productionReferenceBasis: reference.basis,
    } : {}),
    warnings,
  };
}


/** Ordinary complete N1 goods vehicles, direct import, standard EAEU tariff.
 * Source: EEC group 87 (22.01.2026), pp. 71–86; PP1291 section II rows 5/6.
 * Category and gross mass are supplied evidence/scenario inputs, never inferred
 * from a pickup photo, curb weight or the passenger-car 160 hp threshold.
 */
function calculateN1Customs(input: RussiaCustomsV2Input): RussiaCustomsV2Result {
  const date = input.importedAt || new Date();
  const reference = legalProductionReference(input);
  const mass = positive(input.grossVehicleWeightKg);
  const value = positive(input.customsValueRub);
  const eur = positive(input.eurRateRub);
  const cc = positive(input.engineCc);
  const kind = powertrainKind(input);
  const hybrid = kind === "other_hybrid";
  const electric = kind === "electric" || kind === "series_hybrid";
  const fuel = hybrid ? input.n1IceFuel : input.fuel;
  const diesel = /diesel|дизель/i.test(String(fuel || ""));
  const spark = /^(petrol|lpg|cng|бензин)$/i.test(String(fuel || ""));
  const missing: string[] = [];
  if (!value) missing.push("customs_value");
  if (!eur) missing.push("eur_rate");
  if (!reference || !Number.isFinite(date.getTime()) || (reference && utcDateOnly(date) < referenceTimestamp(reference))) missing.push("production_date");
  if (!mass || mass > 3500) missing.push("gross_vehicle_weight_kg");
  if (date.getUTCFullYear() !== 2026) missing.push("n1_tariff_year");
  if (!electric && !cc) missing.push("engine_cc");
  if (!electric && !diesel && !spark) missing.push(hybrid ? "n1_ice_fuel" : "fuel");
  const electricKw = sumPower(input.power30MinKwByMotor) || positive(input.power30MinKw);
  const iceKw = positive(input.icePowerKw);
  if (hybrid && (!electricKw || !iceKw)) missing.push("n1_hybrid_power");
  const base = blockedCategoryResult(input,"N1",missing[0] || "n1_parameters", "Укажите параметры грузового расчёта в карточке.",false);
  base.ruleVersion = "rf_n1_8704_2026-09-09";
  base.legalRuleRevision = "rf_n1_8704_2026-09-09";
  if (missing.length || !reference || !mass || !value || !eur) return {...base,missing};
  const after = (years: number) => utcDateOnly(date) > referenceTimestamp(reference,years);
  // Customs defines used as >= 3 years; PP1291 uses > 3 years for the higher coefficient.
  const newForDuty = utcDateOnly(date) < referenceTimestamp(reference,3);
  const over5 = after(5), over7 = after(7), usedForUtil = after(3);
  const iceDominant = !hybrid || iceKw! > electricKw!;
  const prefix = electric ? "870460" : hybrid ? (diesel ? "870441" : "870451") : diesel ? "870421" : "870431";
  const largeEngine = cc! > (diesel ? 2500 : 2800);
  let tariffCode: string;
  let rate = 0.15, minimumEuroPerCc = 0;
  if (electric) tariffCode = "8704600000";
  else if (hybrid) {
    const family = largeEngine ? (newForDuty ? "310" : "390") : (newForDuty ? "910" : "990");
    tariffCode = prefix + family + (!iceDominant ? "9" : newForDuty ? "1" : over7 ? "1" : over5 ? "2" : "3");
  } else {
    const family = largeEngine ? (newForDuty ? "320" : "380") : (newForDuty ? "920" : "980");
    tariffCode = prefix + family + (newForDuty ? "0" : over7 ? "1" : over5 ? "2" : "9");
  }
  if (!electric && iceDominant) {
    rate = diesel ? 0.10 : newForDuty && largeEngine ? 0.125 : 0.15;
    if (over7) { rate = 0; minimumEuroPerCc = 1; }
    else if (diesel && !largeEngine && over5) minimumEuroPerCc = 0.13;
  }
  const suppliedCode = String(input.tnVedCode || "").replace(/\D/g, "");
  // Do not quietly replace conflicting or specialized customs classifications.
  if (suppliedCode && !tariffCode.startsWith(suppliedCode)) return {...base,missing:["tn_ved_conflict"],warnings:["Код ТН ВЭД не соответствует указанным параметрам грузового автомобиля."]};
  const importDutyRub = Math.round(Math.max(value * rate, (cc || 0) * minimumEuroPerCc * eur));
  const vatRub = Math.round((value + importDutyRub) * 0.22);
  const utilizationCoefficient = mass <= 2500 ? (usedForUtil ? 8.91 : 6.13) : (usedForUtil ? 9.61 : 6.6);
  const utilizationFeeRub = Math.round(150000 * utilizationCoefficient);
  const clearance = customsClearanceFeeRub(value);
  const knownCustomsRub = clearance + importDutyRub + vatRub;
  return {...base, status:"ready", missing:[], tariffCode,
    ageMonths:completedLegalMonths(reference,date),ageBand:legalVehicleAgeBand(reference,date),
    ageEstimated:reference.basis !== "exact_date", productionReferenceBasis:reference.basis,
    productionReferenceDate:`${reference.year}-${pad(reference.month)}-${pad(reference.day)}`,
    importDutyRub,vatRub,exciseRub:0,utilizationCoefficient,utilizationFeeRub,knownCustomsRub,
    totalCustomsRub:knownCustomsRub + utilizationFeeRub,
    warnings:["Расчёт N1 по стандартному тарифу 8704 для прямого ввоза в РФ; категория, масса и классификация должны соответствовать документам автомобиля."],
    breakdown:[
      {id:"customs-clearance",title:"Таможенный сбор за оформление",amountRub:clearance},
      {id:"import-duty",title:"Ввозная пошлина N1",amountRub:importDutyRub,note:`ТН ВЭД ${tariffCode}; ${rate*100}%${minimumEuroPerCc ? `; минимум ${minimumEuroPerCc} €/см³` : ""}`},
      {id:"excise",title:"Акциз",amountRub:0,note:"Грузовое транспортное средство 8704"},
      {id:"vat",title:"НДС 22%",amountRub:vatRub,note:"(Таможенная стоимость + пошлина) × 22%"},
      {id:"utilization",title:"Утилизационный сбор N1",amountRub:utilizationFeeRub,note:`150 000 ₽ × ${utilizationCoefficient}; полная масса ${mass} кг`},
    ]};
}

export { customsClearanceFeeRub, utilizationCoefficient2026, utilizationPowerKwForInput };
export type { RussiaCustomsAgeBand, RussiaCustomsInput, RussiaCustomsResult, RussiaPowertrainKind };
