import { PERSONAL_COMBUSTION_LIMIT_KW } from "../../../../packages/engine/src/calculation/russiaCustoms";

export type RecyclingPowerInput = {
  powerHp?: unknown; powerKw?: unknown; icePowerKw?: unknown; fuel?: unknown;
  powertrainKind?: unknown; vehicleCategory?: unknown; tnVedCode?: unknown;
};
export type RecyclingPowerInfo = {
  kw: number; kwLabel: string; hp: number | null; hpLabel: string;
  aboveLimit: boolean; borderline: boolean; reason: string;
};
function positive(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(typeof value === "string" ? value.trim().replace(",", ".") : value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function formatPowerNumber(value: number): string {
  return new Intl.NumberFormat("ru-RU", { useGrouping: false, maximumFractionDigits: 5 }).format(value);
}
/** Display only. Never reconstruct source kW from rounded display horsepower.
 * EVs, hybrids and N1 have different power/category rules and are not classified here. */
export function recyclingPowerInfo(input: RecyclingPowerInput): RecyclingPowerInfo | null {
  const fuel = String(input.fuel || "").toLowerCase();
  const kind = String(input.powertrainKind || "").toLowerCase();
  const category = String(input.vehicleCategory || "").toUpperCase();
  if (category && category !== "M1") return null;
  if (String(input.tnVedCode || "").replace(/\D/g, "").startsWith("8704")) return null;
  if (kind && kind !== "unknown" && kind !== "combustion") return null;
  if (/electric|battery|bev|hybrid|phev|hev|электро|гибрид|последователь/.test(fuel)) return null;
  if (kind !== "combustion" && !["petrol", "diesel", "lpg", "cng", "бензин", "дизель"].includes(fuel)) return null;
  const kw = positive(input.powerKw) ?? positive(input.icePowerKw);
  if (kw === null) return null;
  const hp = positive(input.powerHp);
  const kwLabel = `${formatPowerNumber(kw)} кВт`;
  const aboveLimit = kw > PERSONAL_COMBUSTION_LIMIT_KW;
  return {
    kw, kwLabel, hp, hpLabel: hp === null ? "" : `${formatPowerNumber(hp)} л.с.`,
    aboveLimit, borderline: aboveLimit && hp !== null && hp <= 160,
    reason: aboveLimit
      ? `${kwLabel} > 117,68 кВт. Для M1 с ДВС превышен порог мощности льготного утильсбора.`
      : `${kwLabel} — порог мощности 117,68 кВт не превышен. Остальные условия льготы проверяются отдельно.`,
  };
}
