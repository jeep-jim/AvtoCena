import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { appendChangeLog, getContractTemplatesSettings } from "@/lib/business-settings";
import { getDataRoot, mutateDataJson } from "@/lib/data";
import { canEditBusinessSettings, cleanText, booleanFromForm } from "@/lib/settings-validation";

const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const TEMPLATE_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
]);
const SIGNATURE_TYPES = new Set(["image/png"]);

function id(prefix: string) {
  try { return `${prefix}_${crypto.randomUUID()}`; } catch { return `${prefix}_${Date.now()}`; }
}

function parseLines(value: FormDataEntryValue | null) {
  return cleanText(value, 12000).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function parseMappingText(value: FormDataEntryValue | null) {
  return Object.fromEntries(cleanText(value, 12000).split(/\r?\n/).map((line) => line.split("=").map((part) => part.trim())).filter(([key, val]) => key && val));
}

async function storeFile(file: File | null, allowedTypes: Set<string>, maxBytes: number, folder: string) {
  if (!file || file.size === 0) return null;
  if (!allowedTypes.has(file.type)) throw new Error("unsupported_file_type");
  if (file.size > maxBytes) throw new Error("file_too_large");
  const extension = file.type === "image/png" ? ".png" : file.type === "application/pdf" ? ".pdf" : ".docx";
  const safeName = `${id("upload")}${extension}`;
  const relativePath = path.join("contracts", "uploads", folder, safeName);
  const targetPath = path.join(getDataRoot(), relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, Buffer.from(await file.arrayBuffer()));
  return { filePath: relativePath, originalName: file.name, mimeType: file.type, size: file.size };
}

export async function GET() {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, contracts: await getContractTemplatesSettings(), pending: "Реальная генерация будет подключена после получения файла шаблона договора." });
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  try {
    const settings = await getContractTemplatesSettings();
    const templateFile = await storeFile(form.get("templateFile") as File | null, TEMPLATE_TYPES, MAX_TEMPLATE_BYTES, "templates");
    const signatureFile = await storeFile(form.get("signatureFile") as File | null, SIGNATURE_TYPES, MAX_SIGNATURE_BYTES, "signatures");
    const template = {
      id: id("contract_template"),
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
    const next = {
      ...settings,
      templates: [...(settings.templates || []), template],
      directorSignature: signatureFile ? { ...signatureFile, uploadedAt: new Date().toISOString(), uploadedByUserId: user.id, note: "PNG-подпись является визуальным наложением на документ и не является электронной подписью." } : settings.directorSignature,
    };
    await mutateDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [] }, () => next);
    await appendChangeLog({ entityType: "contract-template", entityId: template.id, changedByUserId: user.id, changedByName: user.displayName, oldValue: null, newValue: template, comment: cleanText(form.get("comment"), 1000) });
    return NextResponse.redirect(new URL("/crm/settings#contracts", request.url));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "contract_template_error" }, { status: 400 });
  }
}
