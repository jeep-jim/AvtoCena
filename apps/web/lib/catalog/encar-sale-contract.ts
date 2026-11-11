import type { VehicleOffer } from "./types";

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function numeric(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function findValues(value: unknown, targetKeys: Set<string>, depth = 0, output: unknown[] = []) {
  if (value == null || depth > 12 || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) findValues(item, targetKeys, depth + 1, output);
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (targetKeys.has(key.toLowerCase())) output.push(child);
    if (child && typeof child === "object") findValues(child, targetKeys, depth + 1, output);
  }
  return output;
}

const CONTRACT_TYPE_KEYS = new Set([
  "advertisementtype",
  "leaserenttype",
  "leasetype",
  "renttype",
  "contracttype",
]);
const LEASE_RENT_INFO_KEYS = new Set(["leaserentinfo"]);
const NON_CASH_TYPE_RE = /(?:^|_)(?:RENT|LEASE)(?:_|$)|SUCCESSION/i;

export function encarNonCashContractReason(value: unknown) {
  for (const candidate of findValues(value, CONTRACT_TYPE_KEYS)) {
    const type = text(candidate);
    if (type && NON_CASH_TYPE_RE.test(type)) return `contract_type:${type}`;
  }

  for (const candidate of findValues(value, LEASE_RENT_INFO_KEYS)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const info = candidate as Record<string, unknown>;
    const residualMonth = numeric(info.residualMonth ?? info.month ?? info.remainingMonth);
    const monthlyFee = numeric(info.monthlyFee ?? info.monthlyPrice ?? info.rentFee ?? info.leaseFee);
    if (residualMonth > 0 && monthlyFee > 0) return `monthly_contract:${monthlyFee}:${residualMonth}`;
  }

  return "";
}

export function isEncarNonCashContract(value: unknown) {
  return Boolean(encarNonCashContractReason(value));
}

export function isEncarNonCashContractOffer(offer: VehicleOffer) {
  if (String(offer?.sourceId || "") !== "encar_direct") return false;
  return isEncarNonCashContract(offer?.operational?.raw);
}
