import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getOffer } from "./storage";

// The offer id is stable across catalog generations. Keep a short shared cache
// so a route prefetch warms the actual offer for the following click, including
// when Yandex sends both requests through the same provisioned container.
// Sixty seconds is deliberately short: refreshed price/photo data becomes
// visible quickly after a catalog publication while navigation avoids repeating
// manifest + location-index + offer-chunk reads.
const getOfferAcrossRequests = unstable_cache(
  async (id: string) => getOffer(id),
  ["catalog-offer-page-v1"],
  { revalidate: 60 },
);

async function resilientOfferLookup(id: string) {
  // A transient miss during a catalog publication must not turn a live card
  // into a cached 404 for the full revalidation window. Retry the authoritative
  // reader once outside the shared cache when the cached lookup misses or its
  // storage read fails.
  try {
    const cached = await getOfferAcrossRequests(id);
    if (cached) return cached;
  } catch {
    // Fall through to the authoritative retry below.
  }
  return getOffer(id);
}

// Metadata and the page render also share the lookup inside one request.
export const getOfferForPage = cache((id: string) => resilientOfferLookup(id));
