import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createMarketVersion } from "@/lib/business-settings";
import { writeDataJson } from "@/lib/data";
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
    const marketId = cleanText(form.get("marketId"), 40);
    const securityDepositRub = nullableNumber(form.get("securityDepositRub"));
    const topAvtoCommissionRub = nullableNumber(form.get("topAvtoCommissionRub"));
    const enteredInitialPayment = nullableNumber(form.get("contractInitialPaymentRub"));
    const minimumInitialPayment = Number(securityDepositRub || 0) + Number(topAvtoCommissionRub || 0);
    const contractInitialPaymentRub = enteredInitialPayment === null
      ? minimumInitialPayment
      : Math.max(enteredInitialPayment, minimumInitialPayment);

    const version = await createMarketVersion(marketId, {
      name: cleanText(form.get("name"), 120),
      currency: cleanText(form.get("currency"), 12),
      active: booleanFromForm(form.get("active")),
      effectiveFrom: cleanText(form.get("effectiveFrom"), 80),
      topAvtoCommissionRub,
      securityDepositRub,
      contractInitialPaymentRub,
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
      // Средний системный профиль provisional=true. После ручного сохранения владельцем
      // эта конкретная версия становится подтверждённой и используется как точная бизнес-конфигурация.
      provisional: false,
    }, user, cleanText(form.get("comment"), 1000));

    // Карточки применяют новую версию при следующем открытии. Этот маркер нужен
    // production workflow для полного пересчёта сохранённых цен и поисковых индексов.
    await writeDataJson(`catalog/reprice-requests/${marketId}.json`, {
      marketId,
      configVersion: version.id,
      requestedAt: new Date().toISOString(),
      requestedByUserId: user.id,
      status: "pending",
    });
    return redirectToSettings(request, "saved");
  } catch (error) {
    console.error("crm_market_settings_save_failed", error);
    return redirectToSettings(request, "error", error instanceof Error ? error.message : "settings_error");
  }
}
