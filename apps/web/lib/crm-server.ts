import crypto from "node:crypto";
import { appendChunkedDataJson, generateId, getJsonStorage, mutateDataJson, readChunkedDataJson, readDataJson, updateChunkedDataJson } from "./data";
import { getCurrentUser, isAdminRole, isCrmRole } from "./auth";
import { canAccessDocument, safeObjectKey } from "./crm";

export const DOCUMENT_TYPES = ["passport","driver_license","contract","power_of_attorney","payment","other"] as const;
export const DOCUMENT_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = { passport: "Паспорт", driver_license: "Водительское удостоверение", contract: "Договор", power_of_attorney: "Доверенность", payment: "Платёжный документ", other: "Произвольный документ" };
export const ALLOWED_DOCUMENT_MIME = new Set(["application/pdf","image/png","image/jpeg","image/webp","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword","text/plain"]);
export const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;

export function sha256(data: Buffer | string) { return crypto.createHash("sha256").update(data).digest("hex"); }
export function stableOperationId(value?: string | null) { return value && value.trim() ? value.trim().slice(0, 160) : generateId("operation"); }
export function exactHas(obj: any, key: string) { return Object.prototype.hasOwnProperty.call(obj, key); }
export function normalizeDocumentType(value: string): (typeof DOCUMENT_TYPES)[number] { return DOCUMENT_TYPES.includes(value as any) ? value as any : "other"; }
export function ensureCrmUser() { const user = getCurrentUser(); if (!user || !isCrmRole(user.role)) throw Object.assign(new Error("auth_required"), { status: 401 }); return user; }
export function ensureAdminUser() { const user = getCurrentUser(); if (!user || !isAdminRole(user.role)) throw Object.assign(new Error("forbidden"), { status: 403 }); return user; }
export function canAccessEntity(user: any, entity: any) { return Boolean(user && (user.role === "owner" || user.role === "admin" || entity?.assignedManagerId === user.id)); }

export async function updateClientRecord(body: any) {
  const user = ensureCrmUser();
  const id = String(body.id || "").trim();
  if (!id) throw Object.assign(new Error("client_id_required"), { status: 400 });
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  const existing = clients.find((c) => c.id === id);
  if (!existing) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, existing)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const operationId = stableOperationId(body.operationId);
  if ((existing.history || []).some((h: any) => h.operationId === operationId)) return { client: existing, operationId, unchanged: true };
  const updatedAt = new Date().toISOString();
  const setIfPresent = (target: any, sourceKey: string, targetKey = sourceKey) => {
    if (exactHas(body, sourceKey)) target[targetKey] = typeof body[sourceKey] === "string" ? body[sourceKey].trim() : body[sourceKey];
  };
  const updated = await updateChunkedDataJson<any>("clients/clients.json", id, (client) => {
    const next = { ...client };
    for (const key of ["fio","phone","telegram","city","birthDate","passport","address","market","source"]) setIfPresent(next, key);
    setIfPresent(next, "interestedCar"); setIfPresent(next, "comments"); setIfPresent(next, "assignedManagerId");
    if (exactHas(body, "budgetRub")) next.budgetRub = body.budgetRub === "" || body.budgetRub == null ? null : Number(String(body.budgetRub).replace(/[^0-9]/g, ""));
    if (exactHas(body, "phone")) next.phones = next.phone ? [next.phone] : [];
    if (body.archive) next.status = "archived";
    if (body.restore) next.status = "active";
    if (exactHas(body, "status")) next.status = body.status;
    next.updatedAt = updatedAt;
    const changes = Object.keys(body).filter((key) => !["id","operationId"].includes(key));
    next.history = [...(client.history || []), { at: updatedAt, by: user.id, type: body.archive ? "client_archived" : body.restore ? "client_restored" : "client_updated", title: body.archive ? "Клиент архивирован" : body.restore ? "Клиент восстановлен" : "Данные клиента изменены", operationId, changes }];
    return next;
  });
  return { client: updated, operationId, unchanged: false };
}

export async function uploadClientDocument(clientId: string, form: FormData) {
  const user = ensureCrmUser();
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  const client = clients.find((c) => c.id === clientId);
  if (!client) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, client)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const file = form.get("file");
  if (!(file instanceof File)) throw Object.assign(new Error("file_required"), { status: 400 });
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_DOCUMENT_MIME.has(mimeType)) throw Object.assign(new Error("mime_not_allowed"), { status: 400 });
  if (file.size > MAX_DOCUMENT_SIZE) throw Object.assign(new Error("file_too_large"), { status: 400 });
  const operationId = stableOperationId(String(form.get("operationId") || ""));
  if ((client.documents || []).some((d: any) => d.operationId === operationId)) return { document: (client.documents || []).find((d: any) => d.operationId === operationId), operationId, unchanged: true };
  const data = Buffer.from(await file.arrayBuffer());
  const checksum = sha256(data);
  const documentId = generateId("document");
  const documentType = normalizeDocumentType(String(form.get("documentType") || "other"));
  const originalName = String(file.name || "document").slice(0, 180);
  const objectKey = safeObjectKey(["crm","clients",clientId,"documents",documentId,originalName]);
  const stored = await getJsonStorage().putBinary?.(objectKey, data, mimeType, { ifNoneMatch: "*" });
  if (!stored) throw Object.assign(new Error("binary_storage_unavailable"), { status: 500 });
  const uploadedAt = new Date().toISOString();
  const document = { id: documentId, operationId, objectKey, originalName, fileName: originalName, mimeType, size: file.size, checksum, documentType, uploadedAt, uploadedByUserId: user.id, description: String(form.get("description") || "").trim() };
  const updated = await updateChunkedDataJson<any>("clients/clients.json", clientId, (c) => ({ ...c, documents: [...(c.documents || []), document], updatedAt: uploadedAt, history: [...(c.history || []), { at: uploadedAt, by: user.id, type: "document_uploaded", title: `Загружен документ: ${DOCUMENT_LABELS[documentType]}`, documentId, operationId }] }));
  return { document, client: updated, operationId, unchanged: false };
}

export async function downloadClientDocument(clientId: string, documentId: string) {
  const user = ensureCrmUser();
  const client = (await readChunkedDataJson<any>("clients/clients.json", [])).find((c) => c.id === clientId);
  if (!client) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, client)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const document = (client.documents || []).find((d: any) => d.id === documentId);
  if (!document) throw Object.assign(new Error("document_not_found"), { status: 404 });
  const binary = await getJsonStorage().getBinary?.(document.objectKey).catch(() => null);
  if (!binary) throw Object.assign(new Error("document_binary_not_found"), { status: 404 });
  if (sha256(binary.data) !== document.checksum) throw Object.assign(new Error("checksum_mismatch"), { status: 409 });
  return { client, document, binary };
}

export async function deleteClientDocument(clientId: string, documentId: string, operationIdInput?: string) {
  const user = ensureCrmUser(); const operationId = stableOperationId(operationIdInput);
  const client = (await readChunkedDataJson<any>("clients/clients.json", [])).find((c) => c.id === clientId);
  if (!client) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, client)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const document = (client.documents || []).find((d: any) => d.id === documentId);
  if (!document) throw Object.assign(new Error("document_not_found"), { status: 404 });
  await getJsonStorage().deleteBinary?.(document.objectKey);
  const now = new Date().toISOString();
  const updated = await updateChunkedDataJson<any>("clients/clients.json", clientId, (c) => ({ ...c, documents: (c.documents || []).filter((d: any) => d.id !== documentId), deletedDocuments: [...(c.deletedDocuments || []), { ...document, deletedAt: now, deletedByUserId: user.id }], updatedAt: now, history: [...(c.history || []), { at: now, by: user.id, type: "document_deleted", title: `Удалён документ: ${document.originalName}`, documentId, operationId }] }));
  return { client: updated, document, operationId };
}

function crc32(buf: Buffer) { let table = (crc32 as any).table as number[]; if (!table) { table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); (crc32 as any).table = table; } let crc = -1; for (const b of buf) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff]; return (crc ^ -1) >>> 0; }
function minimalDocxXml(text: string) { const esc = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${esc.split("\n").map((line)=>`<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`; }
function makeZip(files: Record<string, Buffer>) { const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0; for (const [name, data] of Object.entries(files)) { const n = Buffer.from(name); const crc = crc32(data); const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50,0); l.writeUInt16LE(20,4); l.writeUInt16LE(0,6); l.writeUInt16LE(0,8); l.writeUInt32LE(0,10); l.writeUInt32LE(crc,14); l.writeUInt32LE(data.length,18); l.writeUInt32LE(data.length,22); l.writeUInt16LE(n.length,26); local.push(l,n,data); const c=Buffer.alloc(46); c.writeUInt32LE(0x02014b50,0); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt32LE(0,8); c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(n.length,28); c.writeUInt32LE(offset,42); central.push(c,n); offset += l.length+n.length+data.length; } const cdSize=central.reduce((s,b)=>s+b.length,0); const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(Object.keys(files).length,8); end.writeUInt16LE(Object.keys(files).length,10); end.writeUInt32LE(cdSize,12); end.writeUInt32LE(offset,16); return Buffer.concat([...local,...central,end]); }
export function buildContractDocx(text: string) { return makeZip({ "[Content_Types].xml": Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`), "_rels/.rels": Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`), "word/document.xml": Buffer.from(minimalDocxXml(text)) }); }

export async function generateContract(body: any) {
  const user = ensureCrmUser(); const operationId = stableOperationId(body.operationId);
  const settings = await readDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [], directorSignature: null });
  if ((settings.generatedDocuments || []).some((d: any) => d.operationId === operationId)) return { document: settings.generatedDocuments.find((d: any) => d.operationId === operationId), operationId, unchanged: true };
  const template = (settings.templates || []).find((t: any) => t.id === body.templateId) || (settings.templates || [])[0];
  if (!template) throw Object.assign(new Error("template_not_found"), { status: 404 });
  const clients = await readChunkedDataJson<any>("clients/clients.json", []); const client = clients.find((c) => c.id === body.clientId);
  if (!client) throw Object.assign(new Error("client_not_found"), { status: 404 }); if (!canAccessEntity(user, client)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const deals = await readChunkedDataJson<any>("deals/deals.json", []); const deal = deals.find((d) => d.id === body.dealId) || {};
  const managers = await readDataJson<any[]>("auth/users.json", []); const manager = managers.find((m) => m.id === (deal.assignedManagerId || client.assignedManagerId));
  const date = String(body.contractDate || new Date().toISOString().slice(0,10)); const number = String(body.contractNumber || generateId("contract_number"));
  const text = `Договор № ${number} от ${date}\nКлиент: ${client.fio || ""}\nТелефон: ${client.phone || ""}\nTelegram: ${client.telegram || ""}\nПаспорт: ${client.passport || ""}\nАдрес: ${client.address || ""}\nСделка: ${deal.number || deal.id || ""}\nАвтомобиль: ${deal.car || deal.vehicle || client.interestedCar || ""}\nVIN: ${deal.vin || ""}\nСумма: ${deal.totalRub || deal.amountRub || client.budgetRub || ""}\nМенеджер: ${manager?.displayName || ""}\nРеквизиты компании: TopAvto\nPNG-подпись директора: ${body.includeSignature ? "вставляется как графическое изображение, не электронная подпись" : "не используется"}`;
  const docx = buildContractDocx(text); const checksum = sha256(docx); const now = new Date().toISOString();
  const previous = (settings.generatedDocuments || []).filter((d:any)=>d.clientId===client.id && d.templateId===template.id).length;
  const id = generateId("generated_contract"); const objectKey = safeObjectKey(["crm","contracts",client.id,id,`${number}.docx`]);
  await getJsonStorage().putBinary?.(objectKey, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", { ifNoneMatch: "*" });
  const document = { id, objectKey, clientId: client.id, dealId: deal.id || null, templateId: template.id, version: previous + 1, checksum, createdAt: now, createdByUserId: user.id, usedSignature: Boolean(body.includeSignature), operationId, contractNumber: number, contractDate: date, html: text.replace(/\n/g,"<br/>") };
  await mutateDataJson<any>("contracts/templates.json", { templates: [], generatedDocuments: [], directorSignature: null }, (current) => ({ ...current, generatedDocuments: [document, ...(current.generatedDocuments || [])] }));
  await updateChunkedDataJson<any>("clients/clients.json", client.id, (c)=>({ ...c, contracts: [document, ...(c.contracts || [])], history: [...(c.history || []), { at: now, by: user.id, type: "contract_generated", title: `Сформирован договор № ${number}`, operationId, contractId: id }] }));
  return { document, operationId, unchanged: false };
}

export function errorResponse(error: any) { return { message: error?.message || "server_error", status: Number(error?.status || 500) }; }
