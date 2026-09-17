const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

export function isCommercialInventoryOffer(offer) {
  // Owner-approved ProAuctions example (17 Sep 2026): the S321V kei van
  // must not be rejected merely because its model is literally "Hijet Cargo".
  // This does not attest M1/N1 or authorize a customs calculation.
  if (offer.market === 'japan' && offer.sourceId === 'proauctions_japan_stat'
    && offer.make === 'Daihatsu' && offer.model === 'Hijet Cargo'
    && offer.operational?.chassisCode === 'S321V') return false;
  if (/^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ''))) return true;
  // Ford Ranger and the ordinary body label "pickup truck" are pickups.
  // Their customs category/mass still require the normal calculation evidence.
  const text = `${offer?.make || ''} ${offer?.model || ''} ${offer?.trim || ''} ${offer?.bodyType || ''}`
    .replace(/\bpick[ -]?up\s+truck\b/gi, 'pickup');
  return COMMERCIAL_RE.test(text);
}
