import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { getContractTemplatesSettings } from "@/lib/business-settings";
import { getJsonStorage } from "@/lib/data";

const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "image/png"
]);

function safeName(value: string) {
  return value.replace(/[\\/\r\n\0"]/g, "_").slice(0, 180) || "download.bin";
}

function collectAssets(settings: any) {
  const assets: any[] = [];
  for (const template of settings.templates || []) if (template.file?.objectKey) assets.push(template.file);
  if (settings.directorSignature?.objectKey) assets.push(settings.directorSignature);
  return assets;
}

export async function GET(request: Request) {
  const user = getCurrentUser();
  if (!user || !isAdminRole(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!key.startsWith("contracts/uploads/")) return NextResponse.json({ ok: false, error: "invalid_key" }, { status: 400 });
  const settings = await getContractTemplatesSettings();
  const asset = collectAssets(settings).find((item) => item.objectKey === key);
  if (!asset || !ALLOWED_TYPES.has(asset.mimeType)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const storage = getJsonStorage();
  if (!storage.getBinary) return NextResponse.json({ ok: false, error: "binary_storage_not_supported" }, { status: 500 });
  const binary = await storage.getBinary(key);
  return new NextResponse(binary.data as any, {
    headers: {
      "content-type": asset.mimeType,
      "content-length": String(binary.size),
      "content-disposition": `attachment; filename="${safeName(asset.originalName || key.split('/').pop() || 'download.bin')}"`,
      "x-content-type-options": "nosniff"
    }
  });
}
