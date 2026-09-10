const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

export function isCommercialInventoryOffer(offer) {
  if (/^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ''))) return true;
  // Ford Ranger and the ordinary body label "pickup truck" are pickups.
  // Their customs category/mass still require the normal calculation evidence.
  const text = `${offer?.make || ''} ${offer?.model || ''} ${offer?.trim || ''} ${offer?.bodyType || ''}`
    .replace(/\bpick[ -]?up\s+truck\b/gi, 'pickup');
  return COMMERCIAL_RE.test(text);
}
