export type MarketId = "japan" | "china" | "korea" | "uae" | "europe";
export type OfferStatus = "live" | "unverified" | "needs_review" | "stale" | "removed" | "blocked";
export type CalculationConfidence = "high" | "medium" | "needs_review";
export type FieldProvenance = Record<string, string[]>;
export type VehicleOffer = {
  id: string; market: MarketId; source: string; sourceListingId: string; sourceUrl: string; sourceName: string; originalTitle: string;
  brand: string; model: string; generation?: string | null; trim?: string | null; year: number; mileageKm?: number | null; bodyType?: string | null; fuelType?: string | null;
  engineCc?: number | null; powerHp?: number | null; powerKw?: number | null; transmission?: string | null; drive?: string | null; color?: string | null; condition?: "new" | "used" | null;
  priceLocal: number; currency: string; location?: string | null; sellerType?: string | null; images: string[]; coverImage: string;
  firstSeenAt: string; lastSeenAt: string; lastCheckedAt: string; availability: OfferStatus; importEligibility: "allowed" | "blocked" | "unknown";
  eligibilityReasons: string[]; dataQualityScore: number; calculationConfidence: CalculationConfidence; provenance?: FieldProvenance;
  calculationSnapshot?: { settingsVersion: string; marketConfigVersion?: string; calculatedAt: string; exchangeRate: number; exchangeRateVersion: string; exchangeRateSource: string; sourcePriceLocal: number; sourcePriceRub: number; totalRub: number; complete: boolean; lines: { id: string; title: string; amountRub: number }[] };
};
export type VehicleVariant = { brand:string; model:string; generation?:string|null; productionYears?:string|null; bodyTypes:string[]; marketAliases:Record<string,string[]>; engineVariants:{fuelType?:string; engineCc?:number; powerHp?:number; powerKw?:number; transmission?:string; drive?:string; hybridType?:string; sourceReferences:string[]; confidence:number}[]; confidence:number; updatedAt:string };
