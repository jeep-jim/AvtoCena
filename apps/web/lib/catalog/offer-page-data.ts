import {attachManagementKnowledge} from './management-knowledge';
import {CollectionDisabledError} from './collection-controls';
import {AjesUnavailable} from './ajes-client';
import {readCatalogEditorial,editorialHidden,applyCatalogEditorial} from "./editorial";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getOfferWithoutEditorial, getOfferFromCurrentShard, getOfferFromCurrentProjection, isJapanCatalogOfferId } from "./storage";

// The offer id is stable across catalog generations. Keep a short shared cache
// so a route prefetch warms the actual offer for the following click, including
// when Yandex sends both requests through the same provisioned container.
// Sixty seconds is deliberately short: refreshed price/photo data becomes
// visible quickly after a catalog publication while navigation avoids repeating
// manifest + location-index + offer-chunk reads.
const getOfferAcrossRequests = unstable_cache(
  async (id: string) => getOfferWithoutEditorial(id),
  ["catalog-offer-page-publication-20261013"],
  { revalidate: 60 },
);

async function resilientOfferLookup(id: string) {
  if (/^ajes-(?:stats|korea|china)-[A-Za-z0-9_-]{1,64}$/.test(id)) return getOfferWithoutEditorial(id);
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
  return getOfferWithoutEditorial(id);
}

// Metadata and the page render also share the lookup inside one request.
export const getOfferForPage = cache(async (id: string) => {
 const [offer,index]=await Promise.all([resilientOfferLookup(id),readCatalogEditorial()]);
 return offer&&!editorialHidden(offer,index)?(await attachManagementKnowledge([applyCatalogEditorial(offer,index)]))[0]:null;
});

// The same authoritative record feeds the page and its share preview.
export const getOfferDetailRecord = cache(async (id:string)=>{
  if (/^ajes-(?:stats|korea|china)-[A-Za-z0-9_-]{1,64}$/.test(id)) return getOfferForPage(id);
  let storedOffer = isJapanCatalogOfferId(id)
    ? await getOfferFromCurrentShard(id) || await getOfferForPage(id) || await getOfferFromCurrentProjection(id)
    : await getOfferForPage(id) || await getOfferFromCurrentShard(id) || await getOfferFromCurrentProjection(id);
  // New auction IDs are hashes, so their market cannot be inferred from the ID.
  if (storedOffer?.market === "japan" && !isJapanCatalogOfferId(id)) storedOffer = await getOfferFromCurrentShard(id) || storedOffer;
  const editorial=await readCatalogEditorial();
  return storedOffer&&!editorialHidden(storedOffer,editorial)?(await attachManagementKnowledge([applyCatalogEditorial(storedOffer,editorial)]))[0]:null;
});

/** Never treat a provider refusal as a sold car or an application-wide crash. */
export async function readOfferDetailForPage(id:string){
 try{return {offer:await getOfferDetailRecord(id),unavailable:false};}
 catch(error){if(error instanceof CollectionDisabledError)return {offer:null,unavailable:true,disabled:true as const};if(error instanceof AjesUnavailable)return {offer:null,unavailable:true};throw error;}
}
