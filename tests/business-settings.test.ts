import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
let tempRoot = "";

async function loadModules() {
  return {
    settings: await import(`../apps/web/lib/business-settings.ts?case=${Date.now()}${Math.random()}`),
    validation: await import(`../apps/web/lib/settings-validation.ts?case=${Date.now()}${Math.random()}`),
    engine: await import(`../packages/engine/src/calculation/calculateAvtocena.ts?case=${Date.now()}${Math.random()}`),
  };
}

beforeEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = mkdtempSync(path.join(tmpdir(), "avtocena-settings-"));
  cpSync(path.join(repoRoot, "data"), path.join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

test("production functions load active market configuration and snapshot", async () => {
  const { settings } = await loadModules();
  const japan = await settings.getActiveMarketVersion("japan");
  const snapshot = await settings.getBusinessSettingsSnapshot("japan");
  assert.equal(japan.currency, "JPY");
  assert.equal(snapshot.configVersion, japan.id);
  assert.equal(snapshot.rules.topAvtoCommissionRub, 39000);
});

test("createMarketVersion uses scheduled for future effectiveFrom and keeps current active version", async () => {
  const { settings } = await loadModules();
  const user = { id: "owner_test", displayName: "Owner", role: "owner" };
  const before = await settings.getActiveMarketVersion("japan");
  const future = await settings.createMarketVersion("japan", {
    active: true,
    effectiveFrom: "2099-01-01T00:00:00.000Z",
    currency: "JPY",
    topAvtoCommissionRub: 45000,
    securityDepositRub: 31000,
  }, user, "future commission");
  const after = await settings.getActiveMarketVersion("japan");
  assert.equal(future.status, "scheduled");
  assert.equal(after.id, before.id);
  assert.equal(after.topAvtoCommissionRub, 39000);
  assert.equal((await settings.getActiveMarketVersion("japan", new Date("2100-01-01T00:00:00.000Z"))).topAvtoCommissionRub, 45000);
});

test("snapshots stay immutable after immediate market version update", async () => {
  const { settings } = await loadModules();
  const oldSnapshot = await settings.getBusinessSettingsSnapshot("china");
  await settings.createMarketVersion("china", {
    active: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    currency: "CNY",
    topAvtoCommissionRub: 91000,
    securityDepositRub: 160000,
  }, { id: "admin_test", displayName: "Admin", role: "admin" }, "new active commission");
  const newSnapshot = await settings.getBusinessSettingsSnapshot("china");
  assert.equal(oldSnapshot.rules.topAvtoCommissionRub, 90000);
  assert.equal(newSnapshot.rules.topAvtoCommissionRub, 91000);
  assert.notEqual(oldSnapshot.configVersion, newSnapshot.configVersion);
});

test("known initial market payments are preserved", async () => {
  const { settings } = await loadModules();
  const japan = await settings.getActiveMarketVersion("japan");
  const china = await settings.getActiveMarketVersion("china");
  const uae = await settings.getActiveMarketVersion("uae");
  assert.equal(japan.securityDepositRub + japan.topAvtoCommissionRub, 70000);
  assert.equal(china.securityDepositRub + china.topAvtoCommissionRub, 250000);
  assert.equal(uae.securityDepositRub + uae.topAvtoCommissionRub, 200000);
});

test("direct partner payout future version does not affect current active payout", async () => {
  const { settings } = await loadModules();
  const before = await settings.getActiveDirectPartnerPayout();
  const future = await settings.createDirectPartnerPayoutVersion(15000, "2099-01-01T00:00:00.000Z", { id: "owner_test", displayName: "Owner", role: "owner" }, "future payout");
  assert.equal(future.status, "scheduled");
  assert.equal((await settings.getActiveDirectPartnerPayout()).defaultSignedContractPayoutRub, before.defaultSignedContractPayoutRub);
  assert.equal((await settings.getActiveDirectPartnerPayout(new Date("2100-01-01T00:00:00.000Z"))).defaultSignedContractPayoutRub, 15000);
});

test("individual partner payout version is stored separately from base payout", async () => {
  const { settings } = await loadModules();
  const partnerVersion = await settings.createPartnerPayoutVersion("demo", 12000, "2026-01-01T00:00:00.000Z", { id: "admin_test", displayName: "Admin", role: "admin" }, "individual");
  assert.equal(partnerVersion.payoutRub, 12000);
  assert.equal((await settings.getActiveDirectPartnerPayout()).defaultSignedContractPayoutRub, 10000);
});

test("role separation and validators use production functions", async () => {
  const { settings, validation } = await loadModules();
  assert.equal(validation.canEditBusinessSettings("owner"), true);
  assert.equal(validation.canEditBusinessSettings("admin"), true);
  assert.equal(validation.canEditBusinessSettings("manager"), false);
  assert.equal(validation.canEditBusinessSettings("partner"), false);
  const invalid = validation.validateMarketVersion({ status: "active", currency: "JPY", securityDepositRub: null, topAvtoCommissionRub: 1 });
  assert.equal(invalid.ok, false);
  await assert.rejects(() => settings.createMarketVersion("japan", { active: true, currency: "JPY" }, { id: "manager", displayName: "Manager", role: "manager" }, "no"), /forbidden/);
});

test("business calculation engine returns configVersion, breakdown and immutable snapshot", async () => {
  const { settings, engine } = await loadModules();
  const config = await settings.getActiveMarketVersion("japan");
  const result = engine.calculateAvtocenaFromBusinessConfig({
    marketId: "japan",
    marketConfig: config,
    carPriceRub: 1000000,
    customsRub: 200000,
    deliveryCity: "Кемерово",
    manualAdjustmentRub: 5000,
    manualAdjustmentReason: "Округление",
  });
  assert.equal(result.configVersion, config.id);
  assert.equal(result.deliveryCity, "Кемерово");
  assert.ok(result.breakdown.find((line: any) => line.id === "topavto-commission"));
  assert.equal(result.snapshot.marketConfig.topAvtoCommissionRub, config.topAvtoCommissionRub);
});

test("CPA network draft can be edited without inventing real network parameters", async () => {
  const { settings } = await loadModules();
  const network = await settings.upsertCpaNetworkDraft({ id: "draft_test", name: "Draft", payoutType: "fixed", payoutAmount: null, postbackConfig: { method: "GET", urlTemplate: "", headers: {} } }, { id: "owner", displayName: "Owner", role: "owner" }, "draft");
  assert.equal(network.enabled, false);
  assert.equal(network.status, "draft");
  assert.equal(network.postbackConfig.urlTemplate, "");
});


test("effectiveFrom is consistent across market, site, direct payout and public CPA layer", async () => {
  const { settings } = await loadModules();
  const user = { id: "owner_test", displayName: "Owner", role: "owner" };
  await settings.createDirectPartnerPayoutVersion(16000, "2099-01-01T00:00:00.000Z", user, "future payout");
  await settings.createSiteBusinessVersion({ displayPartnerPayoutRub: 16000, effectiveFrom: "2099-01-01T00:00:00.000Z" }, user, "future site");
  await settings.createMarketVersion("uae", { active: true, currency: "AED", effectiveFrom: "2099-01-01T00:00:00.000Z", securityDepositRub: 110000, topAvtoCommissionRub: 95000 }, user, "future market");
  const before = new Date("2098-01-01T00:00:00.000Z");
  const after = new Date("2100-01-01T00:00:00.000Z");
  assert.equal((await settings.getActiveDirectPartnerPayout(before)).defaultSignedContractPayoutRub, 10000);
  assert.equal((await settings.getActiveSiteBusinessVersion(before)).displayPartnerPayoutRub, 10000);
  assert.equal((await settings.getActiveMarketVersion("uae", before)).topAvtoCommissionRub, 90000);
  assert.equal((await settings.getActiveDirectPartnerPayout(after)).defaultSignedContractPayoutRub, 16000);
  assert.equal((await settings.getActiveSiteBusinessVersion(after)).displayPartnerPayoutRub, 16000);
  assert.equal((await settings.getActiveMarketVersion("uae", after)).topAvtoCommissionRub, 95000);
});

test("partner accruals are created only for active direct partners and are deduped", async () => {
  const { settings } = await loadModules();
  const first = await settings.createDirectPartnerAccrualForLead({ leadId: "lead_direct", clientId: "client_1", partnerRef: "demo", createdAt: "2026-07-12T00:00:00.000Z" });
  const duplicate = await settings.createDirectPartnerAccrualForLead({ leadId: "lead_direct", clientId: "client_1", partnerRef: "demo", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(first.created, true);
  assert.equal(first.accrual.partnerCode, "demo");
  assert.equal(first.accrual.payoutAmountRub, 10000);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.reason, "duplicate");
});

test("CPA and unknown partner refs do not create direct partner accruals", async () => {
  const { settings } = await loadModules();
  await settings.upsertCpaNetworkDraft({
    id: "network_test",
    networkId: "network_test",
    name: "CPA Test",
    enabled: true,
    partnerRef: "cpa_ref",
    offerId: "offer_1",
    goal: "signed_contract",
    payoutType: "fixed",
    payoutAmount: 7000,
    postbackConfig: { method: "GET", urlTemplate: "https://network.test/postback?click_id={click_id}&payout={payout}", headers: {} },
  }, { id: "owner", displayName: "Owner", role: "owner" }, "test network");
  const cpa = await settings.createDirectPartnerAccrualForLead({ leadId: "lead_cpa", partnerRef: "cpa_ref", createdAt: "2026-07-12T00:00:00.000Z" });
  const unknown = await settings.createDirectPartnerAccrualForLead({ leadId: "lead_unknown", partnerRef: "unknown_ref", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(cpa.created, false);
  assert.equal(cpa.reason, "cpa_network_ref");
  assert.equal(unknown.created, false);
  assert.equal(unknown.reason, "partner_ref_unknown_or_inactive");
});

test("CPA Gateway uses payoutAmount as primary postback payout", async () => {
  const { settings } = await loadModules();
  const data = await import(`../apps/web/lib/data.ts?case=${Date.now()}${Math.random()}`);
  const gateway = await import(`../apps/web/lib/cpa-gateway.ts?case=${Date.now()}${Math.random()}`);
  await settings.upsertCpaNetworkDraft({
    id: "network_postback",
    networkId: "network_postback",
    name: "CPA Postback",
    enabled: true,
    partnerRef: "cpa_postback",
    offerId: "offer_1",
    goal: "signed_contract",
    payoutType: "fixed",
    payoutAmount: 7777,
    postbackConfig: { method: "GET", urlTemplate: "https://network.test/postback?click_id={click_id}&payout={payout}", headers: {} },
  }, { id: "owner", displayName: "Owner", role: "owner" }, "postback");
  await data.appendChunkedDataJson("cpa/events.json", { id: "cpa_test_event", direction: "outbound", partnerRef: "cpa_postback", externalClickId: "click-1", eventType: "contract_signed", status: "contract_signed", deliveryStatus: "pending" });
  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    calledUrl = String(url);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await gateway.deliverCpaEventById("cpa_test_event");
    assert.equal(result.ok, true);
    assert.match(calledUrl, /payout=7777/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CRM effective market version uses the same effectiveFrom selection as calculations", async () => {
  const { settings, engine } = await loadModules();
  await settings.createMarketVersion("japan", { active: true, effectiveFrom: "2099-01-01T00:00:00.000Z", currency: "JPY", securityDepositRub: 31000, topAvtoCommissionRub: 48000 }, { id: "owner", displayName: "Owner", role: "owner" }, "scheduled");
  const beforeCrm = (await settings.getMarketsWithEffectiveVersions(new Date("2098-01-01T00:00:00.000Z"))).find((market: any) => market.id === "japan").effectiveVersion;
  const afterCrm = (await settings.getMarketsWithEffectiveVersions(new Date("2100-01-01T00:00:00.000Z"))).find((market: any) => market.id === "japan").effectiveVersion;
  const calc = engine.calculateAvtocenaFromBusinessConfig({ marketId: "japan", marketConfig: afterCrm, carPriceRub: 1000000 });
  assert.equal(beforeCrm.topAvtoCommissionRub, 39000);
  assert.equal(afterCrm.topAvtoCommissionRub, 48000);
  assert.equal(calc.configVersion, afterCrm.id);
});

test("status side effects split direct partner, CPA network and unknown refs", async () => {
  const { settings } = await loadModules();
  const data = await import(`../apps/web/lib/data.ts?case=${Date.now()}${Math.random()}`);

  const direct = await settings.handleLeadPartnerStatusChange({ leadId: "lead_side_direct", partnerRef: "demo", status: "contract_signed", eventType: "contract_signed", externalClickId: "click-direct", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(direct.accrual.created, true);
  assert.equal(direct.cpaEvent, null);
  assert.equal((await data.readChunkedDataJson("cpa/events.json", [])).filter((event: any) => event.leadId === "lead_side_direct").length, 0);

  await settings.upsertCpaNetworkDraft({ id: "network_side", networkId: "network_side", name: "CPA Side", enabled: true, partnerRef: "cpa_side", offerId: "offer_side", goal: "signed_contract", payoutType: "fixed", payoutAmount: 9000, postbackConfig: { method: "GET", urlTemplate: "https://network.test/postback?click_id={click_id}&payout={payout}", headers: {} } }, { id: "owner", displayName: "Owner", role: "owner" }, "side");
  const cpa = await settings.handleLeadPartnerStatusChange({ leadId: "lead_side_cpa", partnerRef: "cpa_side", status: "contract_signed", eventType: "contract_signed", externalClickId: "click-cpa", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(cpa.accrual, null);
  assert.equal(cpa.cpaEvent.eventType, "contract_signed");
  assert.equal((await data.readChunkedDataJson("partners/accruals.json", [])).filter((item: any) => item.leadId === "lead_side_cpa").length, 0);

  const unknown = await settings.handleLeadPartnerStatusChange({ leadId: "lead_side_unknown", partnerRef: "unknown_side", status: "contract_signed", eventType: "contract_signed", externalClickId: "click-unknown", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(unknown.accrual, null);
  assert.equal(unknown.cpaEvent, null);
  assert.equal(unknown.diagnostic.type, "partner_source_unknown");

  const duplicate = await settings.handleLeadPartnerStatusChange({ leadId: "lead_side_direct", partnerRef: "demo", status: "contract_signed", eventType: "contract_signed", externalClickId: "click-direct", createdAt: "2026-07-12T00:00:00.000Z" });
  assert.equal(duplicate.accrual.created, false);
  assert.equal(duplicate.accrual.reason, "duplicate");
});

test("CPA rejection event preserves rejectionReason", async () => {
  const { settings } = await loadModules();
  await settings.upsertCpaNetworkDraft({ id: "network_reject", networkId: "network_reject", name: "CPA Reject", enabled: true, partnerRef: "cpa_reject", offerId: "offer_reject", goal: "lead_rejected", payoutType: "fixed", payoutAmount: 0, postbackConfig: { method: "GET", urlTemplate: "https://network.test/postback?click_id={click_id}&reason={rejection_reason}", headers: {} } }, { id: "owner", displayName: "Owner", role: "owner" }, "reject test");

  const result = await settings.handleLeadPartnerStatusChange({
    leadId: "lead_reject_reason",
    partnerRef: "cpa_reject",
    status: "rejected",
    eventType: "lead_status_changed",
    externalClickId: "external-reject",
    rejectionReason: "Не подходит бюджет",
    createdAt: "2026-07-13T00:00:00.000Z",
  });

  assert.equal(result.accrual, null);
  assert.equal(result.cpaEvent.eventType, "lead_status_changed");
  assert.equal(result.cpaEvent.status, "rejected");
  assert.equal(result.cpaEvent.rejectionReason, "Не подходит бюджет");
});
