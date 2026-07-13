import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_MAX_RECORDS_PER_CHUNK = 500;
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

type ChunkDescriptor = { file: string; count: number; createdAt: string; updatedAt: string };
type ChunkIndex = { version: 1; collection: string; maxRecordsPerChunk: number; total: number; updatedAt: string; chunks: ChunkDescriptor[] };
export type JsonStorageDriver = "local" | "object";

export interface JsonStorage {
  driver: JsonStorageDriver;
  readJson<T>(relativePath: string, fallback: T): Promise<T>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
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

export class LocalJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "local";
  async readJson<T>(relativePath: string, fallback: T): Promise<T> {
    try { const p = localPath(relativePath); if (!fs.existsSync(p)) return fallback; return JSON.parse(await fs.promises.readFile(p, "utf-8")) as T; } catch { return fallback; }
  }
  async writeJson(relativePath: string, value: unknown) {
    const p = localPath(relativePath); await fs.promises.mkdir(path.dirname(p), { recursive: true });
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

export class ObjectJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "object";
  private key(relativePath: string) { const cfg = objectConfig(); return [cfg.prefix, relativePath.replace(/^\/+/, "")].filter(Boolean).join("/"); }
  private async request(method: string, relativePath: string, body?: string) {
    const cfg = objectConfig(); const key = this.key(relativePath); const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
    const payloadHash = sha256(body ?? ""); const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); const date = amzDate.slice(0, 8);
    const host = url.host; const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
    if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join("");
    const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${date}/${cfg.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), cfg.region), "s3"), "aws4_request");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { method, headers, body });
      if (res.ok || res.status === 404) return res;
      if (!TRANSIENT_STATUS.has(res.status) || attempt === 2) throw new Error(`object_storage_${method}_${res.status}`);
      await sleep(100 * 2 ** attempt);
    }
    throw new Error("object_storage_unreachable");
  }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { const res = await this.request("GET", relativePath); if (res.status === 404) return fallback; return (await res.json()) as T; }
  async writeJson(relativePath: string, value: unknown) { const res = await this.request("PUT", relativePath, JSON.stringify(value, null, 2)); if (!res.ok) throw new Error(`object_storage_write_${res.status}`); }
  async deleteJson(relativePath: string) { await this.request("DELETE", relativePath); }
  async exists(relativePath: string) { const res = await this.request("GET", relativePath); return res.ok; }
}

let singleton: JsonStorage | null = null;
export function getJsonStorage() { if (singleton) return singleton; singleton = (process.env.JSON_STORAGE_DRIVER === "object" ? new ObjectJsonStorage() : new LocalJsonStorage()); return singleton; }
export function resetJsonStorageForTests() { singleton = null; }
export function generateId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

function collectionPaths(relativePath: string) { const parsed = path.parse(relativePath); const directory = parsed.dir; const baseFile = parsed.base; const indexFile = `${parsed.name}-index${parsed.ext || ".json"}`; const chunkFile = (sequence: number) => sequence <= 1 ? baseFile : `${parsed.name}-${String(sequence).padStart(4, "0")}${parsed.ext || ".json"}`; return { parsed, directory, baseFile, indexFile, chunkFile, rel: (file: string) => path.posix.join(directory.replaceAll(path.sep, "/"), file) }; }
function validIndex(value: unknown): value is ChunkIndex { const c = value as Partial<ChunkIndex>; return !!c && typeof c === "object" && c.version === 1 && typeof c.collection === "string" && typeof c.maxRecordsPerChunk === "number" && Array.isArray(c.chunks); }
async function ensureChunkIndex<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const stored = await storage.readJson<unknown>(paths.rel(paths.indexFile), null); if (validIndex(stored)) return stored; const existing = await storage.readJson<T[]>(relativePath, []); const now = new Date().toISOString(); const groups = []; for (let i = 0; i < existing.length; i += maxRecordsPerChunk) groups.push(existing.slice(i, i + maxRecordsPerChunk)); if (!groups.length) groups.push([]); const chunks = [...groups].reverse().map((g, i) => ({ file: paths.chunkFile(i + 1), count: g.length, createdAt: now, updatedAt: now })); for (const [i, g] of [...groups].reverse().entries()) await storage.writeJson(paths.rel(paths.chunkFile(i + 1)), g); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: existing.length, updatedAt: now, chunks }; await storage.writeJson(paths.rel(paths.indexFile), index); return index; }

export async function readDataJson<T>(relativePath: string, fallback: T): Promise<T> { return getJsonStorage().readJson(relativePath, fallback); }
export async function writeDataJson(relativePath: string, value: unknown) { await getJsonStorage().writeJson(relativePath, value); }
export async function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) { const list = await readDataJson<T[]>(relativePath, []); const stored = { ...item }; await writeDataJson(relativePath, [stored, ...list]); return stored; }
export async function readChunkedDataJson<T>(relativePath: string, fallback: T[]): Promise<T[]> { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const stored = await storage.readJson<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(stored)) return storage.readJson<T[]>(relativePath, fallback); const result: T[] = []; for (const chunk of [...stored.chunks].reverse()) result.push(...await storage.readJson<T[]>(paths.rel(chunk.file), [])); return result.length || stored.total === 0 ? result : fallback; }
export async function appendChunkedDataJson<T extends { id?: string }>(relativePath: string, item: T, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let retry = 0; retry < 3; retry++) { const index = await ensureChunkIndex<T>(relativePath, maxRecordsPerChunk); const now = new Date().toISOString(); let activeChunk = index.chunks[index.chunks.length - 1]; if (!activeChunk || activeChunk.count >= index.maxRecordsPerChunk) { activeChunk = { file: paths.chunkFile(index.chunks.length + 1), count: 0, createdAt: now, updatedAt: now }; index.chunks.push(activeChunk); } const chunkRel = paths.rel(activeChunk.file); const records = await storage.readJson<T[]>(chunkRel, []); if (item.id && records.some((r) => r.id === item.id)) return item; const storedItem = { ...item }; const nextRecords = [storedItem, ...records]; await storage.writeJson(chunkRel, nextRecords); activeChunk.count = nextRecords.length; activeChunk.updatedAt = now; index.total = index.chunks.reduce((t, c) => t + c.count, 0); index.updatedAt = now; await storage.writeJson(paths.rel(paths.indexFile), index); return storedItem; } throw new Error("storage_write_failed"); }
export async function updateChunkedDataJson<T extends { id?: string }>(relativePath: string, id: string, update: (item: T) => T) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const index = await ensureChunkIndex<T>(relativePath); for (let i = index.chunks.length - 1; i >= 0; i--) { const chunk = index.chunks[i]; const chunkRel = paths.rel(chunk.file); const records = await storage.readJson<T[]>(chunkRel, []); const recordIndex = records.findIndex((r) => r.id === id); if (recordIndex === -1) continue; const updated = update(records[recordIndex]); records[recordIndex] = updated; await storage.writeJson(chunkRel, records); const now = new Date().toISOString(); chunk.count = records.length; chunk.updatedAt = now; index.total = index.chunks.reduce((t, c) => t + c.count, 0); index.updatedAt = now; await storage.writeJson(paths.rel(paths.indexFile), index); return updated; } return null; }
