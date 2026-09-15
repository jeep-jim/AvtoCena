import assert from "node:assert/strict";
import { test } from "node:test";
import { claimCrmNotices, authorizeCrmNotice, completeCrmNotice } from "../apps/web/lib/crm-relay";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleCrmBotUpdate } from "../apps/web/lib/crm-bot";
import {
  flushCrmNotifications,
  enqueueMessage,
} from "../apps/web/lib/crm-notifications";
import {
  readChunkedDataJson,
  readDataJson,
  writeDataJson,
  resetJsonStorageForTests,
  updateChunkedDataJson,
} from "../apps/web/lib/data";
test("customer request, private admin notification, reply confirmation, retry and revocation", async () => {
  const cwd = process.cwd();
  const env = {
    driver: process.env.JSON_STORAGE_DRIVER,
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.AUTH_SECRET,
  };
  const fetchOriginal = globalThis.fetch;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avtocena-bot-"));
  fs.mkdirSync(path.join(tmp, "data"));
  process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local";
  process.env.TELEGRAM_BOT_TOKEN = "test-only-token";
  process.env.AUTH_SECRET = "test-only-secret";
  resetJsonStorageForTests();
  let fail = false;
  const sent: any[] = [];
  globalThis.fetch = (async (url: any, options: any) => {
    assert.ok(String(url).startsWith("https://api.telegram.org/bot"));
    if (fail)
      return new Response(JSON.stringify({ ok: false }), { status: 503 });
    const payload = JSON.parse(options.body);
    sent.push(payload);
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: sent.length } }),
      { status: 200 },
    );
  }) as typeof fetch;
  let sequence = 1000;
  const message = (id: number, text: string) => ({
    update_id: sequence++,
    message: {
      message_id: sequence,
      chat: { id, type: "private" },
      from: {
        id,
        username: id === 101 ? "customer_test" : "admin_test",
        first_name: "Test",
      },
      text,
    },
  });
  const callback = (id: number, data: string) => ({
    update_id: sequence++,
    callback_query: {
      id: String(sequence),
      from: { id, username: id === 101 ? "customer_test" : "admin_test" },
      message: { chat: { id, type: "private" } },
      data,
    },
  });
  try {
    assert.equal(await handleCrmBotUpdate({message: {chat: {id: -4844138368, type: "group"}, from: {id: 202}, text: "/request"}}, "token"), false);
    assert.equal(sent.length, 0);
    await writeDataJson("auth/users.json", [
      {
        id: "staff",
        role: "admin",
        status: "active",
        telegramUsername: "admin_test",
        displayName: "Admin",
        telegramId: "202",
      },
      {
        id: "regular",
        role: "manager",
        status: "active",
        telegramId: "303",
        telegramUsername: "regular_test",
      },
    ]);
    await handleCrmBotUpdate(message(101, "/admin"), "token");
    assert.match(sent.at(-1).text, /Заявки команды находятся в закрытой группе/);
    await handleCrmBotUpdate(message(101, "https://avtocena.com/cars/offer/missing-car\nтест"), "token");
    assert.ok(sent.some(item => item.text.includes("https://avtocena.com/cars/offer/missing-car")));
    const context = await readDataJson<any>("telegram/crm-dialogs/101.json", {});
    assert.equal(context.offerId, "missing-car");
    await handleCrmBotUpdate(message(101, "/request"), "token");
    await handleCrmBotUpdate(
      message(101, "Toyota, 2 млн, Новокузнецк"),
      "token",
    );
    assert.equal((await readChunkedDataJson("leads/leads.json", [])).length, 0);
    await handleCrmBotUpdate(callback(101, "cust:confirm"), "token");
    const leads = await readChunkedDataJson<any>("leads/leads.json", []);
    assert.equal(leads.length, 1);
    const lead = leads[0];
    assert.equal(lead.telegramUserId, "101");
    await handleCrmBotUpdate(callback(101, "cust:confirm"), "token");
    assert.equal((await readChunkedDataJson("leads/leads.json", [])).length, 1);
    await flushCrmNotifications(4);
    const notices = sent.filter((item) =>
      item.text.startsWith("📩 Новая заявка"),
    );
    assert.equal(notices.length, 0); // Admin delivery runs outside the site.
    const external = await claimCrmNotices();
    assert.equal(external.length, 1);
    assert.equal(external[0].chatId, "-4844138368");
    assert.equal(await authorizeCrmNotice(external[0].id, external[0].token), true);
    assert.equal(await completeCrmNotice(external[0].id, external[0].token, 999), true);
    await handleCrmBotUpdate(callback(404, `cust:chat:${lead.id}`), "token");
    assert.match(sent.at(-1).text, /недоступно/);
    await handleCrmBotUpdate(callback(202, `crm:reply:${lead.id}`), "token");
    await handleCrmBotUpdate(message(202, "Проверим комплектацию"), "token");
    assert.equal(
      (await readChunkedDataJson<any>("telegram/crm-outbox.json", [])).filter(
        (row) => row.audience === "customer",
      ).length,
      0,
    );
    await handleCrmBotUpdate(callback(202, "crm:send"), "token");
    fail = true;
    await flushCrmNotifications(5);
    const pending = (
      await readChunkedDataJson<any>("telegram/crm-outbox.json", [])
    ).find((row) => row.audience === "customer");
    assert.equal(pending.status, "pending");
    assert.equal(pending.attempts, 1);
    await updateChunkedDataJson<any>(
      "telegram/crm-outbox.json",
      pending.id,
      (row) => ({ ...row, nextAttemptAt: 0 }),
    );
    fail = false;
    await flushCrmNotifications(5);
    assert.ok(
      sent.some(
        (item) =>
          item.chat_id === "101" && item.text.includes("Проверим комплектацию"),
      ),
    );
    await enqueueMessage({
      id: "after-revoke",
      chatId: "202",
      leadId: lead.id,
      text: "private",
      audience: "admin",
    });
    await writeDataJson("auth/users.json", [
      { id: "staff", role: "admin", status: "disabled", telegramId: "202" },
    ]);
    const count = sent.length;
    await flushCrmNotifications(5);
    assert.equal(sent.length, count);
  } finally {
    globalThis.fetch = fetchOriginal;
    process.chdir(cwd);
    if (env.driver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = env.driver;
    if (env.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = env.token;
    if (env.secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = env.secret;
    resetJsonStorageForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
