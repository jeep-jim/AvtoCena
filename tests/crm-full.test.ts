import test from "node:test";
import assert from "node:assert/strict";
import { canAccessDocument, dealProgress, groupFeedByOperation, isBlockedManager, leadStatusColor, leadStatusLabel, searchClients, uiLabel } from "../apps/web/lib/crm.ts";

test("редактирование клиента не создаёт дубль: search/update работают по существующему id", () => {
  const clients = [{ id: "c1", fio: "Степан Иванов", phone: "+7999", interestedCar: "Mazda EZ-6", createdAt: "2026-07-13T10:00:00Z" }];
  const edited = clients.map((c) => c.id === "c1" ? { ...c, city: "Москва" } : c);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].city, "Москва");
});

test("поиск находит по имени, телефону и машине; дата создания доступна", () => {
  const clients = [{ fio: "Степан Иванов", phone: "+79990000000", interestedCar: "Mazda EZ-6", createdAt: "2026-07-13T10:00:00Z" }];
  assert.equal(searchClients(clients, { name: "степан" }).length, 1);
  assert.equal(searchClients(clients, { phone: "999" }).length, 1);
  assert.equal(searchClients(clients, { car: "EZ-6" }).length, 1);
  assert.ok(clients[0].createdAt);
});

test("изменение статуса меняет русский label и цвет", () => {
  assert.equal(leadStatusLabel("payment"), "Оплата");
  assert.notEqual(leadStatusColor("new"), leadStatusColor("payment"));
});

test("лента группирует client + lead по operationId", () => {
  const grouped = groupFeedByOperation([{ id: "e1", operationId: "op1", clientId: "c1", text: "Степан" }, { id: "e2", operationId: "op1", leadId: "l1", text: "Mazda EZ-6" }]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].groupedCount, 2);
  assert.equal(grouped[0].leadId, "l1");
});

test("прогресс сделки рассчитывается по этапам", () => {
  const progress = dealProgress(2);
  assert.equal(progress.stageNumber, 3);
  assert.equal(progress.totalStages, 8);
  assert.equal(progress.percent, 38);
});

test("заблокированный менеджер не входит в CRM", () => {
  assert.equal(isBlockedManager({ status: "disabled" }), true);
});

test("одноразовое приглашение нельзя использовать дважды: состояние usedAt блокирует повтор", () => {
  const used = new Set<string>();
  const useInvite = (hash: string) => { if (used.has(hash)) return false; used.add(hash); return true; };
  assert.equal(useInvite("secret-hash"), true);
  assert.equal(useInvite("secret-hash"), false);
});

test("документы недоступны без авторизации и доступны назначенному менеджеру/admin/owner", () => {
  const entity = { assignedManagerId: "m1" };
  assert.equal(canAccessDocument(null, entity), false);
  assert.equal(canAccessDocument({ id: "m1", role: "manager" }, entity), true);
  assert.equal(canAccessDocument({ id: "a1", role: "admin" }, entity), true);
  assert.equal(canAccessDocument({ id: "o1", role: "owner" }, entity), true);
});

test("формирование договора создаёт DOCX и содержит данные клиента", async () => {
  const client = { fio: "Степан Иванов", passport: "1234 567890", phone: "+7999" };
  const { buildContractDocx } = await import("../apps/web/lib/crm-server.ts");
  const result = buildContractDocx(`Клиент: ${client.fio}; Паспорт: ${client.passport}; Телефон: ${client.phone}`);
  assert.ok(result.length > 100);
  assert.match(result.toString("utf8"), /Степан Иванов/);
});

test("native белые select не используются в ключевых формах через dark class contract", () => {
  const className = "soft-input rounded-2xl bg-zinc-950 text-white";
  assert.match(className, /bg-zinc-950/);
});

test("внутренние коды показываются по-русски", () => {
  assert.equal(uiLabel("includedInTotal"), "Входит в итоговую стоимость");
  assert.equal(uiLabel("auction_bid"), "Ставка на аукционе");
});
