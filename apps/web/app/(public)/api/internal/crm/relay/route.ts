import { pollingEnabled } from "@/lib/crm-polling";
import { NextResponse } from "next/server";
import { crmRelayAuthorized, claimCrmNotices, authorizeCrmNotice, completeCrmNotice } from "@/lib/crm-relay";
import { getTelegramRuntimeConfig, telegramWebhookUrl } from "@/lib/telegram-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {"cache-control": "no-store"}});
export async function POST(request: Request) {
  if (!crmRelayAuthorized(request.headers.get("x-crm-relay-key") || "", process.env.AUTH_ACCESS_KEY || ""))
    return reply({ok: false}, 403);
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "claim") return reply({ok: true, notices: await claimCrmNotices()});
    if (body?.action === "webhook") {
      if (await pollingEnabled()) return reply({ok: false, error: "polling_active"}, 409);
      const config = await getTelegramRuntimeConfig();
      if (!config) return reply({ok: false}, 503);
      return reply({ok: true, url: `${telegramWebhookUrl()}?key=${encodeURIComponent(config.webhookSecret)}`, secret: config.webhookSecret});
    }
    if (typeof body?.id !== "string" || body.id.length > 240 || typeof body?.token !== "string" || body.token.length > 100)
      return reply({ok: false}, 400);
    if (body.action === "authorize") return reply({ok: true, allowed: await authorizeCrmNotice(body.id, body.token)});
    if (body.action === "ack" && (body.messageId === undefined || (Number.isSafeInteger(body.messageId) && body.messageId > 0)))
      return reply({ok: await completeCrmNotice(body.id, body.token, body.messageId)});
    return reply({ok: false}, 400);
  } catch { return reply({ok: false, error: "relay_unavailable"}, 503); }
}
