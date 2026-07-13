import type { MarketId, VehicleOffer } from "../types";
export type SourceMode = "api"|"html"|"json-feed"|"manual-import";
export type SourceOperationalStatus = "operational_api" | "operational_feed" | "operational_manual" | "blocked" | "awaiting_approval" | "unavailable";
export type SourceHealth = { ok:boolean; message?:string; checkedAt:string };
export type SourceConfig = { id:string; market:MarketId; enabled:boolean; mode:SourceMode; status:SourceOperationalStatus; lastSuccessAt?:string|null; lastErrorAt?:string|null; lastError?:string|null; requestDelayMs:number; allowed:boolean; notes:string };
export interface SourceAdapter { config: SourceConfig; fetchListings(): Promise<unknown[]>; fetchListingDetails(listing:unknown): Promise<unknown>; normalizeListing(listing:unknown): VehicleOffer | null; extractImages(listing:unknown): string[]; healthCheck(): Promise<SourceHealth>; }
export class ManualJsonAdapter implements SourceAdapter { constructor(public config: SourceConfig){} async fetchListings(){return []} async fetchListingDetails(l:unknown){return l} normalizeListing(l:unknown){return l as VehicleOffer} extractImages(l:unknown){return Array.isArray((l as VehicleOffer).images)?(l as VehicleOffer).images:[]} async healthCheck(){return {ok:this.config.status === "operational_manual",message:this.config.notes,checkedAt:new Date().toISOString()}} }
