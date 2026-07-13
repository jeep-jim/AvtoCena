import chinaOffers from "../../../../data/catalog/offers/china/chunk-0001.json";
import type { VehicleOffer } from "./types";
export const staticPublicOffers = (chinaOffers as VehicleOffer[]).filter((offer)=>offer.availability === "live" && offer.importEligibility !== "blocked");
