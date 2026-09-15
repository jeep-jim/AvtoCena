import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claimCrmNotices, authorizeCrmNotice, completeCrmNotice, crmRelayKey, crmRelayAuthorized } from "../apps/web/lib/crm-relay";
import { writeDataJson, readChunkedDataJson, updateChunkedDataJson, resetJsonStorageForTests } from "../apps/web/lib/data";

test("relay scopes credentials, leases notices, redacts data and rejects revoked or stale delivery", async () => {
  assert.equal(crmRelayAuthorized(crmRelayKey("master"), "master"), true);
  assert.equal(crmRelayAuthorized("master", "master"), false);
  assert.equal(crmRelayAuthorized("я".repeat(64), "master"), false);
  assert.equal(crmRelayAuthorized("", ""), false);
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-relay-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  try {
    await writeDataJson("auth/users.json", [
      {id: "a", role: "owner", telegramId: "111", status: "active"},
      {id: "b", role: "admin", telegramId: "222", status: "active"},
      {id: "c", role: "manager", telegramId: "333", status: "active"},
    ]);
    await writeDataJson("leads/leads.json", [{id: "lead_test", name: "PRIVATE_NAME", phone: "PRIVATE_PHONE", comment: "PRIVATE_NOTE", notificationRequestedAt: new Date().toISOString()}]);
    const [first, second] = await Promise.all([claimCrmNotices(), claimCrmNotices()]);
    const claims = [...first, ...second];
    assert.equal(claims.length, 2);
    assert.deepEqual(new Set(claims.map(c => c.chatId)), new Set(["111", "222"]));
    assert.doesNotMatch(JSON.stringify(claims), /PRIVATE/);
    assert.equal((await claimCrmNotices()).length, 0);
    const owner = claims.find(c => c.chatId === "111")!;
    assert.equal(await authorizeCrmNotice(owner.id, "bad"), false);
    assert.equal(await authorizeCrmNotice(owner.id, owner.token), true);
    assert.equal(await completeCrmNotice(owner.id, "bad", 123), false);
    assert.equal(await completeCrmNotice(owner.id, owner.token, 123), true);
    assert.equal(await completeCrmNotice(owner.id, owner.token, 123), true);
    const admin = claims.find(c => c.chatId === "222")!;
    await updateChunkedDataJson<any>("telegram/crm-outbox.json", admin.id, row => ({...row, relayUntil: 0}));
    const renewed = (await claimCrmNotices())[0];
    assert.equal(await completeCrmNotice(admin.id, admin.token, 456), false);
    assert.equal(await completeCrmNotice(renewed.id, renewed.token), true);
    assert.equal((await claimCrmNotices()).length, 0); // retry backoff
    await updateChunkedDataJson<any>("telegram/crm-outbox.json", admin.id, row => ({...row, nextAttemptAt: 0}));
    const last = (await claimCrmNotices())[0];
    await writeDataJson("auth/users.json", [{id: "b", role: "admin", telegramId: "222", status: "disabled"}]);
    assert.equal(await authorizeCrmNotice(last.id, last.token), false);
    assert.equal((await readChunkedDataJson<any>("telegram/crm-outbox.json", [])).find(r => r.id === admin.id).status, "cancelled");
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, {recursive: true, force: true});
  }
});
