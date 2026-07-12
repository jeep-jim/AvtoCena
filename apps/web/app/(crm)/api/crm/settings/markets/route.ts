import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMarketVersion } from "@/lib/business-settings";
import { booleanFromForm, canEditBusinessSettings, cleanText, nullableNumber } from "@/lib/settings-validation";

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  try {
    createMarketVersion(cleanText(form.get("marketId"), 40), {
      name: cleanText(form.get("name"), 120),
      currency: cleanText(form.get("currency"), 12),
      active: booleanFromForm(form.get("active")),
      topAvtoCommissionRub: nullableNumber(form.get("topAvtoCommissionRub")),
      securityDepositRub: nullableNumber(form.get("securityDepositRub")),
      contractInitialPaymentRub: nullableNumber(form.get("contractInitialPaymentRub")),
      exchangeRateReservePercent: nullableNumber(form.get("exchangeRateReservePercent")),
      deliveryDays: cleanText(form.get("deliveryDays"), 80),
      conditionsDescription: cleanText(form.get("conditionsDescription"), 3000),
      status: booleanFromForm(form.get("active")) ? "active" : "draft",
    }, user, cleanText(form.get("comment"), 1000));
    return NextResponse.redirect(new URL("/crm/settings#markets", request.url));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "settings_error" }, { status: 400 });
  }
}
