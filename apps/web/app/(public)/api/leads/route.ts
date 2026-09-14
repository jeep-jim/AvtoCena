import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";
import { createLead } from "@/lib/lead-intake";
import { canSeeLead } from "@/lib/crm-visibility";
import { flushCrmNotifications } from "@/lib/crm-notifications";
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isCrmRole(user.role))
    return NextResponse.json({ ok: false }, { status: 401 });
  const leads = (await readChunkedDataJson<any>("leads/leads.json", [])).filter(
    (lead) => canSeeLead(user, lead),
  );
  return NextResponse.json(
    { ok: true, leads },
    { headers: { "cache-control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const response = await createLead(request, await getCurrentUser());
  if (response.ok) {
    try {
      await flushCrmNotifications(2);
    } catch {
      console.error("crm_notifications_pending");
    }
  }
  return response;
}
