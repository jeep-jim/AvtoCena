import { after } from "next/server";
import { flushCrmPush } from "@/lib/crm-push";
import {leadVisitor} from "@/lib/lead-antispam";
import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { readChunkedDataJson } from "@/lib/data";
import { createLead } from "@/lib/lead-intake";
import { canSeeLead } from "@/lib/crm-visibility";
import { flushCrmNotifications } from "@/lib/crm-notifications";
import { requestCrmDelivery } from "@/lib/crm-dispatch";
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
  const visitor = leadVisitor(request);
  const headers = new Headers(request.headers);
  headers.set("cookie", `${(headers.get("cookie") || "").replace(/(?:^|;\s*)ac_lead_visitor=[^;]*/g, "")}; ac_lead_visitor=${visitor.cookie}`);
  const response = await createLead(new Request(request, {headers}), await getCurrentUser());
  response.cookies.set("ac_lead_visitor", visitor.cookie, {httpOnly:true, secure:process.env.NODE_ENV === "production", sameSite:"lax", path:"/", maxAge:86400 * 30});
  response.headers.set("cache-control", "no-store");
  if (response.ok) {
    // Await a bounded wake-up: a detached promise can be frozen by serverless.
    // The saved lead is already durable; a failed wake-up never fails intake.
    after(() => flushCrmPush(5).catch(() => undefined));
    await requestCrmDelivery();
    try {
      await flushCrmNotifications(2);
    } catch {
      console.error("crm_notifications_pending");
    }
  }
  return response;
}
