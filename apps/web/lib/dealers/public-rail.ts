import {calculateSpecial,offerAvailability,offerSectionEnabled,offerSectionHeading,offerSectionSubtitle,specialPath,specialTitle,type DealerShowcase} from './showcase-model';
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
