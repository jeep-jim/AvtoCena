import crypto from "node:crypto";
import {NextResponse} from "next/server";
import {mutateDataJson} from "./data";

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export type Entry = {at: number; fingerprint: string; offers: string[]};
export function needsCaptcha(entries: Entry[], offers: string[], now = Date.now()) {
  const active = entries.filter(e => e.at > now - WINDOW_MS);
  return active.length >= 3 || offers.some(id => active.filter(e => e.offers.includes(id)).length >= 2);
}
function hash(value: string) {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "development-only").update(value).digest("hex");
}
export function leadVisitor(request: Request) {
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)ac_lead_visitor=([^;]+)/)?.[1] || "";
  const [id, signature] = cookie.split(".");
  const valid = /^[a-f0-9-]{36}$/.test(id || "") && signature === hash(`visitor:${id}`);
  const visitor = valid ? id : crypto.randomUUID();
  return {id: visitor, cookie: `${visitor}.${hash(`visitor:${visitor}`)}`};
}
export async function validateCaptcha(token: string) {
  if (!token || token.length > 10000) return false;
  const response = await fetch("https://smartcaptcha.cloud.yandex.ru/validate", {
    method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({secret: process.env.SMARTCAPTCHA_SERVER_KEY || "", token}),
    signal: AbortSignal.timeout(5000), cache: "no-store",
  });
  if (!response.ok) throw new Error("captcha_unavailable");
  const result = await response.json();
  const hosts = (process.env.SMARTCAPTCHA_ALLOWED_HOSTS || "avtocena.com,www.avtocena.com").split(",").map(s => s.trim());
  return result.status === "ok" && hosts.includes(result.host);
}
class Challenge extends Error {}
// Reservations are persisted atomically before intake. Retries of the exact same
// operation do not consume another slot; changed contents cannot reuse that slot.
export async function guardLead(request: Request, body: Record<string, unknown>, offers: string[], contacts: string[]) {
  const sitekey = process.env.SMARTCAPTCHA_CLIENT_KEY;
  const secret = process.env.SMARTCAPTCHA_SERVER_KEY;
  if (!sitekey && !secret) return null; // Activation requires deployed keys.
  if (!sitekey || !secret) return NextResponse.json({ok:false,error:"Проверка временно недоступна. Повторите отправку позже."}, {status:503});
  const visitor = leadVisitor(request).id;
  const identities = [`visitor:${visitor}`, ...contacts.filter(Boolean).map(c => `contact:${c.toLowerCase()}`)];
  const {captchaToken, ...payload} = body;
  const fingerprint = hash(JSON.stringify([offers, payload]) + (body.operationId ? "" : crypto.randomUUID()));
  let verified = false;
  try {
    for (const identity of [...new Set(identities)]) {
      const key = `security/lead-attempts/${hash(identity)}.json`;
      const reserve = () => mutateDataJson<Entry[]>(key, [], entries => {
        const now = Date.now();
        const active = entries.filter(e => e.at > now - WINDOW_MS);
        if (active.some(e => e.fingerprint === fingerprint)) return active;
        if (!verified && needsCaptcha(active, offers, now)) throw new Challenge();
        return [...active.slice(-99), {at:now,fingerprint,offers}];
      });
      try { await reserve(); }
      catch (error) {
        if (!(error instanceof Challenge)) throw error;
        if (!verified && typeof captchaToken === "string") verified = await validateCaptcha(captchaToken);
        if (!verified) return NextResponse.json({ok:false,code:"captcha_required",sitekey,error:"Подтвердите, что вы не робот."}, {status:429});
        await reserve();
      }
    }
    return null;
  } catch {
    return NextResponse.json({ok:false,error:"Не удалось проверить отправку. Данные сохранены в форме — попробуйте ещё раз."}, {status:503});
  }
}
