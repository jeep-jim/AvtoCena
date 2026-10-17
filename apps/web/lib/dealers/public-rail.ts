import {orderedOffers} from './market-offer';
import {dealerProfilePath} from "./profile-url";
import {publicDealerText} from './public-profile';
import {calculateSpecial,offerAvailability,offerSectionEnabled,offerSectionHeading,offerSectionSubtitle,specialPath,specialTitle,type DealerShowcase} from './showcase-model';
export function publicRail(s: DealerShowcase, city = "", surface: "profile"|"home" = "profile") {
  return (s.specialsEnabled || s.stockEnabled || s.marketEnabled || s.marketHomeEnabled)
    ? orderedOffers(s.offers)
        .filter((o) => o.status === "published" && offerSectionEnabled(s,o) && (o.availability!=="market" || (surface==="home" ? s.marketHomeEnabled : s.marketEnabled)))
        .map((o) => {
          const c = calculateSpecial(s, o, city);
          return {
            id: o.id,
            dealer: {id:s.dealerId,href:dealerProfilePath(s),name:publicDealerText(s.name),logoLight:s.logoLight,logoDark:s.logoDark},
            availability: offerAvailability(o),
            condition: o.condition,
            year: o.year,
            address: offerAvailability(o)==="stock" ? s.offices.find(office=>office.id===o.officeId)?.address : undefined,
            heading: offerSectionHeading(s,offerAvailability(o)),
            subtitle: offerSectionSubtitle(s,offerAvailability(o)),
            href: specialPath(s.dealerId, o.id),
            image: o.photos[0]?.url || "",
            title: specialTitle(o),
            price: c.totalRub,
            calculation: offerAvailability(o)!=="stock" ? {
              showcase: {dealerId:s.dealerId, pricing:s.pricing, offices:[]},
              offer: (({deliveryOriginCity,market,currency,invoice,purchaseTotal,marketQuote,servicesOverride,availability,officeId,year,productionMonth,priceRub,priceUsd,customsIncluded,customsExtraRub,fuel,powerHp,power30MinKw,engineCc,personalUseEligible,defaultCity})=>({deliveryOriginCity,market,currency,invoice,purchaseTotal,marketQuote,servicesOverride,availability,officeId,year,productionMonth,priceRub,priceUsd,customsIncluded,customsExtraRub,fuel,powerHp,power30MinKw,engineCc,personalUseEligible,defaultCity}))(o),
            } : undefined,
            city: c.city,
            daysFrom: c.daysFrom,
            daysTo: c.daysTo,
          };
        })
    : [];
}
