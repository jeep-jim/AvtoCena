import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {pollingEnabled} from "../apps/web/lib/crm-polling";

async function main() {
  if (process.env.JSON_STORAGE_DRIVER !== "object" || !process.env.AUTH_ACCESS_KEY) throw Error();
  // Read-only checks: no updates consumed, no notices claimed or sent.
  if (!(await pollingEnabled())) throw Error();
  execFileSync(process.execPath, ["scripts/crm-telegram-delivery.mjs", "check-group"], {
    stdio: "ignore", timeout: 65000, env: {...process.env, CRM_SERVICE_MODE: "0"},
  });
  const info = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`, {signal: AbortSignal.timeout(15000)});
  const webhook = await info.json();
  if (!info.ok || !webhook.ok || webhook.result.url) throw Error();
  const key = crypto.createHmac("sha256", process.env.AUTH_ACCESS_KEY).update("avtocena:crm-notification-relay:v1").digest("hex");
  const response = await fetch("https://avtocena.com/api/internal/crm/relay", {
    method: "POST", headers: {"content-type": "application/json", "x-crm-relay-key": key},
    body: JSON.stringify({action: "authorize", id: "preflight-nonexistent", token: "preflight-nonexistent"}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok || result.allowed !== false) throw Error();
  console.log("Preflight passed: storage, polling mode, bot, approved group and CRM accessible; no messages sent.");
}
main().catch(() => {console.error("Preflight failed. Service must not be activated; credentials or network require checking."); process.exitCode = 1;});
