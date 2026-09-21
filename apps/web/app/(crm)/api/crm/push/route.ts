import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { pushKeys, registerPush, removePush } from "@/lib/crm-push";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, {status, headers: {"cache-control": "no-store"}});
export async function GET() {
  const user = await getCurrentUser(); if (!user || !isCrmRole(user.role)) return json({error: "auth_required"}, 401);
  return json({publicKey: (await pushKeys())?.publicKey});
}
async function update(request: Request, remove: boolean) {
  if (!isCalculationOriginAllowed(request)) return json({error: "origin_forbidden"}, 403);
  const user = await getCurrentUser(); if (!user || !isCrmRole(user.role)) return json({error: "auth_required"}, 401);
  const text = await request.text(); if (text.length > 4096) return json({error: "invalid_subscription"}, 400);
  try { const value = JSON.parse(text); if (remove) { if (typeof value.endpoint !== "string" || value.endpoint.length > 2048) throw Error(); await removePush(user.id, value.endpoint); } else await registerPush(user, value); return json({ok: true}); }
  catch { return json({error: "subscription_not_saved"}, 400); }
}
export const POST = (request: Request) => update(request, false);
export const DELETE = (request: Request) => update(request, true);
