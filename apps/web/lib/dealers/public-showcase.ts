import { readShowcase } from "./showcase-store";
import {
  calculateSpecial,
  parseSpecialId,
  specialTitle,
  specialPath,
  type DealerShowcase,
} from "./showcase-model";
export function publicRail(s: DealerShowcase, city = "") {
  return s.specialsEnabled
    ? s.offers
        .filter((o) => o.status === "published")
        .map((o) => {
          const c = calculateSpecial(s, o, city || o.defaultCity);
          return {
            id: o.id,
            href: specialPath(s.dealerId, o.id),
            image: o.photos[0]?.url || "",
            title: specialTitle(o),
            price: c.totalRub,
            city: c.city,
            daysFrom: c.daysFrom,
            daysTo: c.daysTo,
          };
        })
    : [];
}
export async function getSpecialOffer(value: string, preview = false) {
  const parsed = parseSpecialId(value);
  if (!parsed) return null;
  const showcase = await readShowcase(parsed.dealerId);
  if (!showcase || (!preview && !showcase.specialsEnabled)) return null;
  const offer = showcase.offers.find(
    (o) => o.id === parsed.id && (preview || o.status === "published"),
  );
  return offer ? { showcase, offer } : null;
}
export async function specialLeadSnapshot(id: string, city = "") {
  const found = await getSpecialOffer(id);
  if (!found) return null;
  const { showcase: s, offer: o } = found;
  const c = calculateSpecial(s, o, city || o.defaultCity);
  return {
    id,
    offerId: id,
    title: specialTitle(o),
    href: `https://avtocena.com${specialPath(s.dealerId, o.id)}`,
    image: o.photos[0]?.url || "",
    market: "dealer",
    marketLabel: `Спецпредложение · ${s.name}`,
    dealerId: s.dealerId,
    dealerName: s.name,
    make: o.make,
    model: o.model,
    trim: o.trim,
    year: o.year,
    mileageKm: o.mileageKm,
    engineCc: o.engineCc,
    powerHp: o.powerHp,
    power30MinKw: o.power30MinKw,
    fuel: o.fuel,
    transmission: o.transmission,
    drive: o.drive,
    bodyType: o.body,
    totalRub: c.totalRub,
    sourcePrice: o.priceUsd,
    deliveryQuote: {
      version: "dealer-special-v1",
      origin: "Бишкек",
      city: c.city,
      amountRub: c.complete
        ? c.lines.find((l) => l.id === "delivery")?.amountRub || 0
        : 0,
      distanceKm: null,
      estimated: true,
      status: c.complete ? ("estimated" as const) : ("needs_quote" as const),
    },
    calculationSnapshot: {
      totalRub: c.totalRub,
      city: c.city,
      breakdown: c.lines,
    },
    breakdown: c.lines,
    updatedAt: o.updatedAt,
  };
}
