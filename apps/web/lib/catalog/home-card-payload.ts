function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Browser cards need the resolved values and evidence status. Keep the full
// bibliography on the server offer used for pricing and detail processing.
export function homeCardPayload<T extends object>(offer: T) {
  const operational = 'operational' in offer ? offer.operational : undefined;
  if (!record(operational) || !record(operational.semanticEvidence)) return offer;

  const evidence = Object.entries(operational.semanticEvidence);
  if (!evidence.some(([, fact]) => record(fact) && Array.isArray(fact.provenance))) return offer;
  const semanticEvidence = Object.fromEntries(evidence.map(([key, fact]) => {
    if (!record(fact) || !Array.isArray(fact.provenance)) return [key, fact];
    const { provenance, ...summary } = fact;
    return [key, summary];
  }));
  return { ...offer, operational: { ...operational, semanticEvidence } };
}
