import crypto from "node:crypto";
import { generateId, getJsonStorage, readChunkedDataJson, updateChunkedDataJson } from "./data";
import { getAuthUsers, getCurrentUser, isAdminRole, isCrmRole } from "./auth";
import { safeObjectKey } from "./crm";

export const DOCUMENT_TYPES = ["passport","driver_license","contract","power_of_attorney","payment","other"] as const;
export const DOCUMENT_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = { passport: "Паспорт", driver_license: "Водительское удостоверение", contract: "Договор", power_of_attorney: "Доверенность", payment: "Платёжный документ", other: "Произвольный документ" };
export const ALLOWED_DOCUMENT_MIME = new Set(["application/pdf","image/png","image/jpeg","image/webp","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/msword","text/plain"]);
export const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;

export function sha256(data: Buffer | string) { return crypto.createHash("sha256").update(data).digest("hex"); }
export function stableOperationId(value?: string | null) { return value && value.trim() ? value.trim().slice(0, 160) : generateId("operation"); }
export function exactHas(obj: any, key: string) { return Object.prototype.hasOwnProperty.call(obj, key); }
export function normalizeDocumentType(value: string): (typeof DOCUMENT_TYPES)[number] { return DOCUMENT_TYPES.includes(value as any) ? value as any : "other"; }
export async function ensureCrmUser() { const user = await getCurrentUser(); if (!user || !isCrmRole(user.role)) throw Object.assign(new Error("auth_required"), { status: 401 }); return user; }
export async function ensureAdminUser() { const user = await getCurrentUser(); if (!user || !isAdminRole(user.role)) throw Object.assign(new Error("forbidden"), { status: 403 }); return user; }
export function canAccessEntity(user: any, entity: any) { return Boolean(user && (user.role === "owner" || user.role === "admin" || entity?.assignedManagerId === user.id)); }

export async function updateClientRecord(body: any) {
  const user = await ensureCrmUser();
  const id = String(body.id || "").trim();
  if (!id) throw Object.assign(new Error("client_id_required"), { status: 400 });
  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  const existing = clients.find((c) => c.id === id);
  if (!existing) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, existing)) throw Object.assign(new Error("forbidden"), { status: 403 });
  if (exactHas(body, "assignedManagerId")) {
    const managers = await getAuthUsers();
    const manager = managers.find((item) => item.id === body.assignedManagerId && isCrmRole(item.role) && item.status !== "disabled");
    if (!manager) throw Object.assign(new Error("manager_not_found"), { status: 400 });
  }
  const operationId = stableOperationId(body.operationId);
  const updatedAt = new Date().toISOString();
  const setIfPresent = (target: any, sourceKey: string, targetKey = sourceKey) => {
    if (exactHas(body, sourceKey)) target[targetKey] = typeof body[sourceKey] === "string" ? body[sourceKey].trim() : body[sourceKey];
  };
  const updated = await updateChunkedDataJson<any>("clients/clients.json", id, (client) => {
    if ((client.history || []).some((h: any) => h.operationId === operationId)) return client;
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
  const user = await ensureCrmUser();
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
  const documentId = `document_${sha256(`${clientId}:${operationId}`).slice(0, 32)}`;
  const documentType = normalizeDocumentType(String(form.get("documentType") || "other"));
  const originalName = String(file.name || "document").slice(0, 180);
  const objectKey = safeObjectKey(["crm","clients",clientId,"documents",documentId]);
  const storage = getJsonStorage();
  let binaryExisted = false;
  const existingBinary = await storage.getBinary?.(objectKey).catch(() => null);
  if (existingBinary) {
    binaryExisted = true;
    if (existingBinary.size !== data.length || sha256(existingBinary.data) !== checksum) throw Object.assign(new Error("document_operation_conflict"), { status: 409 });
  } else {
    const stored = await storage.putBinary?.(objectKey, data, mimeType, { ifNoneMatch: "*" });
    if (!stored) throw Object.assign(new Error("binary_storage_unavailable"), { status: 500 });
    const verify = await storage.getBinary?.(objectKey);
    if (!verify || verify.size !== data.length || sha256(verify.data) !== checksum) throw Object.assign(new Error("binary_verify_failed"), { status: 500 });
  }
  const uploadedAt = new Date().toISOString();
  const document = { id: documentId, operationId, objectKey, originalName, fileName: originalName, mimeType, size: file.size, checksum, documentType, uploadedAt, uploadedByUserId: user.id, description: String(form.get("description") || "").trim() };
  let updated;
  try {
    updated = await updateChunkedDataJson<any>("clients/clients.json", clientId, (c) => {
      if ((c.documents || []).some((d: any) => d.operationId === operationId)) return c;
      const history = (c.history || []).some((h: any) => h.operationId === operationId) ? (c.history || []) : [...(c.history || []), { at: uploadedAt, by: user.id, type: "document_uploaded", title: `Загружен документ: ${DOCUMENT_LABELS[documentType]}`, documentId, operationId }];
      return { ...c, documents: [...(c.documents || []), document], updatedAt: uploadedAt, history };
    });
  } catch (error) {
    const latest = (await readChunkedDataJson<any>("clients/clients.json", [])).find((c) => c.id === clientId);
    const savedElsewhere = (latest?.documents || []).some((d: any) => d.operationId === operationId);
    if (!binaryExisted && !savedElsewhere) await storage.deleteBinary?.(objectKey).catch(() => undefined);
    throw error;
  }
  const savedDocument = (updated?.documents || []).find((d: any) => d.operationId === operationId);
  return { document: savedDocument || document, client: updated, operationId, unchanged: Boolean(savedDocument && savedDocument.id !== document.id) };
}

export async function downloadClientDocument(clientId: string, documentId: string) {
  const user = await ensureCrmUser();
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
  const user = await ensureCrmUser(); const operationId = stableOperationId(operationIdInput);
  const client = (await readChunkedDataJson<any>("clients/clients.json", [])).find((c) => c.id === clientId);
  if (!client) throw Object.assign(new Error("client_not_found"), { status: 404 });
  if (!canAccessEntity(user, client)) throw Object.assign(new Error("forbidden"), { status: 403 });
  const priorDelete = (client.deletedDocuments || []).find((d: any) => d.id === documentId && d.deleteOperationId === operationId);
  if (priorDelete) return { client, document: priorDelete, operationId };
  const document = (client.documents || []).find((d: any) => d.id === documentId);
  if (!document) throw Object.assign(new Error("document_not_found"), { status: 404 });
  const now = new Date().toISOString();
  await updateChunkedDataJson<any>("clients/clients.json", clientId, (c) => ({ ...c, documents: (c.documents || []).map((d: any) => d.id === documentId ? { ...d, status: "deleting", deletingOperationId: operationId } : d), updatedAt: now }));
  await getJsonStorage().deleteBinary?.(document.objectKey);
  const updated = await updateChunkedDataJson<any>("clients/clients.json", clientId, (c) => {
    const alreadyDeleted = (c.deletedDocuments || []).some((d: any) => d.id === documentId && d.deleteOperationId === operationId);
    const deletedDocuments = alreadyDeleted ? (c.deletedDocuments || []) : [...(c.deletedDocuments || []), { ...document, status: "archived", deleteOperationId: operationId, deletedAt: now, deletedByUserId: user.id }];
    const history = (c.history || []).some((h: any) => h.operationId === operationId) ? (c.history || []) : [...(c.history || []), { at: now, by: user.id, type: "document_deleted", title: `Удалён документ: ${document.originalName}`, documentId, operationId }];
    return { ...c, documents: (c.documents || []).filter((d: any) => d.id !== documentId), deletedDocuments, updatedAt: now, history };
  });
  return { client: updated, document, operationId };
}

export function errorResponse(error: any) { return { message: error?.message || "server_error", status: Number(error?.status || 500) }; }
