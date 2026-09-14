import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appendChangeLog, getContractTemplatesSettings, getSettingsChangeLog } from "@/lib/business-settings";
import { getJsonStorage, mutateDataJson } from "@/lib/data";
import { canEditBusinessSettings, cleanText, booleanFromForm } from "@/lib/settings-validation";

const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const TEMPLATE_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
]);
const SIGNATURE_TYPES = new Set(["image/png"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function id(prefix: string) {
  try { return `${prefix}_${crypto.randomUUID()}`; } catch { return `${prefix}_${Date.now()}`; }
}

function parseLines(value: FormDataEntryValue | null) {
  return cleanText(value, 12000).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function parseMappingText(value: FormDataEntryValue | null) {
  return Object.fromEntries(cleanText(value, 12000).split(/\r?\n/).map((line) => line.split("=").map((part) => part.trim())).filter(([key, val]) => key && val));
}

async function storeFile(file: File | null, allowedTypes: Set<string>, maxBytes: number, folder: string, operationId: string) {
  if (!file || file.size === 0) return null;
  if (!allowedTypes.has(file.type)) throw new Error("unsupported_file_type");
  if (file.size > maxBytes) throw new Error("file_too_large");
  const extension = file.type === "image/png" ? ".png" : file.type === "application/pdf" ? ".pdf" : ".docx";
  const safeName = `${operationId}-${folder}${extension}`;
  const objectKey = ["contracts", "uploads", folder, safeName].join("/");
  const data = Buffer.from(await file.arrayBuffer());
  const storage = getJsonStorage();
  if (!storage.putBinary) throw new Error("binary_storage_not_supported");
  let stored;
  try {
    stored = await storage.putBinary(objectKey, data, file.type, { ifNoneMatch: "*" });
  } catch (error) {
    if (error instanceof Error && error.message === "storage_conflict" && storage.getBinary) {
      const existing = await storage.getBinary(objectKey);
      const checksum = crypto.createHash("sha256").update(data).digest("hex");
      if (existing.checksum === checksum) stored = { objectKey, mimeType: file.type, size: data.length, checksum };
      else throw error;
    } else {
      throw error;
    }
  }
  return { objectKey: stored.objectKey, originalName: file.name, mimeType: stored.mimeType, size: stored.size, checksum: stored.checksum };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, contracts: await getContractTemplatesSettings(), pending: "Реальная генерация будет подключена после получения файла шаблона договора." });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  const operationId = cleanText(form.get("operationId"), 120);
  if (!UUID_RE.test(operationId)) return NextResponse.json({ ok: false, error: "invalid_operation_id" }, { status: 400 });
  const uploadedKeys: string[] = [];
  let saved = false;
  try {
    const existing = await getContractTemplatesSettings();
    const duplicate = (existing.templates || []).find((item: any) => item.operationId === operationId || item.id === `contract_template_${operationId}`);
    if (duplicate) {
      const changeLog = await getSettingsChangeLog();
      if (!changeLog.some((entry: any) => entry.id === `contract_change_${operationId}`)) {
        await appendChangeLog({ id: `contract_change_${operationId}`, entityType: "contract-template", entityId: duplicate.id, changedByUserId: user.id, changedByName: user.displayName, oldValue: null, newValue: duplicate, comment: cleanText(form.get("comment"), 1000) });
      }
      return NextResponse.json({ ok: true, redirectTo: "/crm/settings#contracts" });
    }
    const templateFile = await storeFile(form.get("templateFile") as File | null, TEMPLATE_TYPES, MAX_TEMPLATE_BYTES, "templates", operationId);
    if (templateFile?.objectKey) uploadedKeys.push(templateFile.objectKey);
    const signatureFile = await storeFile(form.get("signatureFile") as File | null, SIGNATURE_TYPES, MAX_SIGNATURE_BYTES, "signatures", operationId);
    if (signatureFile?.objectKey) uploadedKeys.push(signatureFile.objectKey);
    const template = {
      id: `contract_template_${operationId}`,
      operationId,
      title: cleanText(form.get("title"), 200),
      market: cleanText(form.get("market"), 80),
      version: cleanText(form.get("version"), 40) || "1",
      status: booleanFromForm(form.get("active")) ? "active" : "archived",
      effectiveFrom: cleanText(form.get("effectiveFrom"), 80) || new Date().toISOString(),
      placeholders: parseLines(form.get("placeholdersText")),
      placeholderMapping: parseMappingText(form.get("placeholderMappingText")),
      includeDirectorSignatureByDefault: booleanFromForm(form.get("includeDirectorSignatureByDefault")),
      file: templateFile,
      generationStatus: "pending_template_integration",
      createdAt: new Date().toISOString(),
      createdByUserId: user.id,
    };
    await mutateDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [] }, (settings) => {
      const exists = (settings.templates || []).some((item: any) => item.operationId === operationId || item.id === template.id);
      if (exists) return settings;
      return {
      ...settings,
      templates: [...(settings.templates || []), template],
      directorSignature: signatureFile ? { ...signatureFile, uploadedAt: new Date().toISOString(), uploadedByUserId: user.id, note: "PNG-подпись является визуальным наложением на документ и не является электронной подписью." } : settings.directorSignature,
    };
    });
    saved = true;
    await appendChangeLog({ id: `contract_change_${operationId}`, entityType: "contract-template", entityId: template.id, changedByUserId: user.id, changedByName: user.displayName, oldValue: null, newValue: template, comment: cleanText(form.get("comment"), 1000) });
    return NextResponse.json({ ok: true, redirectTo: "/crm/settings#contracts" });
  } catch (error) {
    if (!saved) {
      const storage = getJsonStorage();
      await Promise.all(uploadedKeys.map((key) => storage.deleteBinary?.(key).catch(() => undefined)));
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "contract_template_error" }, { status: 400 });
  }
}
