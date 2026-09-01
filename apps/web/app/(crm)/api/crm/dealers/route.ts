import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getJsonStorage, mutateDataJson } from "@/lib/data";

export const runtime = "nodejs";

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия"],
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

function redirectWithState(request: Request, dealerId: string, state: "saved" | "error", message = "") {
  const path = dealerId ? `/crm/dealers/${encodeURIComponent(dealerId)}` : "/crm/dealers";
  const url = new URL(path, request.url);
  url.searchParams.set("state", state);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return NextResponse.redirect(url, { status: 303 });
}

function imageExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  return "jpg";
}

export async function POST(request: Request) {
  const actor = getCurrentUser();
  if (!actor || !isAdminRole(actor.role)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/crm/dealers");
    login.searchParams.set("error", "auth_required");
    return NextResponse.redirect(login, { status: 303 });
  }

  let dealerId = "";
  try {
    const form = await request.formData();
    dealerId = clean(form.get("dealerId"), 160);
    const name = clean(form.get("name"), 200);
    const city = clean(form.get("city"), 160);
    const statusValue = clean(form.get("status"), 40);
    const status = ["active", "verified", "paused"].includes(statusValue) ? statusValue : "active";
    const verified = status === "verified";
    const markets = clean(form.get("markets"), 2000).split(/,|\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!dealerId || !name || !city) throw new Error("Укажите название компании и город");

    let uploadedHeader: { objectKey: string; url: string } | null = null;
    const headerImage = form.get("headerImage");
    if (headerImage instanceof File && headerImage.size > 0) {
      if (!verified) throw new Error("Шапка доступна только проверенному дилеру");
      if (!headerImage.type.startsWith("image/")) throw new Error("Для шапки нужен файл изображения");
      if (headerImage.size > 8 * 1024 * 1024) throw new Error("Размер шапки не должен превышать 8 МБ");
      const objectKey = `dealers/${dealerId}/header-${Date.now()}.${imageExtension(headerImage.type)}`;
      const storage = getJsonStorage();
      if (!storage.putBinary) throw new Error("Хранилище изображений недоступно");
      await storage.putBinary(objectKey, Buffer.from(await headerImage.arrayBuffer()), headerImage.type);
      uploadedHeader = { objectKey, url: `/api/dealers/${encodeURIComponent(dealerId)}/header` };
    }

    await mutateDataJson<any[]>("dealers/dealers.json", [pilotDealer], (stored) => {
      const dealers = Array.isArray(stored) && stored.length ? stored : [pilotDealer];
      if (!dealers.some((item) => item.id === dealerId)) throw new Error("Компания не найдена");
      return dealers.map((dealer) => dealer.id === dealerId ? {
        ...dealer,
        name,
        city,
        status,
        markets,
        telegramChannel: clean(form.get("telegramChannel"), 200),
        telegramConnected: Boolean(dealer.telegramConnected),
        telegramChatId: clean(form.get("telegramChatId"), 160) || dealer.telegramChatId || "",
        logoUrl: clean(form.get("logoUrl"), 1000) || dealer.logoUrl || "",
        headerImageObjectKey: verified ? uploadedHeader?.objectKey || dealer.headerImageObjectKey || "" : "",
        headerImageUrl: verified ? uploadedHeader?.url || dealer.headerImageUrl || "" : "",
        reviewsEnabled: verified && checked(form.get("reviewsEnabled")),
        photoFeedEnabled: verified && checked(form.get("photoFeedEnabled")),
        verifiedAt: verified ? dealer.verifiedAt || new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
        updatedByUserId: actor.id,
      } : dealer);
    });

    return redirectWithState(request, dealerId, "saved");
  } catch (error) {
    console.error("crm_dealer_save_failed", error);
    return redirectWithState(request, dealerId, "error", error instanceof Error ? error.message : "Не удалось сохранить компанию");
  }
}
