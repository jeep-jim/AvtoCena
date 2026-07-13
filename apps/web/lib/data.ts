import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_MAX_RECORDS_PER_CHUNK = 500;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REQUIRED_BOOTSTRAP_COLLECTIONS = ["clients/clients.json", "leads/leads.json", "activity/feed.json", "deals/deals.json", "partners/partners.json", "partners/accruals.json", "cpa/networks.json", "cpa/payouts.json", "markets/markets.json", "settings/site-business.json", "settings/change-log.json", "contracts/templates.json"];

type ChunkDescriptor = { file: string; count: number; createdAt: string; updatedAt: string };
type ChunkIndex = { version: 1; collection: string; maxRecordsPerChunk: number; total: number; updatedAt: string; chunks: ChunkDescriptor[] };
export type JsonStorageDriver = "local" | "object";
export type JsonReadResult<T> = { value: T; etag?: string; found: boolean };
export type JsonWriteCondition = { ifMatch?: string; ifNoneMatch?: "*" };

export class StorageConflictError extends Error { constructor() { super("storage_conflict"); this.name = "StorageConflictError"; } }

export interface JsonStorage {
  driver: JsonStorageDriver;
  readJson<T>(relativePath: string, fallback: T): Promise<T>;
  readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>>;
  writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition): Promise<void>;
  deleteJson?(relativePath: string): Promise<void>;
  exists?(relativePath: string): Promise<boolean>;
  putBinary?(relativePath: string, data: Buffer, contentType: string, condition?: JsonWriteCondition): Promise<{ objectKey: string; mimeType: string; size: number; checksum: string }>;
  getBinary?(relativePath: string): Promise<{ data: Buffer; mimeType?: string; size: number; checksum: string }>;
  binaryExists?(relativePath: string): Promise<boolean>;
  deleteBinary?(relativePath: string): Promise<void>;
}

export function getDataRoot() {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, "data"), path.join(cwd, "..", "..", "data"), path.join(cwd, "..", "data"), path.join(process.cwd(), "apps", "web", "..", "..", "data")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.join(cwd, "data");
}
export function normalizeStorageKey(relativePath: string) { const key = relativePath.replace(/\\/g, "/").replace(/^\/+/, ""); if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid_storage_key"); return key; }
export function safeStoragePath(relativePath: string) { const root = path.resolve(getDataRoot()); const target = path.resolve(root, normalizeStorageKey(relativePath)); if (target !== root && !target.startsWith(root + path.sep)) throw new Error("invalid_storage_key"); return target; }
function localPath(relativePath: string) { return safeStoragePath(relativePath); }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeParse<T>(text: string, fallback: T): T { try { return JSON.parse(text) as T; } catch { return fallback; } }
function localEtag(filePath: string) { try { const s = fs.statSync(filePath); return `"${s.size}-${Math.floor(s.mtimeMs)}"`; } catch { return undefined; } }

export class LocalJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "local";
  async readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>> {
    const p = localPath(relativePath);
    try { if (!fs.existsSync(p)) return { value: fallback, found: false }; return { value: safeParse(await fs.promises.readFile(p, "utf-8"), fallback), etag: localEtag(p), found: true }; } catch { return { value: fallback, found: false }; }
  }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { return (await this.readJsonWithMeta(relativePath, fallback)).value; }
  async writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition) {
    const p = localPath(relativePath); const current = localEtag(p);
    if (condition?.ifNoneMatch === "*" && current) throw new StorageConflictError();
    if (condition?.ifMatch && current !== condition.ifMatch) throw new StorageConflictError();
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
    await fs.promises.rename(tmp, p);
  }
  async deleteJson(relativePath: string) { await fs.promises.rm(localPath(relativePath), { force: true }); }
  async putBinary(relativePath: string, data: Buffer, contentType: string, condition?: JsonWriteCondition) { const p = localPath(relativePath); const current = localEtag(p); if (condition?.ifNoneMatch === "*" && current) throw new StorageConflictError(); if (condition?.ifMatch && current !== condition.ifMatch) throw new StorageConflictError(); await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, data); return { objectKey: normalizeStorageKey(relativePath), mimeType: contentType, size: data.length, checksum: sha256(data) }; }
  async getBinary(relativePath: string) { const data = await fs.promises.readFile(localPath(relativePath)); return { data, size: data.length, checksum: sha256(data) }; }
  async binaryExists(relativePath: string) { try { await fs.promises.access(localPath(relativePath)); return true; } catch { return false; } }
  async deleteBinary(relativePath: string) { await fs.promises.rm(localPath(relativePath), { force: true }); }
  async exists(relativePath: string) { try { await fs.promises.access(localPath(relativePath)); return true; } catch { return false; } }
}

function objectConfig() {
  const endpoint = process.env.YC_OBJECT_STORAGE_ENDPOINT || "https://storage.yandexcloud.net";
  const region = process.env.YC_OBJECT_STORAGE_REGION || "ru-central1";
  const bucket = process.env.YC_OBJECT_STORAGE_BUCKET || "";
  const accessKeyId = process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY || "";
  const prefix = (process.env.YC_OBJECT_STORAGE_PREFIX || "").replace(/^\/+|\/+$/g, "");
  if (!bucket || !accessKeyId || !secretAccessKey) throw new Error("object_storage_not_configured");
  return { endpoint: endpoint.replace(/\/+$/g, ""), region, bucket, accessKeyId, secretAccessKey, prefix };
}
function hmac(key: crypto.BinaryLike, value: string) { return crypto.createHmac("sha256", key).update(value).digest(); }
function sha256(value: string | Buffer) { return crypto.createHash("sha256").update(value).digest("hex"); }
function encodeKey(key: string) { return key.split("/").map(encodeURIComponent).join("/"); }
function cleanEtag(value: string | null) { return value?.replace(/^W\//, "") || undefined; }

export class ObjectJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "object";
  private key(relativePath: string) { const cfg = objectConfig(); return [cfg.prefix, normalizeStorageKey(relativePath)].filter(Boolean).join("/"); }
  private async request(method: string, relativePath: string, body?: string | Buffer, extraHeaders: Record<string, string> = {}) {
    const cfg = objectConfig(); const key = this.key(relativePath); const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
    const payloadHash = sha256(body ?? ""); const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
    if (body !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json; charset=utf-8";
    const signedHeaders = Object.keys(headers).map((h) => h.toLowerCase()).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((k) => `${k.toLowerCase()}:${headers[k].trim()}\n`).join("");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), cfg.region), "s3"), "aws4_request");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { method, headers, body: body as any });
      if (res.ok || res.status === 404 || res.status === 412 || res.status === 409) return res;
      if (!TRANSIENT_STATUS.has(res.status) || attempt === 2) throw new Error(`object_storage_${method}_${res.status}`);
      await sleep(100 * 2 ** attempt);
    }
    throw new Error("object_storage_unreachable");
  }
  async readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>> { const res = await this.request("GET", relativePath); if (res.status === 404) return { value: fallback, found: false }; if (!res.ok) throw new Error(`object_storage_read_${res.status}`); return { value: await res.json() as T, etag: cleanEtag(res.headers.get("etag")), found: true }; }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { return (await this.readJsonWithMeta(relativePath, fallback)).value; }
  async writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition) { const headers: Record<string,string> = { "content-type": "application/json; charset=utf-8" }; if (condition?.ifMatch) headers["if-match"] = condition.ifMatch; if (condition?.ifNoneMatch) headers["if-none-match"] = condition.ifNoneMatch; const res = await this.request("PUT", relativePath, JSON.stringify(value, null, 2), headers); if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_write_${res.status}`); }
  async head(relativePath: string) { const res = await this.request("HEAD", relativePath); if (res.status === 404) return false; if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_head_${res.status}`); return true; }
  async deleteJson(relativePath: string) { await this.request("DELETE", relativePath); }
  async putBinary(relativePath: string, data: Buffer, contentType: string, condition?: JsonWriteCondition) { const headers: Record<string,string> = { "content-type": contentType }; if (condition?.ifMatch) headers["if-match"] = condition.ifMatch; if (condition?.ifNoneMatch) headers["if-none-match"] = condition.ifNoneMatch; const res = await this.request("PUT", relativePath, data, headers); if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_binary_write_${res.status}`); return { objectKey: normalizeStorageKey(relativePath), mimeType: contentType, size: data.length, checksum: sha256(data) }; }
  async getBinary(relativePath: string) { const res = await this.request("GET", relativePath); if (!res.ok) throw new Error(`object_storage_binary_read_${res.status}`); const data = Buffer.from(await res.arrayBuffer()); return { data, mimeType: res.headers.get("content-type") || undefined, size: data.length, checksum: sha256(data) }; }
  async binaryExists(relativePath: string) { return this.head(relativePath); }
  async deleteBinary(relativePath: string) { await this.request("DELETE", relativePath); }
  async exists(relativePath: string) { return this.head(relativePath); }
}

let singleton: JsonStorage | null = null;
export function getJsonStorage() { if (singleton) return singleton; singleton = (process.env.JSON_STORAGE_DRIVER === "object" ? new ObjectJsonStorage() : new LocalJsonStorage()); return singleton; }
export function resetJsonStorageForTests() { singleton = null; }
export function generateId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

function collectionPaths(relativePath: string) { const parsed = path.parse(relativePath); const directory = parsed.dir.replaceAll(path.sep, "/"); const baseFile = parsed.base; const indexFile = `${parsed.name}-index${parsed.ext || ".json"}`; const chunkFile = (sequence: number) => sequence <= 1 ? baseFile : `${parsed.name}-${String(sequence).padStart(4, "0")}${parsed.ext || ".json"}`; return { parsed, directory, baseFile, indexFile, chunkFile, rel: (file: string) => path.posix.join(directory, file) }; }
function immutableChunkFile(paths: ReturnType<typeof collectionPaths>, sequence: number) { return `${paths.parsed.name}-${String(sequence).padStart(4, "0")}-${crypto.randomUUID()}${paths.parsed.ext || ".json"}`; }
function validIndex(value: unknown): value is ChunkIndex { const c = value as Partial<ChunkIndex>; return !!c && typeof c === "object" && c.version === 1 && typeof c.collection === "string" && typeof c.maxRecordsPerChunk === "number" && Array.isArray(c.chunks); }
const locks = new Map<string, Promise<unknown>>();
async function withCollectionLock<T>(key: string, fn: () => Promise<T>) { const prev = locks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve; }); locks.set(key, prev.then(() => next, () => next)); await prev.catch(() => undefined); try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); } }

async function readSeedJson<T>(relativePath: string, fallback: T) { const p = localPath(relativePath); try { if (!fs.existsSync(p)) return fallback; return safeParse(await fs.promises.readFile(p, "utf-8"), fallback); } catch { return fallback; } }
async function readStorageOrSeed<T>(relativePath: string, fallback: T) { const storage = getJsonStorage(); const result = await storage.readJsonWithMeta(relativePath, fallback); if (result.found || storage.driver !== "object") return result.value; return readSeedJson(relativePath, fallback); }

async function createIndexFromBase<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const existing = await readStorageOrSeed<T[]>(relativePath, []); const now = new Date().toISOString(); const groupsNewestFirst: T[][] = []; for (let i = 0; i < existing.length; i += maxRecordsPerChunk) groupsNewestFirst.push(existing.slice(i, i + maxRecordsPerChunk)); if (!groupsNewestFirst.length) groupsNewestFirst.push([]); const groupsOldestFirst = [...groupsNewestFirst].reverse(); const chunks = groupsOldestFirst.map((group, i) => ({ file: i === 0 ? paths.chunkFile(1) : immutableChunkFile(paths, i + 1), count: group.length, createdAt: now, updatedAt: now })); for (let i = 0; i < groupsOldestFirst.length; i++) await storage.writeJson(paths.rel(chunks[i].file), groupsOldestFirst[i]); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: existing.length, updatedAt: now, chunks }; try { await storage.writeJson(paths.rel(paths.indexFile), index, { ifNoneMatch: "*" }); return index; } catch (error) { if (error instanceof StorageConflictError) { const existing = await storage.readJson<unknown>(paths.rel(paths.indexFile), null); if (validIndex(existing)) return existing; } throw error; } }
async function ensureChunkIndex<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const stored = await getJsonStorage().readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (validIndex(stored.value)) return stored.value; return createIndexFromBase<T>(relativePath, maxRecordsPerChunk); }

export async function readDataJson<T>(relativePath: string, fallback: T): Promise<T> { return readStorageOrSeed(relativePath, fallback); }
export async function writeDataJson(relativePath: string, value: unknown) { await getJsonStorage().writeJson(relativePath, value); }
export async function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) { return withCollectionLock(relativePath, async () => { const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const listMeta = await storage.readJsonWithMeta<T[]>(relativePath, []); const duplicate = item.id ? listMeta.value.find((record) => record.id === item.id) : null; if (duplicate) return duplicate; const stored = { ...item }; try { await storage.writeJson(relativePath, [stored, ...listMeta.value], listMeta.found && listMeta.etag ? { ifMatch: listMeta.etag } : { ifNoneMatch: "*" }); return stored; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function readChunkedDataJson<T>(relativePath: string, fallback: T[]): Promise<T[]> { const paths = collectionPaths(relativePath); const stored = await getJsonStorage().readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(stored.value)) return readStorageOrSeed<T[]>(relativePath, fallback); const result: T[] = []; for (const chunk of [...stored.value.chunks].reverse()) result.push(...await getJsonStorage().readJson<T[]>(paths.rel(chunk.file), [])); return result.length || stored.value.total === 0 ? result : fallback; }
export async function appendChunkedDataJson<T extends { id?: string }>(relativePath: string, item: T, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(indexMeta.value)) { await createIndexFromBase<T>(relativePath, maxRecordsPerChunk); continue; } const index = indexMeta.value; for (const chunk of index.chunks) { const activeRecords = await storage.readJson<T[]>(paths.rel(chunk.file), []); const duplicate = item.id ? activeRecords.find((record) => record.id === item.id) : null; if (duplicate) { index.total = index.chunks.reduce((total, descriptor) => total + descriptor.count, 0); return duplicate; } } const now = new Date().toISOString(); const activePosition = index.chunks.length - 1; const activeChunk = index.chunks[activePosition]; const appendToExisting = Boolean(activeChunk && activeChunk.count < index.maxRecordsPerChunk); const activeRecords = appendToExisting ? await storage.readJson<T[]>(paths.rel(activeChunk.file), []) : []; const duplicate = item.id ? activeRecords.find((record) => record.id === item.id) : null; if (duplicate) return duplicate; const nextRecords = [{ ...item }, ...activeRecords]; const sequence = appendToExisting ? activePosition + 1 : index.chunks.length + 1; const nextChunk: ChunkDescriptor = { file: immutableChunkFile(paths, sequence), count: nextRecords.length, createdAt: appendToExisting ? activeChunk.createdAt : now, updatedAt: now }; const nextChunks = appendToExisting ? [...index.chunks.slice(0, activePosition), nextChunk] : [...index.chunks, nextChunk]; const nextIndex: ChunkIndex = { ...index, chunks: nextChunks, total: nextChunks.reduce((total, chunk) => total + chunk.count, 0), updatedAt: now }; try { await storage.writeJson(paths.rel(nextChunk.file), nextRecords, { ifNoneMatch: "*" }); await storage.writeJson(paths.rel(paths.indexFile), nextIndex, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : { ifNoneMatch: "*" }); return nextRecords[0]; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function updateChunkedDataJson<T extends { id?: string }>(relativePath: string, id: string, update: (item: T) => T) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); const index = validIndex(indexMeta.value) ? indexMeta.value : await ensureChunkIndex<T>(relativePath); for (let i = index.chunks.length - 1; i >= 0; i--) { const chunk = index.chunks[i]; const records = await storage.readJson<T[]>(paths.rel(chunk.file), []); const recordIndex = records.findIndex((r) => r.id === id); if (recordIndex === -1) continue; const nextRecords = [...records]; const updated = update(nextRecords[recordIndex]); nextRecords[recordIndex] = updated; const now = new Date().toISOString(); const nextChunk: ChunkDescriptor = { file: immutableChunkFile(paths, i + 1), count: nextRecords.length, createdAt: chunk.createdAt, updatedAt: now }; const nextChunks = [...index.chunks]; nextChunks[i] = nextChunk; const nextIndex: ChunkIndex = { ...index, chunks: nextChunks, total: nextChunks.reduce((total, descriptor) => total + descriptor.count, 0), updatedAt: now }; try { await storage.writeJson(paths.rel(nextChunk.file), nextRecords, { ifNoneMatch: "*" }); await storage.writeJson(paths.rel(paths.indexFile), nextIndex, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : { ifNoneMatch: "*" }); return updated; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } return null; } throw new StorageConflictError(); }); }
export async function rebuildChunkedIndex(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const records = await readChunkedDataJson(relativePath, []); const now = new Date().toISOString(); const groupsNewestFirst = []; for (let i = 0; i < records.length; i += maxRecordsPerChunk) groupsNewestFirst.push(records.slice(i, i + maxRecordsPerChunk)); if (!groupsNewestFirst.length) groupsNewestFirst.push([]); const groupsOldestFirst = [...groupsNewestFirst].reverse(); const chunks = groupsOldestFirst.map((group, i) => ({ file: i === 0 ? paths.chunkFile(1) : immutableChunkFile(paths, i + 1), count: group.length, createdAt: now, updatedAt: now })); for (let i = 0; i < groupsOldestFirst.length; i++) await storage.writeJson(paths.rel(chunks[i].file), groupsOldestFirst[i]); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: records.length, updatedAt: now, chunks }; await storage.writeJson(paths.rel(paths.indexFile), index); return index; }
export async function mutateDataJson<T>(relativePath: string, fallback: T, updater: (current: T) => T | Promise<T>) { return withCollectionLock(relativePath, async () => { const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const meta = await storage.readJsonWithMeta<T>(relativePath, fallback); const next = await updater(meta.value); try { await storage.writeJson(relativePath, next, meta.found && meta.etag ? { ifMatch: meta.etag } : { ifNoneMatch: "*" }); return next; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function checkStorageBootstrap() { const storage = getJsonStorage(); const collections = await Promise.all(REQUIRED_BOOTSTRAP_COLLECTIONS.map(async (collection) => ({ collection, present: (await storage.readJsonWithMeta(collection, null)).found }))); return { driver: storage.driver, collections, bootstrapCompleted: storage.driver === "local" || collections.every((item) => item.present) }; }
