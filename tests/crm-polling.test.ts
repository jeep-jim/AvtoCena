import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enablePolling, pollBatch, POLL_STATE } from "../apps/web/lib/crm-polling";
import { readDataJson, writeDataJson, resetJsonStorageForTests } from "../apps/web/lib/data";
import { handleCrmBotUpdate } from "../apps/web/lib/crm-bot";

test("polling retains failed update, excludes concurrent poller, and skips completed webhook receipt", async () => {
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-poll-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  try {
    await enablePolling();
    await writeDataJson("telegram/crm-updates/10.json", { done: true, until: 0, lease: "" });
    const handled: number[] = [];
    await assert.rejects(pollBatch(async offset => {
      assert.equal(offset, 0); return [{ update_id: 10 }, { update_id: 11 }, { update_id: 12 }];
    }, async update => {
      handled.push(update.update_id);
      assert.equal((await pollBatch(async () => { throw Error("concurrent poll"); }, async () => {})).inactiveOrBusy, true);
      throw Error("delivery failed");
    }));
    assert.deepEqual(handled, [11]);
    assert.equal((await readDataJson<any>(POLL_STATE, {})).offset, 11);
    await pollBatch(async offset => {
      assert.equal(offset, 11); return [{ update_id: 11 }, { update_id: 12 }];
    }, async update => { handled.push(update.update_id); });
    assert.deepEqual(handled, [11, 11, 12]);
    assert.equal((await readDataJson<any>(POLL_STATE, {})).offset, 13);
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("bot details are shared among active admins and denied to customers and disabled admins", async () => {
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER, originalFetch = globalThis.fetch;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "crm-inbox-"));
  fs.mkdirSync(path.join(tmp, "data")); process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local"; resetJsonStorageForTests();
  const sent: any[] = [];
  globalThis.fetch = (async (_url: any, options: any) => {
    sent.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  }) as typeof fetch;
  try {
    await writeDataJson("auth/users.json", [
      { id: "one", role: "owner", status: "active", telegramId: "101" },
      { id: "two", role: "admin", status: "active", telegramId: "102" },
      { id: "revoked", role: "admin", status: "disabled", telegramId: "103" },
    ]);
    await writeDataJson("leads/leads.json", [{ id: "lead_private", name: "PRIVATE CUSTOMER", phone: "PRIVATE PHONE", status: "new" }]);
    for (const id of [101, 102, 103, 104]) {
      await handleCrmBotUpdate({ update_id: id, callback_query: {
        id: String(id), from: { id }, message: { chat: { id, type: "private" } }, data: "crm:view:lead_private",
      } }, "test-token");
    }
    assert.equal(sent.filter(item => item.text.includes("PRIVATE PHONE")).length, 2);
    assert.ok(sent.filter(item => ["103", "104"].includes(item.chat_id)).every(item => !item.text.includes("PRIVATE")));
  } finally {
    globalThis.fetch = originalFetch; process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
