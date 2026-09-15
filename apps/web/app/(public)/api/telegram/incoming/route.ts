import {NextResponse} from "next/server";
import {getTelegramRuntimeConfig} from "@/lib/telegram-config";
import {enqueueCrmEvent} from "@/lib/crm-incoming-events";
import {requestCrmDelivery} from "@/lib/crm-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const config = await getTelegramRuntimeConfig();
  if (!config?.webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret)
    return NextResponse.json({ok: false}, {status: 403});
  try {
    const raw = await request.text();
    if (raw.length > 256000) return NextResponse.json({ok: false}, {status: 413});
    const result = await enqueueCrmEvent(JSON.parse(raw));
    if (result !== "queued") return NextResponse.json({ok: true});
    const dispatch = await requestCrmDelivery(undefined, undefined, "deliver");
    // Keep Telegram's own retries if GitHub did not accept the wake-up.
    // Queue insertion is idempotent, so retries do not duplicate the event.
    return NextResponse.json({ok: dispatch === "accepted"}, {status: dispatch === "accepted" ? 200 : 503});
  } catch {
    console.error("crm_incoming_retry");
    return NextResponse.json({ok: false}, {status: 503});
  }
}
