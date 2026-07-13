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
}

export function getDataRoot() {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, "data"), path.join(cwd, "..", "..", "data"), path.join(cwd, "..", "data"), path.join(process.cwd(), "apps", "web", "..", "..", "data")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.join(cwd, "data");
}
function localPath(relativePath: string) { return path.join(getDataRoot(), relativePath); }
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
  private key(relativePath: string) { const cfg = objectConfig(); return [cfg.prefix, relativePath.replace(/^\/+/, "")].filter(Boolean).join("/"); }
  private async request(method: string, relativePath: string, body?: string, extraHeaders: Record<string, string> = {}) {
    const cfg = objectConfig(); const key = this.key(relativePath); const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
    const payloadHash = sha256(body ?? ""); const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
    if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
    const signedHeaders = Object.keys(headers).map((h) => h.toLowerCase()).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((k) => `${k.toLowerCase()}:${headers[k].trim()}\n`).join("");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), cfg.region), "s3"), "aws4_request");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { method, headers, body });
      if (res.ok || res.status === 404 || res.status === 412 || res.status === 409) return res;
      if (!TRANSIENT_STATUS.has(res.status) || attempt === 2) throw new Error(`object_storage_${method}_${res.status}`);
      await sleep(100 * 2 ** attempt);
    }
    throw new Error("object_storage_unreachable");
  }
  async readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>> { const res = await this.request("GET", relativePath); if (res.status === 404) return { value: fallback, found: false }; if (!res.ok) throw new Error(`object_storage_read_${res.status}`); return { value: await res.json() as T, etag: cleanEtag(res.headers.get("etag")), found: true }; }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { return (await this.readJsonWithMeta(relativePath, fallback)).value; }
  async writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition) { const headers: Record<string,string> = {}; if (condition?.ifMatch) headers["if-match"] = condition.ifMatch; if (condition?.ifNoneMatch) headers["if-none-match"] = condition.ifNoneMatch; const res = await this.request("PUT", relativePath, JSON.stringify(value, null, 2), headers); if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_write_${res.status}`); }
  async deleteJson(relativePath: string) { await this.request("DELETE", relativePath); }
  async exists(relativePath: string) { return (await this.readJsonWithMeta(relativePath, null)).found; }
}

let singleton: JsonStorage | null = null;
export function getJsonStorage() { if (singleton) return singleton; singleton = (process.env.JSON_STORAGE_DRIVER === "object" ? new ObjectJsonStorage() : new LocalJsonStorage()); return singleton; }
export function resetJsonStorageForTests() { singleton = null; }
export function generateId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

function collectionPaths(relativePath: string) { const parsed = path.parse(relativePath); const directory = parsed.dir.replaceAll(path.sep, "/"); const baseFile = parsed.base; const indexFile = `${parsed.name}-index${parsed.ext || ".json"}`; const chunkFile = (sequence: number) => sequence <= 1 ? baseFile : `${parsed.name}-${String(sequence).padStart(4, "0")}${parsed.ext || ".json"}`; return { parsed, directory, baseFile, indexFile, chunkFile, rel: (file: string) => path.posix.join(directory, file) }; }
function validIndex(value: unknown): value is ChunkIndex { const c = value as Partial<ChunkIndex>; return !!c && typeof c === "object" && c.version === 1 && typeof c.collection === "string" && typeof c.maxRecordsPerChunk === "number" && Array.isArray(c.chunks); }
const locks = new Map<string, Promise<unknown>>();
async function withCollectionLock<T>(key: string, fn: () => Promise<T>) { const prev = locks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve; }); locks.set(key, prev.then(() => next, () => next)); await prev.catch(() => undefined); try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); } }

async function readSeedJson<T>(relativePath: string, fallback: T) { const p = localPath(relativePath); try { if (!fs.existsSync(p)) return fallback; return safeParse(await fs.promises.readFile(p, "utf-8"), fallback); } catch { return fallback; } }
async function readStorageOrSeed<T>(relativePath: string, fallback: T) { const storage = getJsonStorage(); const result = await storage.readJsonWithMeta(relativePath, fallback); if (result.found || storage.driver !== "object") return result.value; return readSeedJson(relativePath, fallback); }

async function createIndexFromBase<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const existing = await readStorageOrSeed<T[]>(relativePath, []); const now = new Date().toISOString(); const groupsNewestFirst: T[][] = []; for (let i = 0; i < existing.length; i += maxRecordsPerChunk) groupsNewestFirst.push(existing.slice(i, i + maxRecordsPerChunk)); if (!groupsNewestFirst.length) groupsNewestFirst.push([]); const groupsOldestFirst = [...groupsNewestFirst].reverse(); const chunks = groupsOldestFirst.map((group, i) => ({ file: paths.chunkFile(i + 1), count: group.length, createdAt: now, updatedAt: now })); for (let i = 0; i < groupsOldestFirst.length; i++) await storage.writeJson(paths.rel(paths.chunkFile(i + 1)), groupsOldestFirst[i]); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: existing.length, updatedAt: now, chunks }; await storage.writeJson(paths.rel(paths.indexFile), index); return index; }
async function ensureChunkIndex<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const stored = await getJsonStorage().readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (validIndex(stored.value)) return stored.value; return createIndexFromBase<T>(relativePath, maxRecordsPerChunk); }

export async function readDataJson<T>(relativePath: string, fallback: T): Promise<T> { return readStorageOrSeed(relativePath, fallback); }
export async function writeDataJson(relativePath: string, value: unknown) { await getJsonStorage().writeJson(relativePath, value); }
export async function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) { return withCollectionLock(relativePath, async () => { const listMeta = await getJsonStorage().readJsonWithMeta<T[]>(relativePath, []); if (item.id && listMeta.value.some((record) => record.id === item.id)) return listMeta.value.find((record) => record.id === item.id) as T; const stored = { ...item }; await getJsonStorage().writeJson(relativePath, [stored, ...listMeta.value], listMeta.found ? { ifMatch: listMeta.etag } : undefined); return stored; }); }
export async function readChunkedDataJson<T>(relativePath: string, fallback: T[]): Promise<T[]> { const paths = collectionPaths(relativePath); const stored = await getJsonStorage().readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(stored.value)) return readStorageOrSeed<T[]>(relativePath, fallback); const result: T[] = []; for (const chunk of [...stored.value.chunks].reverse()) result.push(...await getJsonStorage().readJson<T[]>(paths.rel(chunk.file), [])); return result.length || stored.value.total === 0 ? result : fallback; }
export async function appendChunkedDataJson<T extends { id?: string }>(relativePath: string, item: T, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); const index = validIndex(indexMeta.value) ? indexMeta.value : await createIndexFromBase<T>(relativePath, maxRecordsPerChunk); for (const chunk of index.chunks) { const existing = await storage.readJson<T[]>(paths.rel(chunk.file), []); const duplicate = item.id ? existing.find((record) => record.id === item.id) : null; if (duplicate) return duplicate; } const now = new Date().toISOString(); let activeChunk = index.chunks[index.chunks.length - 1]; if (!activeChunk || activeChunk.count >= index.maxRecordsPerChunk) { activeChunk = { file: paths.chunkFile(index.chunks.length + 1), count: 0, createdAt: now, updatedAt: now }; index.chunks.push(activeChunk); } const chunkRel = paths.rel(activeChunk.file); const chunkMeta = await storage.readJsonWithMeta<T[]>(chunkRel, []); const duplicate = item.id ? chunkMeta.value.find((record) => record.id === item.id) : null; if (duplicate) return duplicate; const nextRecords = [{ ...item }, ...chunkMeta.value]; try { await storage.writeJson(chunkRel, nextRecords, chunkMeta.found ? { ifMatch: chunkMeta.etag } : { ifNoneMatch: "*" }); activeChunk.count = nextRecords.length; activeChunk.updatedAt = now; index.total = index.chunks.reduce((total, chunk) => total + chunk.count, 0); index.updatedAt = now; await storage.writeJson(paths.rel(paths.indexFile), index, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : undefined); return nextRecords[0]; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function updateChunkedDataJson<T extends { id?: string }>(relativePath: string, id: string, update: (item: T) => T) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); const index = validIndex(indexMeta.value) ? indexMeta.value : await ensureChunkIndex<T>(relativePath); for (let i = index.chunks.length - 1; i >= 0; i--) { const chunk = index.chunks[i]; const chunkRel = paths.rel(chunk.file); const chunkMeta = await storage.readJsonWithMeta<T[]>(chunkRel, []); const recordIndex = chunkMeta.value.findIndex((r) => r.id === id); if (recordIndex === -1) continue; const records = [...chunkMeta.value]; const updated = update(records[recordIndex]); records[recordIndex] = updated; try { await storage.writeJson(chunkRel, records, chunkMeta.found && chunkMeta.etag ? { ifMatch: chunkMeta.etag } : undefined); const now = new Date().toISOString(); chunk.count = records.length; chunk.updatedAt = now; index.total = index.chunks.reduce((t, c) => t + c.count, 0); index.updatedAt = now; await storage.writeJson(paths.rel(paths.indexFile), index, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : undefined); return updated; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } return null; } throw new StorageConflictError(); }); }
export async function rebuildChunkedIndex(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const records = await readChunkedDataJson(relativePath, []); const now = new Date().toISOString(); const groupsNewestFirst = []; for (let i = 0; i < records.length; i += maxRecordsPerChunk) groupsNewestFirst.push(records.slice(i, i + maxRecordsPerChunk)); if (!groupsNewestFirst.length) groupsNewestFirst.push([]); const groupsOldestFirst = [...groupsNewestFirst].reverse(); const chunks = groupsOldestFirst.map((group, i) => ({ file: paths.chunkFile(i + 1), count: group.length, createdAt: now, updatedAt: now })); for (let i = 0; i < groupsOldestFirst.length; i++) await storage.writeJson(paths.rel(paths.chunkFile(i + 1)), groupsOldestFirst[i]); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: records.length, updatedAt: now, chunks }; await storage.writeJson(paths.rel(paths.indexFile), index); return index; }
export async function checkStorageBootstrap() { const storage = getJsonStorage(); const collections = await Promise.all(REQUIRED_BOOTSTRAP_COLLECTIONS.map(async (collection) => ({ collection, present: (await storage.readJsonWithMeta(collection, null)).found }))); return { driver: storage.driver, collections, bootstrapCompleted: storage.driver === "local" || collections.every((item) => item.present) }; }
