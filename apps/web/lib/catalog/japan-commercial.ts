const GENERAL_COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|dutro|forward|giga|elf|profia)\b/i;

// Prestige often has no bodyType at all. Keep the public Japan pipeline strict by
// rejecting model identities that are unambiguously commercial in the source.
// Do NOT run a bare `van` check against trim text: Japanese edition names can be
// transliterated into fragments such as "ad Van s" on otherwise passenger cars.
const COMMERCIAL_MODEL_RE = /(?:\bvan\b|^(?:atlas|condor|bongo|bongo\s+van|bongo\s+brawny\s+van|como|clipper\s+ev)$)/i;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isJapanCommercialAuctionOffer(value: {
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  bodyType?: unknown;
}) {
  const make = clean(value?.make);
  const model = clean(value?.model);
  const trim = clean(value?.trim);
  const bodyType = clean(value?.bodyType);

  if (GENERAL_COMMERCIAL_RE.test([make, model, trim, bodyType].filter(Boolean).join(" "))) return true;
  if (COMMERCIAL_MODEL_RE.test(model)) return true;
  return /^(?:truck|light[\s-]*truck|heavy[\s-]*truck|lorry|commercial(?:\s+vehicle)?|bus|coach|special(?:\s+purpose)?(?:\s+vehicle)?|machinery)$/i.test(bodyType);
}
