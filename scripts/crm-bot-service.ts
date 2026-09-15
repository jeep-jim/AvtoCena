async function main() {
// A continuously supervised process, not a replacement for the shared DB or lease.
process.env.CRM_SERVICE_MODE = "1";
if (process.env.JSON_STORAGE_DRIVER !== "object" || ["AUTH_SECRET", "AUTH_ACCESS_KEY", "TELEGRAM_BOT_TOKEN", "YC_OBJECT_STORAGE_BUCKET", "YC_OBJECT_STORAGE_ACCESS_KEY_ID", "YC_OBJECT_STORAGE_SECRET_ACCESS_KEY"].some(key => !process.env[key])) throw Error("configuration_missing");
const {runPolling} = await import("./crm-telegram-poll");
const {runDelivery} = await import("./crm-telegram-delivery.mjs");
let stop = false;
process.on("SIGTERM", () => {stop = true;});
process.on("SIGINT", () => {stop = true;});
const seconds = Number(process.env.CRM_SERVICE_RUN_SECONDS || 0);
const deadline = seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
let nextDelivery = 0;
while (!stop && Date.now() < deadline) {
  try {await runPolling();} catch {console.error("Bot polling failed; updates retained");}
  if (Date.now() >= nextDelivery) {
    try {await runDelivery();} catch {console.error("Group delivery failed; queue retained");}
    nextDelivery = Date.now() + 15_000;
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}

}
main().catch(() => {console.error("Bot service stopped; check configuration");process.exitCode=1;});
