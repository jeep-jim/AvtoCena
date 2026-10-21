export type VehicleResearchIdentity = {
  make?: string; model?: string; trim?: string; year?: number;
  market?: string; chassisCode?: string; powertrainKind?: string;
};

const MARKETS: Record<string, string> = {
  japan: "рынок Японии", china: "рынок Китая", korea: "рынок Кореи",
  uae: "рынок ОАЭ", europe: "рынок Европы", georgia: "рынок Грузии",
};
const clean = (value?: string) => String(value || "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);

export function vehicleResearchUrl(identity: VehicleResearchIdentity): string | null {
  const make = clean(identity.make), model = clean(identity.model);
  if (!make || !model) return null;
  const year = Number.isInteger(identity.year) && identity.year! >= 1900 && identity.year! <= new Date().getUTCFullYear() + 1 ? String(identity.year) : "";
  const question = identity.powertrainKind === "electric" || identity.powertrainKind === "series_hybrid"
    ? "характеристики двигателя 30-минутная мощность"
    : "характеристики двигателя мощность объём тип топлива";
  // Do not seed search with the possibly wrong horsepower being checked.
  // VIN/frame number and the visitor's manual inputs never enter this query.
  const text = [question, make, model, year, clean(identity.trim), clean(identity.chassisCode), MARKETS[identity.market || ""]].filter(Boolean).join(" ");
  const url = new URL("https://yandex.ru/search/");
  url.searchParams.set("text", text);
  return url.toString();
}
