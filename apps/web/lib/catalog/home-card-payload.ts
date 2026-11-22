function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The list needs the resolved values and evidence status. The source records
// for each value remain on the full offer used by pricing and detail pages.
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
