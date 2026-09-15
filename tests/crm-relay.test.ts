import groupTarget from "../apps/web/lib/crm-group-target.json";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimCrmNotices, authorizeCrmNotice, completeCrmNotice, crmRelayKey, crmRelayAuthorized } from "../apps/web/lib/crm-relay";
import { writeDataJson, readChunkedDataJson, updateChunkedDataJson, resetJsonStorageForTests } from "../apps/web/lib/data";

test("group relay needs no staff binding, preserves leases, excludes internal notes and rejects archived delivery", async () => {
  assert.equal(crmRelayAuthorized(crmRelayKey("master"), "master"), true);
  assert.equal(crmRelayAuthorized("master", "master"), false);
  assert.equal(crmRelayAuthorized("я".repeat(64), "master"), false);
  assert.equal(crmRelayAuthorized("", ""), false);
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-relay-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  try {
    await writeDataJson("auth/users.json", []); // Group delivery needs no linked staff.
    await writeDataJson("leads/leads.json", [{id: "lead_test", name: "PRIVATE_NAME", phone: "PRIVATE_PHONE", comment: "CUSTOMER_COMMENT", internalNote: "PRIVATE_NOTE", notificationRequestedAt: new Date().toISOString()}]);
    const [first, second] = await Promise.all([claimCrmNotices(), claimCrmNotices()]);
    const claims = [...first, ...second];
    assert.equal(claims.length, 1);
    assert.deepEqual(new Set(claims.map(c => c.chatId)), new Set([groupTarget.chatId]));
    assert.match(claims[0].text, /PRIVATE_PHONE/);
    assert.doesNotMatch(JSON.stringify(claims), /PRIVATE_NOTE/);
    assert.equal((await claimCrmNotices()).length, 0);
    const owner = claims[0];
    assert.equal(await authorizeCrmNotice(owner.id, "bad"), false);
    assert.equal(await authorizeCrmNotice(owner.id, owner.token), true);
    assert.equal(await completeCrmNotice(owner.id, "bad", 123), false);
    const admin = owner;
    await updateChunkedDataJson<any>("telegram/crm-outbox.json", admin.id, row => ({...row, relayUntil: 0}));
    const renewed = (await claimCrmNotices())[0];
    assert.equal(await completeCrmNotice(admin.id, admin.token, 456), false);
    assert.equal(await completeCrmNotice(renewed.id, renewed.token), true);
    assert.equal((await claimCrmNotices()).length, 0); // retry backoff
    await updateChunkedDataJson<any>("telegram/crm-outbox.json", admin.id, row => ({...row, nextAttemptAt: 0}));
    const last = (await claimCrmNotices())[0];
    await updateChunkedDataJson<any>("leads/leads.json", "lead_test", row => ({...row, archivedAt: new Date().toISOString()}));
    assert.equal(await authorizeCrmNotice(last.id, last.token), false);
    assert.equal((await readChunkedDataJson<any>("telegram/crm-outbox.json", [])).find(r => r.id === admin.id).status, "cancelled");
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test("migration sends pending legacy lead once to the group and leaves completed history alone", async () => {
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-group-migration-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  try {
    const stamp = new Date().toISOString();
    await writeDataJson("leads/leads.json", [
      {id: "pending", notificationRequestedAt: stamp, notificationsQueuedAt: stamp},
      {id: "history", notificationRequestedAt: stamp, notificationsQueuedAt: stamp},
      {id: "archived", notificationRequestedAt: stamp, archivedAt: stamp},
    ]);
    await writeDataJson("telegram/crm-outbox.json", [
      {id: "legacy", leadId: "pending", audience: "admin", chatId: "111", status: "pending", createdAt: stamp},
      {id: "complete", leadId: "history", audience: "admin", chatId: "111", status: "sent", createdAt: stamp},
    ]);
    const notices = await claimCrmNotices();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].chatId, groupTarget.chatId);
    assert.equal(notices[0].id, "group_pending");
    assert.equal(await completeCrmNotice(notices[0].id, notices[0].token, 123), true);
    assert.equal(await completeCrmNotice(notices[0].id, notices[0].token, 123), true);
    assert.deepEqual(await claimCrmNotices(), []);
    const rows = await readChunkedDataJson<any>("telegram/crm-outbox.json", []);
    assert.equal(rows.find(r => r.id === "legacy").status, "cancelled");
    assert.equal(rows.filter(r => r.audience === "group").length, 1);
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, {recursive: true, force: true});
  }
});
