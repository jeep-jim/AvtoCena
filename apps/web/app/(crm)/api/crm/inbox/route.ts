import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = getCurrentUser();
  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const visible = isAdminRole(user.role)
    ? leads
    : leads.filter((lead) => lead.assignedManagerId === user.id || lead.createdByManagerId === user.id);

  const compact = visible
    .map((lead) => ({
      id: String(lead.id || ""),
      createdAt: String(lead.createdAt || ""),
      updatedAt: String(lead.updatedAt || ""),
      status: String(lead.status || "new"),
      name: String(lead.name || ""),
      phone: String(lead.phone || ""),
      telegram: String(lead.telegram || ""),
      car: String(lead.car || ""),
      offerTitle: String(lead.offerTitle || ""),
      selectedOffers: Array.isArray(lead.selectedOffers)
        ? lead.selectedOffers.slice(0, 5).map((offer: any) => ({ title: String(offer?.title || "") }))
        : [],
    }))
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));

  return NextResponse.json({
    ok: true,
    leads: compact,
    newCount: compact.filter((lead) => lead.status === "new").length,
    latestCreatedAt: compact[0]?.createdAt || "",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
