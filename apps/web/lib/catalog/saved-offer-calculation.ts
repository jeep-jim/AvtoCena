import { createHash, randomUUID } from "node:crypto";
import { cache } from "react";
import { mutateDataJson, readDataJson } from "../data";
import type { VehicleOffer } from "./types";
import { validateCustomerParameters } from "./customer-parameters";
import type { calculateOfferWithCustomerParametersDetailed } from "./customs-pricing";

export type SavedCalculationResult = Extract<Awaited<ReturnType<typeof calculateOfferWithCustomerParametersDetailed>>, {ok:true}>["calculation"];
export type SavedOfferCalculation = {
  version: string; offerId: string; identity: string; savedAt: string; savedBy: string;
  draft: Record<string,string>; calculation: SavedCalculationResult;
};
const fields = ["year","productionMonth","productionDay","customsCalculationDate","fuel","engineCc","powerHp","powerKw","hybridKind","power30MinKw","icePowerKw","vehicleCategory","grossVehicleWeightKg","n1IceFuel","transportToBorderRub","deliveryCity"];
export function cleanSavedDraft(input: unknown) {
  const source = input as Record<string,unknown>;
  const draft = Object.fromEntries(fields.map(key=>[key, typeof source?.[key] === "string" || typeof source?.[key] === "number" ? String(source[key]).trim() : ""]));
  const validated = validateCustomerParameters(draft);
  draft.deliveryCity = validated.deliveryCity || "";
  return draft;
}
export function savedOfferIdentity(offer: VehicleOffer) {
  return createHash("sha256").update(JSON.stringify([offer.id,offer.market,offer.sourceId,offer.sourceOfferId])).digest("hex");
}
function storagePath(id: string) {
  return `offer-calculations/${createHash("sha256").update(id).digest("hex")}.json`;
}
export function matchingSavedCalculation(record: SavedOfferCalculation | null, offer: VehicleOffer | null) {
  return record && offer && record.offerId === offer.id && record.identity === savedOfferIdentity(offer) && Number(record.calculation?.totalRub)>0 ? record : null;
}
// Request-only cache: a save is visible on the very next request, never waits for a web deploy.
const readRecord = (id:string)=>readDataJson<SavedOfferCalculation|null>(storagePath(id),null);
const readSavedRecord = typeof cache === "function" ? cache(readRecord) : readRecord;
export async function getSavedOfferCalculation(offer: VehicleOffer) {
  return matchingSavedCalculation(await readSavedRecord(offer.id), offer);
}
export class SavedCalculationConflict extends Error {}
export async function saveOfferCalculation(offer:VehicleOffer, draft:Record<string,string>, calculation:SavedCalculationResult, userId:string, expectedVersion:string|null) {
  const record:SavedOfferCalculation={offerId:offer.id,identity:savedOfferIdentity(offer),version:randomUUID(),savedAt:new Date().toISOString(),savedBy:userId,draft:cleanSavedDraft(draft),calculation};
  await mutateDataJson<SavedOfferCalculation|null>(storagePath(offer.id),null,current=>{
    if ((matchingSavedCalculation(current,offer)?.version || null) !== expectedVersion) throw new SavedCalculationConflict("Карточка уже изменена другим сотрудником. Обновите страницу перед сохранением.");
    return record;
  });
  return record;
}
