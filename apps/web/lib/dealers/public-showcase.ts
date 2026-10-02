import {readDataJson} from '../data';
import {normalizeCitySearch} from '../location/cities';
import {PILOT_DEALER_ID} from './showcase-model';
import {availableShowcase} from './program-store';
import {withDealerRate} from './exchange-rate';
import { readShowcase } from "./showcase-store";
import {
  calculateSpecial,
  offerAvailability, offerAvailabilityLabel, offerSectionEnabled, offerSectionHeading, offerSectionSubtitle,
  parseSpecialId,
  specialTitle,
  specialPath,
  type DealerShowcase,
} from "./showcase-model";
export function publicRail(s: DealerShowcase, city = "") {
  return (s.specialsEnabled || s.stockEnabled)
    ? s.offers
        .filter((o) => o.status === "published" && offerSectionEnabled(s,o))
        .map((o) => {
          const c = calculateSpecial(s, o);
          return {
            id: o.id,
            availability: offerAvailability(o),
            condition: o.condition,
            address: offerAvailability(o)==="stock" ? s.offices.find(office=>office.id===o.officeId)?.address : undefined,
            heading: offerSectionHeading(s,offerAvailability(o)),
            subtitle: offerSectionSubtitle(s,offerAvailability(o)),
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
  const stored = await readShowcase(parsed.dealerId);
  const showcase = stored ? await withDealerRate(preview?stored:await availableShowcase(stored)) : null;
  if (!showcase) return null;
  const offer = showcase.offers.find(
    (o) => o.id === parsed.id && (preview || (o.status === "published" && offerSectionEnabled(showcase,o))),
  );
  return offer ? { showcase, offer } : null;
}
export async function specialLeadSnapshot(id: string, city = "") {
  const found = await getSpecialOffer(id);
  if (!found) return null;
  const { showcase: s, offer: o } = found;
  const c = calculateSpecial(s, o);
  return {
    id,
    offerId: id,
    title: specialTitle(o),
    href: `https://avtocena.com${specialPath(s.dealerId, o.id)}`,
    image: o.photos[0]?.url || "",
    market: "dealer",
    marketLabel: `${offerAvailabilityLabel(o)} · ${s.name}`,
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
    sourcePrice: offerAvailability(o)==="stock" ? o.priceRub : o.priceUsd,
    sourceCurrency: offerAvailability(o)==="stock" ? "RUB" : "USD",
    deliveryQuote: offerAvailability(o)==="stock" ? undefined : {
      version: "dealer-special-v1",
      origin: s.pricing.originCity || "Бишкек",
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

/** Geography filters dealers by office location, never by their shipping tariffs. */
export function selectCityShowcases(showcases:DealerShowcase[],city:string){
 const onlyPilot=!showcases.some(s=>s.dealerId!==PILOT_DEALER_ID);
 const key=normalizeCitySearch(city);
 return showcases.filter(s=>!key||(onlyPilot&&s.dealerId===PILOT_DEALER_ID)||s.offices.some(o=>normalizeCitySearch(o.city)===key));
}
export async function homeSpecialRail(city:string,pilot:DealerShowcase|null){
 const rows=await readDataJson<{id:string;status?:string}[]>('dealers/dealers.json',[]);
 const others=await Promise.all(rows.filter(d=>d.id!==PILOT_DEALER_ID&&d.status==='verified').map(async d=>{
  const stored=await readShowcase(d.id);if(!stored)return null;
  const s=await availableShowcase(stored);return s.profileEnabled?s:null;
 }));
 const showcases=[...(pilot?[pilot]:[]),...others.filter((s):s is DealerShowcase=>!!s)];
 const selected=selectCityShowcases(showcases,city);
 const priced=await Promise.all(selected.map(s=>(s.specialsEnabled?withDealerRate(s):Promise.resolve(s))));
 return {heading:priced.length===1?priced[0].specialHeading:'Предложения дилеров',items:priced.flatMap(s=>publicRail(s))};
}
