import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMarketVersion } from "@/lib/business-settings";
import { booleanFromForm, canEditBusinessSettings, cleanText, nullableNumber } from "@/lib/settings-validation";

function parseJsonField(value: FormDataEntryValue | null, fallback: unknown) {
  const raw = cleanText(value, 10000);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  try {
    createMarketVersion(cleanText(form.get("marketId"), 40), {
      name: cleanText(form.get("name"), 120),
      currency: cleanText(form.get("currency"), 12),
      active: booleanFromForm(form.get("active")),
      effectiveFrom: cleanText(form.get("effectiveFrom"), 80),
      topAvtoCommissionRub: nullableNumber(form.get("topAvtoCommissionRub")),
      securityDepositRub: nullableNumber(form.get("securityDepositRub")),
      contractInitialPaymentRub: nullableNumber(form.get("contractInitialPaymentRub")),
      exchangeRateReservePercent: nullableNumber(form.get("exchangeRateReservePercent")),
      exportExpensesRub: nullableNumber(form.get("exportExpensesRub")),
      logisticsRub: nullableNumber(form.get("logisticsRub")),
      brokerRub: nullableNumber(form.get("brokerRub")),
      svhRub: nullableNumber(form.get("svhRub")),
      laboratoryRub: nullableNumber(form.get("laboratoryRub")),
      sbktsRub: nullableNumber(form.get("sbktsRub")),
      eptsRub: nullableNumber(form.get("eptsRub")),
      rfDeliveryRub: nullableNumber(form.get("rfDeliveryRub")),
      otherFixedExpensesRub: nullableNumber(form.get("otherFixedExpensesRub")),
      percentExpenses: parseJsonField(form.get("percentExpenses"), []),
      minMax: parseJsonField(form.get("minMax"), {}),
      dealStages: parseJsonField(form.get("dealStages"), []),
      deliveryDays: cleanText(form.get("deliveryDays"), 80),
      conditionsDescription: cleanText(form.get("conditionsDescription"), 3000),
    }, user, cleanText(form.get("comment"), 1000));
    return NextResponse.redirect(new URL("/crm/settings#markets", request.url));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "settings_error" }, { status: 400 });
  }
}
