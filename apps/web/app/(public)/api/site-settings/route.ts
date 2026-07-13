import { NextResponse } from "next/server";
import { getActiveSiteBusinessVersion } from "@/lib/business-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = getActiveSiteBusinessVersion();
  return NextResponse.json({
    ok: true,
    settings: {
      displayPartnerPayoutRub: settings?.displayPartnerPayoutRub || 10000,
      activeMarkets: settings?.activeMarkets || ["japan", "china", "korea", "uae", "europe"],
      contacts: settings?.contacts || {},
      minimumBudgetRub: settings?.minimumBudgetRub || 1500000,
      calculationReservePercent: settings?.calculationReservePercent || 0,
      deliveryTermsText: settings?.deliveryTermsText || "",
      commercialNotes: settings?.commercialNotes || {},
    },
  });
}
