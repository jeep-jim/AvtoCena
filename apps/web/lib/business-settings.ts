import crypto from "node:crypto";
import { appendChunkedDataJson, readDataJson, writeDataJson } from "./data";
import { canEditBusinessSettings, cleanText, isMarketId, nullableNumber, validateMarketVersion } from "./settings-validation";

export type SettingsUser = { id: string; displayName: string; role: string };

function makeId(prefix: string) {
  try { return `${prefix}_${crypto.randomUUID()}`; } catch { return `${prefix}_${Date.now()}`; }
}

function nowIso() { return new Date().toISOString(); }

function effectiveTime(value?: string) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function statusForEffectiveFrom(effectiveFrom?: string, active = true) {
  if (!active) return "draft";
  return effectiveTime(effectiveFrom) > Date.now() ? "scheduled" : "active";
}

function chooseEffectiveVersion(versions: any[] = [], asOf = new Date()) {
  const now = asOf.getTime();
  return versions
    .filter((version) => version.status !== "draft" && version.status !== "archived" && effectiveTime(version.effectiveFrom) <= now)
    .sort((a, b) => effectiveTime(b.effectiveFrom) - effectiveTime(a.effectiveFrom) || Number(b.version || 0) - Number(a.version || 0))[0] || null;
}


export function getMarketsSettings() {
  return readDataJson<any[]>("markets/markets.json", []);
}

export function getMarketSettings(marketId: string) {
  return getMarketsSettings().find((market) => market.id === marketId) || null;
}

export function getActiveMarketVersion(marketId: string, asOf = new Date()) {
  const market = getMarketSettings(marketId);
  if (!market) return null;
  return chooseEffectiveVersion(market.versions || [], asOf) || market.versions?.find((version: any) => version.id === market.activeVersionId) || null;
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
    effectiveFrom: patch.effectiveFrom || nowIso(),
    status: statusForEffectiveFrom(patch.effectiveFrom || nowIso(), patch.active !== false),
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
    versions: [...(market.versions || []).map((version: any) => nextVersion.status === "active" && version.status === "active" ? { ...version, status: "archived" } : version), nextVersion],
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

export function getActiveSiteBusinessVersion(asOf = new Date()) {
  const settings = getSiteBusinessSettings();
  return chooseEffectiveVersion(settings.versions || [], asOf) || settings.versions?.find((version: any) => version.id === settings.activeVersionId) || settings.versions?.[0] || null;
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
    effectiveFrom: patch.effectiveFrom || nowIso(),
    status: statusForEffectiveFrom(patch.effectiveFrom || nowIso(), true),
    displayPartnerPayoutRub: nullableNumber(patch.displayPartnerPayoutRub) ?? current.displayPartnerPayoutRub,
    minimumBudgetRub: nullableNumber(patch.minimumBudgetRub) ?? current.minimumBudgetRub,
    calculationReservePercent: nullableNumber(patch.calculationReservePercent) ?? current.calculationReservePercent,
    deliveryTermsText: cleanText(patch.deliveryTermsText, 1000) || current.deliveryTermsText,
    createdAt: nowIso(),
    createdByUserId: user.id,
  };
  const updated = { activeVersionId: next.status === "active" ? next.id : settings.activeVersionId, versions: [...(settings.versions || []).map((item: any) => next.status === "active" && item.status === "active" ? { ...item, status: "archived" } : item), next] };
  writeDataJson("settings/site-business.json", updated);
  appendChangeLog({ entityType: "site-business", entityId: "site", changedByUserId: user.id, changedByName: user.displayName, oldValue: current, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function getDirectPartnerProgram() {
  return readDataJson<any>("cpa/payouts.json", {}).directPartnerProgram;
}

export function getActiveDirectPartnerPayout(asOf = new Date()) {
  const program = getDirectPartnerProgram();
  return chooseEffectiveVersion(program?.versions || [], asOf) || program?.versions?.find((version: any) => version.id === program.activeVersionId) || null;
}

export function createDirectPartnerPayoutVersion(amountRub: number, effectiveFrom: string, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  const settings = readDataJson<any>("cpa/payouts.json", {});
  const program = settings.directPartnerProgram || { versions: [] };
  const current = getActiveDirectPartnerPayout() || {};
  const version = Math.max(0, ...(program.versions || []).map((item: any) => Number(item.version || 0))) + 1;
  const nextEffectiveFrom = effectiveFrom || nowIso();
  const next = { ...current, id: makeId(`direct_partner_payout_v${version}`), version, status: statusForEffectiveFrom(nextEffectiveFrom, true), effectiveFrom: nextEffectiveFrom, defaultSignedContractPayoutRub: Number(amountRub), currency: "RUB", createdAt: nowIso(), createdByUserId: user.id, comment: cleanText(comment, 1000) };
  const updatedProgram = { ...program, activeVersionId: next.status === "active" ? next.id : program.activeVersionId, versions: [...(program.versions || []).map((item: any) => next.status === "active" && item.status === "active" ? { ...item, status: "archived" } : item), next] };
  writeDataJson("cpa/payouts.json", { ...settings, directPartnerProgram: updatedProgram });
  appendChangeLog({ entityType: "direct-partner-payout", entityId: "default", changedByUserId: user.id, changedByName: user.displayName, oldValue: current, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function createPartnerPayoutVersion(partnerCode: string, amountRub: number, effectiveFrom: string, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  const partners = readDataJson<any[]>("partners/partners.json", []);
  const partnerIndex = partners.findIndex((partner) => partner.code === partnerCode);
  if (partnerIndex === -1) throw new Error("partner_not_found");
  const partner = partners[partnerIndex];
  const versions = Array.isArray(partner.individualPayouts) ? partner.individualPayouts : [];
  const version = Math.max(0, ...versions.map((item: any) => Number(item.version || 0))) + 1;
  const nextEffectiveFrom = effectiveFrom || nowIso();
  const next = { id: makeId(`${partnerCode}_payout_v${version}`), version, status: statusForEffectiveFrom(nextEffectiveFrom, true), effectiveFrom: nextEffectiveFrom, event: "signed_contract", payoutRub: Number(amountRub), currency: "RUB", comment: cleanText(comment, 1000) };
  partners[partnerIndex] = { ...partner, payoutRub: next.status === "active" ? Number(amountRub) : partner.payoutRub, individualPayouts: [...versions.map((item: any) => next.status === "active" && item.status === "active" ? { ...item, status: "archived" } : item), next] };
  writeDataJson("partners/partners.json", partners);
  appendChangeLog({ entityType: "partner-payout", entityId: partnerCode, changedByUserId: user.id, changedByName: user.displayName, oldValue: versions[versions.length - 1] || null, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function getCpaNetworks() { return readDataJson<any[]>("cpa/networks.json", []); }

export function upsertCpaNetworkDraft(patch: any, user: SettingsUser, comment: string) {
  if (!canEditBusinessSettings(user.role)) throw new Error("forbidden");
  const networks = getCpaNetworks();
  const id = cleanText(patch.id, 160) || makeId("cpa_network");
  const index = networks.findIndex((network) => network.id === id);
  const current = index >= 0 ? networks[index] : {};
  const next = { ...current, id, networkId: cleanText(patch.networkId, 160), name: cleanText(patch.name, 200) || current.name || "Черновик CPA-сети", enabled: patch.enabled === true, status: patch.enabled === true ? "active" : "draft", partnerRef: cleanText(patch.partnerRef, 160), offerId: cleanText(patch.offerId, 160), goal: cleanText(patch.goal, 160) || "signed_contract", payoutType: cleanText(patch.payoutType, 40) || "custom/manual", payoutAmount: nullableNumber(patch.payoutAmount), currency: cleanText(patch.currency, 12) || "RUB", holdDays: nullableNumber(patch.holdDays), attributionWindowDays: nullableNumber(patch.attributionWindowDays), dailyCap: nullableNumber(patch.dailyCap), monthlyCap: nullableNumber(patch.monthlyCap), allowedTrafficSources: Array.isArray(patch.allowedTrafficSources) ? patch.allowedTrafficSources : [], forbiddenTrafficSources: Array.isArray(patch.forbiddenTrafficSources) ? patch.forbiddenTrafficSources : [], statusMapping: patch.statusMapping && typeof patch.statusMapping === "object" ? patch.statusMapping : {}, postbackConfig: patch.postbackConfig && typeof patch.postbackConfig === "object" ? patch.postbackConfig : { method: "GET", urlTemplate: "", headers: {} }, comment: cleanText(comment, 1000), effectiveFrom: cleanText(patch.effectiveFrom, 80) || nowIso() };
  if (index >= 0) networks[index] = next; else networks.push(next);
  writeDataJson("cpa/networks.json", networks);
  appendChangeLog({ entityType: "cpa-network", entityId: id, changedByUserId: user.id, changedByName: user.displayName, oldValue: current, newValue: next, comment: cleanText(comment, 1000) });
  return next;
}

export function getContractTemplatesSettings() { return readDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [] }); }
export function getSettingsChangeLog() { return readDataJson<any[]>("settings/change-log.json", []); }
