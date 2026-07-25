import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { mutateDataJson } from "@/lib/data";

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия", "Кыргызстан"],
  telegramChannel: "",
  telegramConnected: false,
  logoUrl: "",
  headerImageUrl: "",
  reviewsEnabled: true,
  photoFeedEnabled: true,
};

function clean(value: FormDataEntryValue | null, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function checked(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1";
}

export async function POST(request: Request) {
  const actor = getCurrentUser();
  if (!actor || !isAdminRole(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const form = await request.formData();
  const dealerId = clean(form.get("dealerId"), 160);
  const name = clean(form.get("name"), 200);
  const city = clean(form.get("city"), 160);
  const statusValue = clean(form.get("status"), 40);
  const status = ["active", "verified", "paused"].includes(statusValue) ? statusValue : "active";
  const verified = status === "verified";
  const markets = clean(form.get("markets"), 2000).split(/,|\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (!dealerId || !name || !city) return NextResponse.json({ ok: false, error: "required_fields" }, { status: 400 });

  await mutateDataJson<any[]>("dealers/dealers.json", [pilotDealer], (stored) => {
    const dealers = Array.isArray(stored) && stored.length ? stored : [pilotDealer];
    if (!dealers.some((item) => item.id === dealerId)) throw new Error("dealer_not_found");
    return dealers.map((dealer) => dealer.id === dealerId ? {
      ...dealer,
      name,
      city,
      status,
      markets,
      telegramChannel: clean(form.get("telegramChannel"), 200),
      telegramConnected: checked(form.get("telegramConnected")),
      telegramChatId: clean(form.get("telegramChatId"), 160) || dealer.telegramChatId || "",
      logoUrl: clean(form.get("logoUrl"), 1000) || dealer.logoUrl || "",
      headerImageUrl: verified ? clean(form.get("headerImageUrl"), 1000) : "",
      reviewsEnabled: verified && checked(form.get("reviewsEnabled")),
      photoFeedEnabled: verified && checked(form.get("photoFeedEnabled")),
      verifiedAt: verified ? dealer.verifiedAt || new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
      updatedByUserId: actor.id,
    } : dealer);
  });

  return NextResponse.redirect(new URL(`/crm/dealers/${encodeURIComponent(dealerId)}`, request.url));
}
