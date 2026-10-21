import { flushCrmPush } from "../apps/web/lib/crm-push";
flushCrmPush(30).then(result => console.log(`Web Push delivered: ${result.sent}`)).catch(() => {console.error("Web Push delivery pending; private details omitted"); process.exitCode = 1;});
