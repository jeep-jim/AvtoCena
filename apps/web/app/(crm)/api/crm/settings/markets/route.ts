import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMarketVersion } from "@/lib/business-settings";
import { booleanFromForm, canEditBusinessSettings, cleanText, nullableNumber } from "@/lib/settings-validation";

function parseJsonField(value: FormDataEntryValue | null, fallback: unknown) {
  const raw = cleanText(value, 10000);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function redirectToSettings(request: Request, state: "saved" | "error", message = "") {
  const url = new URL("/crm/settings", request.url);
  url.hash = "markets";
  url.searchParams.set("state", state);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/crm/settings#markets");
    login.searchParams.set("error", "auth_required");
    return NextResponse.redirect(login, { status: 303 });
  }

  try {
    const form = await request.formData();
    await createMarketVersion(cleanText(form.get("marketId"), 40), {
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
    return redirectToSettings(request, "saved");
  } catch (error) {
    console.error("crm_market_settings_save_failed", error);
    return redirectToSettings(request, "error", error instanceof Error ? error.message : "settings_error");
  }
}
