import type { VehicleOffer } from "./types";
import { classifySpecificationEvidence } from "./specification-evidence-audit";

export const JAPAN_EXPORT_RULE_URL = "https://www.meti.go.jp/press/2023/07/20230728001/20230728001.html";
export type JapanExportRestriction = {
  status: "restricted";
  reason: "engine_over_1900cc" | "hybrid" | "electric";
  ruleUrl: string;
  ruleVersion: "jp-2023-08-09";
};

/** Positive findings only. Missing evidence is never a clearance to export.
 * Source/verified variant evidence is required; user calculation inputs are not evidence.
 * This covers technical restrictions, not a full export eligibility assessment.
 */
export function assessJapanExportRestriction(offer: Partial<VehicleOffer>): JapanExportRestriction | undefined {
  if (offer.market !== "japan" || offer.vehicleCategory === "N1") return undefined;
  const semantic = offer.operational?.semanticEvidence as Record<string, {status?: string; value?: unknown}> | undefined;
  const normalizeFuel = (value: unknown) => String(value ?? "").toLowerCase().replace(/^(gasoline|benzin)$/, "petrol");
  // A preserved evidence flag cannot validate a different field value.
  for (const key of ["fuel", "powertrainKind", "engineCc"] as const) {
    const item = semantic?.[key];
    if (item?.value === undefined || !["exact", "verified"].includes(item.status || "")) continue;
    const matches = key === "engineCc" ? Number(item.value) === Number(offer[key])
      : key === "fuel" ? normalizeFuel(item.value) === normalizeFuel(offer[key]) : item.value === offer[key];
    if (!matches) return undefined;
  }
  const fuel = classifySpecificationEvidence(offer, "fuelPowertrain");
  if (fuel.state !== "exact") return undefined;
  let reason: JapanExportRestriction["reason"] | undefined;
  if (offer.powertrainKind === "electric") reason = "electric";
  else if (["series_hybrid", "other_hybrid"].includes(offer.powertrainKind || "")) reason = "hybrid";
  else if (["petrol", "gasoline", "benzin", "diesel"].includes(String(offer.fuel).toLowerCase())
    && classifySpecificationEvidence(offer, "engineCc").state === "exact"
    && Number(offer.engineCc) > 1900) reason = "engine_over_1900cc";
  return reason ? { status: "restricted", reason, ruleUrl: JAPAN_EXPORT_RULE_URL, ruleVersion: "jp-2023-08-09" } : undefined;
}

export function japanRestrictionDescription(restriction?: JapanExportRestriction) {
  if (restriction?.status !== "restricted" || restriction.ruleVersion !== "jp-2023-08-09") return "";
  const reasons = { engine_over_1900cc: "ДВС свыше 1 900 см³", hybrid: "гибридная силовая установка", electric: "электромобиль" };
  if (!Object.prototype.hasOwnProperty.call(reasons, restriction.reason)) return "";
  return reasons[restriction.reason] ? `Ограничение экспорта из Японии в РФ: ${reasons[restriction.reason]}.` : "";
}

export function auctionGradeLabel(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const grade = String(value).trim().toUpperCase().replace(",", ".");
  // Preserve a source grade, never derive one from photos, age or mileage.
  return /^(?:[0-6](?:\.5)?|[7-9]|10|S|R|RA|RB|A|B|C|D|E|F|\*{1,3})$/.test(grade) ? grade : undefined;
}
