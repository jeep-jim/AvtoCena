import {calculateSpecial,offerAvailability,offerSectionEnabled,offerSectionHeading,offerSectionSubtitle,specialPath,specialTitle,type DealerShowcase} from './showcase-model';
export function publicRail(s: DealerShowcase, city = "") {
  return (s.specialsEnabled || s.stockEnabled)
    ? s.offers
        .filter((o) => o.status === "published" && offerSectionEnabled(s,o))
        .map((o) => {
          const c = calculateSpecial(s, o, city || undefined);
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
            calculation: offerAvailability(o)==="order" ? {
              showcase: {dealerId:s.dealerId, pricing:s.pricing, offices:[]},
              offer: (({availability,officeId,year,productionMonth,priceRub,priceUsd,customsIncluded,customsExtraRub,fuel,powerHp,power30MinKw,engineCc,personalUseEligible,defaultCity})=>({availability,officeId,year,productionMonth,priceRub,priceUsd,customsIncluded,customsExtraRub,fuel,powerHp,power30MinKw,engineCc,personalUseEligible,defaultCity}))(o),
            } : undefined,
            city: c.city,
            daysFrom: c.daysFrom,
            daysTo: c.daysTo,
          };
        })
    : [];
}
