import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDirectPartnerPayoutVersion } from "@/lib/business-settings";
import { canEditBusinessSettings, cleanText, nullableNumber } from "@/lib/settings-validation";

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const amount = nullableNumber(form.get("amountRub"));
  if (!amount) return NextResponse.json({ ok: false, error: "amount_required" }, { status: 400 });
  createDirectPartnerPayoutVersion(amount, cleanText(form.get("effectiveFrom"), 80), user, cleanText(form.get("comment"), 1000));
  return NextResponse.redirect(new URL("/crm/settings#partners", request.url));
}
