import type { Market } from "../../../../packages/engine/src/types";

export type CatalogMarket = Market;
export type CatalogAccessMode = "public_json" | "public_html" | "partner_feed";
export type OfferType = "auction" | "fixed";
export type OfferStatus = "active" | "sold" | "removed" | "stale";
export type PriceMode = "fixed" | "auction_start" | "estimated";
export type CalculationStatus = "ready" | "needs_data" | "auction_start";

export type CatalogImage = {
  id: string;
  url: string;
  objectKey: string;
  width?: number;
  height?: number;
  size: number;
  checksum: string;
  mimeType: string;
};

export type VehicleOffer = {
  id: string;
  sourceId: string;
  sourceOfferId: string;
  market: CatalogMarket;
  offerType: OfferType;
  status: OfferStatus;
  make: string;
  model: string;
  generation?: string;
  trim?: string;
  year: number;
  productionDate?: string;
  mileageKm?: number;
  engineCc?: number;
  engineType?: string;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  powerHp?: number;
  powerKw?: number;
  color?: string;
  vin?: string;
  frameNumber?: string;
  auctionName?: string;
  auctionDate?: string;
  lotNumber?: string;
  auctionGrade?: string;
  sourcePrice: number | null;
  sourceCurrency: string | null;
  priceMode: PriceMode;
  images: CatalogImage[];
  calculationSnapshot?: any;
  totalRub?: number | null;
  calculationStatus: CalculationStatus;
  firstSeenAt: string;
  updatedAt: string;
  expiresAt?: string;
  operational: { sourceUrl?: string; sourceVenueName?: string; raw?: unknown; vin?: string; frameNumber?: string };
};

export type PublicVehicleOffer = Omit<VehicleOffer, "operational" | "vin" | "frameNumber">;
export type CatalogFetchResult = { items: unknown[]; nextCursor?: string | null; finished?: boolean; count?: number; health?: SourceRunHealth };
export type SourceRunHealth = { ok: boolean; message: string; checkedAt: string; httpStatus?: number; contentType?: string; blocked?: boolean };
export type CatalogSourcePolicy = {
  sourceId: string;
  market: CatalogMarket | "multi";
  enabled: boolean;
  accessMode: CatalogAccessMode;
  listUrl: string;
  robotsUrl?: string;
  robotsCheckedAt?: string;
  parserVersion: string;
  maxRequestsPerMinute: number;
  maxPagesPerRun: number;
  maxOffersPerRun: number;
  maxDetailsPerRun: number;
  imagesEnabled: boolean;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  blockedUntil?: string;
  lastSuccessfulCursor?: string | null;
};
export interface CatalogSourceAdapter {
  sourceId: string;
  market: CatalogMarket | "multi";
  accessMode: CatalogAccessMode;
  fetchPage(cursor?: string | null, updatedSince?: string): Promise<CatalogFetchResult>;
  normalizeOffer(raw: unknown): VehicleOffer | null;
  fetchImages(offer: VehicleOffer): Promise<CatalogImage[]>;
  mapStatus(raw: unknown): OfferStatus;
  healthCheck(): Promise<SourceRunHealth>;
}
export type CatalogSearchParams = { market?: string; make?: string; model?: string; hasPrice?: string; budgetTo?: number; yearFrom?: number; yearTo?: number; mileageTo?: number; engineFrom?: number; engineTo?: number; powerFrom?: number; fuel?: string; transmission?: string; drive?: string; bodyType?: string; auctionGrade?: string; auctionDateFrom?: string; auctionDateTo?: string; sort?: string; page?: number; pageSize?: number };
