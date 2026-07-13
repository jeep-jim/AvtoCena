import type { VehicleOffer, FieldProvenance } from "../types";

export type SourceMode = "official_api" | "official_feed" | "partner_feed" | "public_json" | "public_html" | "browser_rendered" | "manual_json" | "manual_csv" | "unavailable";
export type SourceStatus = "operational" | "operational_manual" | "requires_agreement" | "awaiting_review" | "blocked" | "unavailable";
export type ImageMode = "remote_direct" | "remote_requires_referer" | "temporary_signed_url" | "source_page_only" | "unavailable";
export type SourceConfig = { id:string; name:string; market:string; baseUrl:string; catalogUrl:string; sampleListingUrl:string; termsUrl:string; robotsUrl:string; mode:SourceMode; status:SourceStatus; enabled:boolean; requiresJavascript:boolean; requiresAuthentication:boolean; requiresPartnerAgreement:boolean; listingPageAccessible:boolean|null; detailPageAccessible:boolean|null; directImagesAccessible:boolean|null; rateLimit:{maxRequestsPerMinute:number;maxPagesPerRun:number}; requestDelayMs:number; supportsListImport:boolean; supportsDetailsImport:boolean; supportsImages:boolean|null; supportsPrice:boolean|null; supportsMileage:boolean|null; supportsPower:boolean|null; supportsEngine:boolean|null; supportsYear:boolean|null; imageMode?:ImageMode; lastProbeAt:string|null; lastSuccessAt:string|null; lastError:string|null; notes:string; partnerConfig?:{endpointEnv?:string; tokenEnv?:string} };
export type ProbeResult = { ok:boolean; sourceId:string; checkedAt:string; status?:SourceStatus; message?:string };
export type AdapterContext = { runId:string; fetchedAt:string; maxPages?:number };
export type AdapterListingLink = { sourceListingId:string; url:string; provenance: FieldProvenance };
export interface SourceAdapter {
  config: SourceConfig;
  probe(): Promise<ProbeResult>;
  fetchCatalogPage(context: AdapterContext, pageUrl?: string): Promise<string | unknown>;
  extractListingLinks(payload: string | unknown, context: AdapterContext): Promise<AdapterListingLink[]>;
  fetchListingDetails(link: AdapterListingLink, context: AdapterContext): Promise<string | unknown>;
  normalizeListing(detail: string | unknown, context: AdapterContext): Promise<VehicleOffer | null>;
  extractImages(detail: string | unknown, context: AdapterContext): Promise<string[]>;
  validateListing(offer: VehicleOffer): Promise<{ ok:boolean; errors:string[] }>;
  mapTechnicalFields(raw: unknown, context: AdapterContext): Promise<Partial<VehicleOffer>>;
  getNextPage(payload: string | unknown, context: AdapterContext): string | null;
  healthCheck(): Promise<ProbeResult>;
}

export class BaseAdapter implements SourceAdapter {
  constructor(public config: SourceConfig) {}
  async probe(){ return { ok:false, sourceId:this.config.id, checkedAt:new Date().toISOString(), status:this.config.status as SourceStatus, message:this.config.notes }; }
  async fetchCatalogPage(){ return ""; }
  async extractListingLinks(){ return []; }
  async fetchListingDetails(link: AdapterListingLink){ return link; }
  async normalizeListing(){ return null; }
  async extractImages(){ return []; }
  async validateListing(offer: VehicleOffer){ return { ok:Boolean(offer.sourceUrl && offer.sourceListingId), errors:[] }; }
  async mapTechnicalFields(){ return {}; }
  getNextPage(){ return null; }
  async healthCheck(){ return this.probe(); }
}
export class JsonApiAdapter extends BaseAdapter {}
export class HtmlCatalogAdapter extends BaseAdapter {}
export class BrowserRenderedAdapter extends BaseAdapter {}
export class PartnerFeedAdapter extends BaseAdapter { async probe(){ return { ok:false, sourceId:this.config.id, checkedAt:new Date().toISOString(), status:"requires_agreement" as const, message:"Partner agreement/API token required; scraper disabled." }; } }
export class ManualFileAdapter extends BaseAdapter { async probe(){ return { ok:this.config.status === "operational_manual", sourceId:this.config.id, checkedAt:new Date().toISOString(), status:this.config.status as SourceStatus, message:"Manual JSON/CSV import only." }; } }
