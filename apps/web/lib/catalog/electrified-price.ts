export function isElectrifiedPrice(offer: {fuel?: unknown; fuelLabel?: unknown; powertrainKind?: unknown}) {
 return ["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || "").toLowerCase()) || /(?:electric|battery|\bbev\b|\bev\b|hybrid|phev|hev|mhev|электро|гибрид)/i.test(`${offer.fuel || ""} ${offer.fuelLabel || ""}`);
}
