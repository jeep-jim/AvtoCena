import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "node:crypto";
import { browserConfig, callBrowser } from "@/lib/browser-pilot/worker";
import { browserResearchPrompt } from "@/lib/browser-pilot/prompt";
import { getOffer } from "@/lib/catalog/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COOKIE = "ac_browser_pilot";
const json = (error: string, status: number) => NextResponse.json({error}, {status, headers: {"Cache-Control": "no-store"}});
export async function GET(request: NextRequest) {
 const config = await browserConfig();
 const response = NextResponse.json({enabled: Boolean(config?.enabled && config.expiresAt > Date.now()), maxSessions: 2, idleSeconds: 90, maxMinutes: 10}, {headers: {"Cache-Control": "no-store"}});
 if (!/^[a-f0-9]{64}$/.test(request.cookies.get(COOKIE)?.value || "")) response.cookies.set(COOKIE, randomBytes(32).toString("hex"), {httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/browser-pilot", maxAge: 86400});
 return response;
}
export async function POST(request: NextRequest) {
 const origin = process.env.NODE_ENV === "production" ? "https://avtocena.com" : new URL(request.url).origin;
 if (request.headers.get("origin") !== origin) return json("invalid_origin", 403);
 if (Number(request.headers.get("content-length") || 0) > 8192) return json("body_too_large", 413);
 let body: Record<string, unknown>;
 try { const reader = request.body?.getReader(); if (!reader) return json("invalid_body", 400); let size = 0; const chunks: Uint8Array[] = []; while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8192) { await reader.cancel(); return json("body_too_large", 413); } chunks.push(part.value); } body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json("invalid_body", 400); }
 if (!body || typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id) || !["create", "close", "heartbeat", "frame", "send", "scroll"].includes(String(body.action))) return json("invalid_request", 400);
 const config = await browserConfig();
 if (!config || (!config.enabled && body.action !== "close") || (config.expiresAt <= Date.now() && body.action !== "close")) return json("pilot_unavailable", 503);
 let cookie = request.cookies.get(COOKIE)?.value;
 if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) { if (body.action !== "create") return json("session_not_found", 410); cookie = randomBytes(32).toString("hex"); }
 const owner = createHmac("sha256", process.env.AUTH_SECRET!).update(cookie).digest("hex");
 const payload: Record<string, unknown> = {action: body.action, id: body.id, owner};
 try {
  if (body.action === "create") {
   if (typeof body.offerId !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(body.offerId)) return json("invalid_offer", 400);
   const offer = await getOffer(body.offerId); if (!offer) return json("offer_not_found", 404);
   payload.prompt = browserResearchPrompt(offer.id, {make: offer.make, model: offer.model, year: offer.year, trim: offer.trim, market: offer.market, powertrainKind: offer.powertrainKind, chassisCode: typeof offer.operational?.chassisCode === "string" ? offer.operational.chassisCode : undefined});
  }
  if (body.action === "send") { if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 2500) return json("invalid_message", 400); payload.text = body.text; }
  if (body.action === "scroll") { if (typeof body.delta !== "number" || !Number.isFinite(body.delta) || Math.abs(body.delta) > 1000) return json("invalid_scroll", 400); payload.delta = body.delta; }
  const result = await callBrowser(config, payload);
  const response = new NextResponse(new Uint8Array(result.data), {status: result.status, headers: {"Content-Type": result.type, "Cache-Control": "no-store"}});
  if (body.action === "create") response.cookies.set(COOKIE, cookie, {httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/browser-pilot", maxAge: 86400});
  return response;
 } catch { return json("pilot_unavailable", 503); }
}
