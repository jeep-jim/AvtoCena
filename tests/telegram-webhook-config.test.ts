import test from "node:test";
import assert from "node:assert/strict";
import { deriveTelegramWebhookSecret, resolveTelegramWebhookSecret } from "../apps/web/lib/telegram-config";

test("webhook registration uses the deployment secret also expected by the receiver", () => {
  const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
  const auth = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = "test-only-auth";
    process.env.TELEGRAM_WEBHOOK_SECRET = " deployment-secret ";
    assert.equal(resolveTelegramWebhookSecret("avtocena_bot"), "deployment-secret");
    assert.notEqual(resolveTelegramWebhookSecret("avtocena_bot"), deriveTelegramWebhookSecret("avtocena_bot"));
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    assert.equal(resolveTelegramWebhookSecret("avtocena_bot"), deriveTelegramWebhookSecret("avtocena_bot"));
    assert.equal(resolveTelegramWebhookSecret("@AvtoCena_bot"), resolveTelegramWebhookSecret("avtocena_bot"));
  } finally {
    if(previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
    if(auth === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = auth;
  }
});
