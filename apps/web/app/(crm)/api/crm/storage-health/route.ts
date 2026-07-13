import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getJsonStorage, generateId } from "@/lib/data";

export async function GET() {
  const user = getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const storage = getJsonStorage();
  const probePath = `.health/${generateId("probe")}.json`;
  const checks = { bucketAvailable: false, read: false, write: false, delete: false };

  try {
    await storage.readJson("clients/clients.json", []);
    checks.bucketAvailable = true;
    checks.read = true;
    await storage.writeJson(probePath, { ok: true, createdAt: new Date().toISOString() });
    checks.write = true;
    if (storage.deleteJson) {
      await storage.deleteJson(probePath);
      checks.delete = true;
    }
    return NextResponse.json({ ok: true, driver: storage.driver, checks });
  } catch {
    return NextResponse.json({ ok: false, driver: storage.driver, checks, error: "storage_health_failed" }, { status: 500 });
  }
}
