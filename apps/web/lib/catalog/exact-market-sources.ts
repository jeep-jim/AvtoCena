import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogMarket, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

export const exactMarketSources: CatalogSourceAdapter[] = [];
export const EXACT_MARKET_SOURCE_IDS = exactMarketSources.map((source) => source.sourceId);
