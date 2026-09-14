import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCpaNetworks, upsertCpaNetworkDraft } from "@/lib/business-settings";
import { canEditBusinessSettings, cleanText, nullableNumber, booleanFromForm } from "@/lib/settings-validation";

function lines(value: FormDataEntryValue | null) {
  return cleanText(value, 4000).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function json(value: FormDataEntryValue | null, fallback: unknown) {
  const raw = cleanText(value, 10000);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, networks: getCpaNetworks() });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  upsertCpaNetworkDraft({
    id: cleanText(form.get("id"), 160),
    networkId: cleanText(form.get("networkId"), 160),
    name: cleanText(form.get("name"), 200),
    enabled: booleanFromForm(form.get("enabled")),
    partnerRef: cleanText(form.get("partnerRef"), 160),
    offerId: cleanText(form.get("offerId"), 160),
    goal: cleanText(form.get("goal"), 160),
    payoutType: cleanText(form.get("payoutType"), 40),
    payoutAmount: nullableNumber(form.get("payoutAmount")),
    currency: cleanText(form.get("currency"), 12),
    holdDays: nullableNumber(form.get("holdDays")),
    attributionWindowDays: nullableNumber(form.get("attributionWindowDays")),
    dailyCap: nullableNumber(form.get("dailyCap")),
    monthlyCap: nullableNumber(form.get("monthlyCap")),
    allowedTrafficSources: lines(form.get("allowedTrafficSources")),
    forbiddenTrafficSources: lines(form.get("forbiddenTrafficSources")),
    statusMapping: json(form.get("statusMapping"), {}),
    postbackConfig: json(form.get("postbackConfig"), { method: "GET", urlTemplate: "", headers: {} }),
    effectiveFrom: cleanText(form.get("effectiveFrom"), 80),
  }, user, cleanText(form.get("comment"), 1000));
  return NextResponse.redirect(new URL("/crm/settings#cpa", request.url));
}
