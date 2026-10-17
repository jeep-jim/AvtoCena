import { leadReadState } from "@/lib/crm-read-state";
import { latestLeadIncomingAt } from "@/lib/crm-alert-state";
import { canSeeLead, activeLead } from "@/lib/crm-visibility";
import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(activeLead);
  const visible=leads.filter(lead=>canSeeLead(user,lead));

  const compact = visible
    .map((lead) => ({
      id: String(lead.id || ""),
      ...leadReadState(lead,user.id),
      createdAt: String(lead.createdAt || ""),
      lastIncomingAt: latestLeadIncomingAt(lead),
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
    .sort((left, right) => Math.max(Date.parse(right.incomingAt)||0,Date.parse(right.assignmentAt)||0)-Math.max(Date.parse(left.incomingAt)||0,Date.parse(left.assignmentAt)||0));

  return NextResponse.json({
    ok: true,
    leads: compact,
    newCount: compact.filter((lead) => lead.unread).length,
    latestCreatedAt: compact[0]?.createdAt || "",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
