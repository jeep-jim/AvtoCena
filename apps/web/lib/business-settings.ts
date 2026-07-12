import crypto from "node:crypto";
import { appendChunkedDataJson, readDataJson, writeDataJson } from "./data";
import { canEditBusinessSettings, cleanText, isMarketId, nullableNumber, validateMarketVersion } from "./settings-validation";

export type SettingsUser = { id: string; displayName: string; role: string };

function makeId(prefix: string) {
  try { return `${prefix}_${crypto.randomUUID()}`; } catch { return `${prefix}_${Date.now()}`; }
}

function nowIso() { return new Date().toISOString(); }

export function getMarketsSettings() {
  return readDataJson<any[]>("markets/markets.json", []);
}

export function getMarketSettings(marketId: string) {
  return getMarketsSettings().find((market) => market.id === marketId) || null;
}

export function getActiveMarketVersion(marketId: string) {
  const market = getMarketSettings(marketId);
  if (!market) return null;
  return market.versions?.find((version: any) => version.id === market.activeVersionId) || market.versions?.find((version: any) => version.status === "active") || null;
}

export function getBusinessSettingsSnapshot(marketId: string) {
  const market = getMarketSettings(marketId);
  const version = getActiveMarketVersion(marketId);
  if (!market || !version) return null;
  return {
    snapshotAt: nowIso(),
    marketId: market.id,
    marketName: market.name,
    configVersion: version.id,
    effectiveFrom: version.effectiveFrom,
    rules: JSON.parse(JSON.stringify(version)),
  };
}

export function appendChangeLog(entry: any) {
  return appendChunkedDataJson("settings/change-log.json", {
    id: makeId("change"),
    createdAt: nowIso(),
    ...entry,
  });
}

export function createMarketVersion(marketId: string, patch: any, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  if (!isMarketId(marketId)) throw new Error("unknown_market");

  const markets = getMarketsSettings();
  const marketIndex = markets.findIndex((market) => market.id === marketId);
  if (marketIndex === -1) throw new Error("market_not_found");

  const market = markets[marketIndex];
  const current = getActiveMarketVersion(marketId) || market.versions?.[market.versions.length - 1] || {};
  const nextVersionNumber = Math.max(0, ...(market.versions || []).map((version: any) => Number(version.version || 0))) + 1;
  const candidate = {
    ...current,
    ...patch,
    id: makeId(`market_${marketId}_v${nextVersionNumber}`),
    version: nextVersionNumber,
    status: patch.status || "active",
    effectiveFrom: patch.effectiveFrom || nowIso(),
    createdAt: nowIso(),
    createdByUserId: user.id,
  };
  const validation = validateMarketVersion(candidate);
  if (!validation.ok) {
    const error = new Error(validation.errors.join(","));
    (error as any).validationErrors = validation.errors;
    throw error;
  }

  const nextVersion = validation.value;
  const nextMarket = {
    ...market,
    name: cleanText(patch.name, 120) || market.name,
    activeVersionId: nextVersion.status === "active" ? nextVersion.id : market.activeVersionId,
    versions: [...(market.versions || []).map((version: any) => nextVersion.status === "active" ? { ...version, status: version.status === "active" ? "archived" : version.status } : version), nextVersion],
  };
  markets[marketIndex] = nextMarket;
  writeDataJson("markets/markets.json", markets);
  appendChangeLog({
    entityType: "market",
    entityId: marketId,
    changedByUserId: user.id,
    changedByName: user.displayName,
    oldValue: current,
    newValue: nextVersion,
    comment: cleanText(comment, 1000),
  });
  return nextVersion;
}

export function getSiteBusinessSettings() {
  return readDataJson<any>("settings/site-business.json", { activeVersionId: "", versions: [] });
}

export function getActiveSiteBusinessVersion() {
  const settings = getSiteBusinessSettings();
  return settings.versions?.find((version: any) => version.id === settings.activeVersionId) || settings.versions?.[0] || null;
}

export function createSiteBusinessVersion(patch: any, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  const settings = getSiteBusinessSettings();
  const current = getActiveSiteBusinessVersion() || {};
  const version = Math.max(0, ...(settings.versions || []).map((item: any) => Number(item.version || 0))) + 1;
  const next = {
    ...current,
    id: makeId(`site_business_v${version}`),
    version,
    status: "active",
    effectiveFrom: patch.effectiveFrom || nowIso(),
    displayPartnerPayoutRub: nullableNumber(patch.displayPartnerPayoutRub) ?? current.displayPartnerPayoutRub,
    minimumBudgetRub: nullableNumber(patch.minimumBudgetRub) ?? current.minimumBudgetRub,
    calculationReservePercent: nullableNumber(patch.calculationReservePercent) ?? current.calculationReservePercent,
    deliveryTermsText: cleanText(patch.deliveryTermsText, 1000) || current.deliveryTermsText,
    createdAt: nowIso(),
    createdByUserId: user.id,
  };
  const updated = { activeVersionId: next.id, versions: [...(settings.versions || []).map((item: any) => ({ ...item, status: item.status === "active" ? "archived" : item.status })), next] };
  writeDataJson("settings/site-business.json", updated);
  appendChangeLog({ entityType: "site-business", entityId: "site", changedByUserId: user.id, changedByName: user.displayName, oldValue: current, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function getDirectPartnerProgram() {
  return readDataJson<any>("cpa/payouts.json", {}).directPartnerProgram;
}

export function getActiveDirectPartnerPayout() {
  const program = getDirectPartnerProgram();
  return program?.versions?.find((version: any) => version.id === program.activeVersionId) || null;
}

export function createDirectPartnerPayoutVersion(amountRub: number, effectiveFrom: string, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  const settings = readDataJson<any>("cpa/payouts.json", {});
  const program = settings.directPartnerProgram || { versions: [] };
  const current = getActiveDirectPartnerPayout() || {};
  const version = Math.max(0, ...(program.versions || []).map((item: any) => Number(item.version || 0))) + 1;
  const next = { ...current, id: makeId(`direct_partner_payout_v${version}`), version, status: "active", effectiveFrom: effectiveFrom || nowIso(), defaultSignedContractPayoutRub: Number(amountRub), currency: "RUB", createdAt: nowIso(), createdByUserId: user.id, comment: cleanText(comment, 1000) };
  const updatedProgram = { ...program, activeVersionId: next.id, versions: [...(program.versions || []).map((item: any) => ({ ...item, status: item.status === "active" ? "archived" : item.status })), next] };
  writeDataJson("cpa/payouts.json", { ...settings, directPartnerProgram: updatedProgram });
  appendChangeLog({ entityType: "direct-partner-payout", entityId: "default", changedByUserId: user.id, changedByName: user.displayName, oldValue: current, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function getCpaNetworks() { return readDataJson<any[]>("cpa/networks.json", []); }
export function getContractTemplatesSettings() { return readDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [] }); }
export function getSettingsChangeLog() { return readDataJson<any[]>("settings/change-log.json", []); }
