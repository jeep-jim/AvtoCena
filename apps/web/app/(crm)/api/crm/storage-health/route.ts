import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { checkStorageBootstrap, getJsonStorage, generateId } from "@/lib/data";

export async function GET() {
  const user = getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const storage = getJsonStorage();
  const checks = { bucketAvailable: false, read: false, write: false, delete: false };
  let bootstrap: Awaited<ReturnType<typeof checkStorageBootstrap>> | { driver: string; collections: any[]; bootstrapCompleted: false } = {
    driver: storage.driver,
    collections: [],
    bootstrapCompleted: false
  };

  try {
    bootstrap = await checkStorageBootstrap();
    const probePath = `.health/${generateId("probe")}.json`;
    await storage.readJson("clients/clients.json", []);
    checks.bucketAvailable = true;
    checks.read = true;
    await storage.writeJson(probePath, { ok: true, createdAt: new Date().toISOString() });
    checks.write = true;
    if (storage.deleteJson) {
      await storage.deleteJson(probePath);
      checks.delete = true;
    }
    return NextResponse.json({ ok: true, driver: storage.driver, checks, bootstrap });
  } catch {
    return NextResponse.json({ ok: false, driver: storage.driver, checks, bootstrap, error: "storage_health_failed" }, { status: 500 });
  }
}
