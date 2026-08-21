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
export type StorageObject = { key: string; lastModified?: string; size?: number };
export type StorageObjectVersion = StorageObject & { versionId: string; isLatest: boolean; deleteMarker: boolean };
export type StorageMultipartUpload = { key: string; uploadId: string; initiated?: string; parts: number; bytes: number };

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
  createBinaryDownloadUrl?(relativePath: string, expiresSeconds?: number): Promise<string | null>;
  binaryExists?(relativePath: string): Promise<boolean>;
  deleteBinary?(relativePath: string): Promise<void>;
  listObjects?(prefix: string): Promise<StorageObject[]>;
  listBucketObjects?(prefix?: string): Promise<StorageObject[]>;
  listObjectVersions?(): Promise<StorageObjectVersion[]>;
  listMultipartUploads?(): Promise<StorageMultipartUpload[]>;
  deleteObjects?(relativePaths: string[]): Promise<number>;
  deletePrefix?(prefix: string): Promise<number>;
}

export function getDataRoot() {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, "data"), path.join(cwd, "..", "..", "data"), path.join(cwd, "..", "data"), path.join(process.cwd(), "apps", "web", "..", "..", "data")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.join(cwd, "data");
}
export function normalizeStorageKey(relativePath: string) { const key = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); if (!key || key.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid_storage_key"); return key; }
export function safeStoragePath(relativePath: string) { const root = path.resolve(getDataRoot()); const target = path.resolve(root, normalizeStorageKey(relativePath)); if (target !== root && !target.startsWith(root + path.sep)) throw new Error("invalid_storage_key"); return target; }
function localPath(relativePath: string) { return safeStoragePath(relativePath); }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeParse<T>(text: string, fallback: T): T { try { return JSON.parse(text) as T; } catch { return fallback; } }
function localEtag(filePath: string) { try { const s = fs.statSync(filePath); return `"${s.size}-${Math.floor(s.mtimeMs)}"`; } catch { return undefined; } }

async function walkLocalFiles(root: string): Promise<string[]> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return []; }
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walkLocalFiles(target) : entry.isFile() ? [target] : [];
  }));
  return nested.flat();
}

export class LocalJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "local";
  async readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>> { const p = localPath(relativePath); try { if (!fs.existsSync(p)) return { value: fallback, found: false }; return { value: safeParse(await fs.promises.readFile(p, "utf-8"), fallback), etag: localEtag(p), found: true }; } catch { return { value: fallback, found: false }; } }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { return (await this.readJsonWithMeta(relativePath, fallback)).value; }
  async writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition) { const p = localPath(relativePath); const current = localEtag(p); if (condition?.ifNoneMatch === "*" && current) throw new StorageConflictError(); if (condition?.ifMatch && current !== condition.ifMatch) throw new StorageConflictError(); await fs.promises.mkdir(path.dirname(p), { recursive: true }); const tmp = `${p}.${process.pid}.${crypto.randomUUID()}.tmp`; await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8"); await fs.promises.rename(tmp, p); }
  async deleteJson(relativePath: string) { await fs.promises.rm(localPath(relativePath), { force: true }); }
  async putBinary(relativePath: string, data: Buffer, contentType: string, condition?: JsonWriteCondition) { const p = localPath(relativePath); const current = localEtag(p); if (condition?.ifNoneMatch === "*" && current) throw new StorageConflictError(); if (condition?.ifMatch && current !== condition.ifMatch) throw new StorageConflictError(); await fs.promises.mkdir(path.dirname(p), { recursive: true }); await fs.promises.writeFile(p, data); return { objectKey: normalizeStorageKey(relativePath), mimeType: contentType, size: data.length, checksum: sha256(data) }; }
  async getBinary(relativePath: string) { const data = await fs.promises.readFile(localPath(relativePath)); return { data, size: data.length, checksum: sha256(data) }; }
  async createBinaryDownloadUrl(_relativePath: string, _expiresSeconds = 900) { return null; }
  async binaryExists(relativePath: string) { try { await fs.promises.access(localPath(relativePath)); return true; } catch { return false; } }
  async deleteBinary(relativePath: string) { await fs.promises.rm(localPath(relativePath), { force: true }); }
  async exists(relativePath: string) { try { await fs.promises.access(localPath(relativePath)); return true; } catch { return false; } }
  async listObjects(prefix: string) { const requested = String(prefix || "").trim(); const normalized = requested ? normalizeStorageKey(requested) : ""; const root = normalized ? localPath(normalized) : path.resolve(getDataRoot()); const dataRoot = path.resolve(getDataRoot()); const files = await walkLocalFiles(root); return Promise.all(files.map(async (file) => { const stat = await fs.promises.stat(file); return { key: path.relative(dataRoot, file).replace(/\\/g, "/"), lastModified: stat.mtime.toISOString(), size: stat.size }; })); }
  async listBucketObjects(prefix = "") { return this.listObjects(prefix); }
  async listObjectVersions() { return (await this.listObjects("")).map((object) => ({ ...object, versionId: "", isLatest: true, deleteMarker: false })); }
  async listMultipartUploads() { return []; }
  async deleteObjects(relativePaths: string[]) { const keys = [...new Set(relativePaths.map(normalizeStorageKey))]; await Promise.all(keys.map((key) => fs.promises.rm(localPath(key), { force: true }))); return keys.length; }
  async deletePrefix(prefix: string) { const objects = await this.listObjects(prefix); await Promise.all(objects.map((object) => fs.promises.rm(localPath(object.key), { force: true }))); return objects.length; }
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
function awsEncode(value: string) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function canonicalQuery(params: Record<string, string>) { return Object.entries(params).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`).join("&"); }
function cleanEtag(value: string | null) { return value?.replace(/^W\//, "") || undefined; }
function decodeXml(value: string) { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
function encodeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }

export function objectStorageRequestTimeoutMs(bodyBytes: number) {
  const configured = Math.max(5_000, Number(process.env.YC_OBJECT_STORAGE_REQUEST_TIMEOUT_MS || 30_000));
  if (!Number.isFinite(bodyBytes) || bodyBytes <= 0) return configured;
  const uploadAllowance = Math.min(300_000, 30_000 + Math.ceil(bodyBytes / (1024 * 1024)) * 10_000);
  return Math.max(configured, uploadAllowance);
}

export class ObjectJsonStorage implements JsonStorage {
  driver: JsonStorageDriver = "object";
  private key(relativePath: string) { const cfg = objectConfig(); return [cfg.prefix, normalizeStorageKey(relativePath)].filter(Boolean).join("/"); }
  private async signedRequest(method: string, url: URL, body?: string | Buffer, extraHeaders: Record<string, string> = {}, query = "") {
    const cfg = objectConfig();
    const payloadHash = sha256(body ?? "");
    const attempts = Math.max(3, Number(process.env.YC_OBJECT_STORAGE_MAX_ATTEMPTS || 6));
    const timeoutMs = objectStorageRequestTimeoutMs(Buffer.byteLength(body ?? ""));
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
      const date = amzDate.slice(0, 8);
      const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
      if (body !== undefined && !Object.keys(headers).some((header) => header.toLowerCase() === "content-type")) headers["content-type"] = "application/json; charset=utf-8";
      const signedHeaders = Object.keys(headers).map((header) => header.toLowerCase()).sort().join(";");
      const canonicalHeaders = Object.keys(headers).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((header) => `${header.toLowerCase()}:${headers[header].trim()}\n`).join("");
      const canonicalRequest = [method, url.pathname, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
      const scope = `${date}/${cfg.region}/s3/aws4_request`;
      const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
      const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), cfg.region), "s3"), "aws4_request");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try { response = await fetch(url, { method, headers, body: body as any, signal: controller.signal }); }
      catch (error) { lastError = error; if (attempt + 1 >= attempts) break; await sleep(Math.min(5_000, 250 * 2 ** attempt)); continue; }
      finally { clearTimeout(timeout); }
      if (response.ok || response.status === 404 || response.status === 412 || response.status === 409) return response;
      if (!TRANSIENT_STATUS.has(response.status)) {
      const responseText = await response.text().catch(() => "");
      const code = responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] || "unknown";
      const message = responseText.match(/<Message>([^<]+)<\/Message>/)?.[1] || "";
      throw new Error(`object_storage_${method}_${response.status}:${code}:${message}`.replace(/[\r\n]+/g, " ").slice(0, 500));
    }
      lastError = new Error(`object_storage_${method}_${response.status}`);
      if (response.body) await response.body.cancel().catch(() => undefined);
      if (attempt + 1 < attempts) await sleep(Math.min(5_000, 250 * 2 ** attempt));
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
    throw new Error(`object_storage_${method}_unreachable:${detail}`);
  }
  private async request(method: string, relativePath: string, body?: string | Buffer, extraHeaders: Record<string, string> = {}) {
  const cfg = objectConfig();
  const normalizedPath = normalizeStorageKey(relativePath);
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(this.key(normalizedPath))}`);
  try {
    return await this.signedRequest(method, url, body, extraHeaders);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}:path=${normalizedPath.slice(0, 240)}:bytes=${Buffer.byteLength(body ?? "")}`);
  }
}
  private async signedBucketRequest(method: string, params: Record<string, string>, body?: string | Buffer, extraHeaders: Record<string, string> = {}) { const cfg = objectConfig(); const query = canonicalQuery(params); const url = new URL(`${cfg.endpoint}/${cfg.bucket}`); url.search = query; return this.signedRequest(method, url, body, extraHeaders, query); }
  private async bucketRequest(params: Record<string, string>) { return this.signedBucketRequest("GET", params); }
  async readJsonWithMeta<T>(relativePath: string, fallback: T): Promise<JsonReadResult<T>> { const res = await this.request("GET", relativePath); if (res.status === 404) return { value: fallback, found: false }; if (!res.ok) throw new Error(`object_storage_read_${res.status}`); return { value: await res.json() as T, etag: cleanEtag(res.headers.get("etag")), found: true }; }
  async readJson<T>(relativePath: string, fallback: T): Promise<T> { return (await this.readJsonWithMeta(relativePath, fallback)).value; }
  async writeJson(relativePath: string, value: unknown, condition?: JsonWriteCondition) { const headers: Record<string,string> = { "content-type": "application/json; charset=utf-8" }; if (condition?.ifMatch) headers["if-match"] = condition.ifMatch; if (condition?.ifNoneMatch) headers["if-none-match"] = condition.ifNoneMatch; const res = await this.request("PUT", relativePath, JSON.stringify(value, null, 2), headers); if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_write_${res.status}`); }
  async head(relativePath: string) { const res = await this.request("HEAD", relativePath); if (res.status === 404) return false; if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_head_${res.status}`); return true; }
  async deleteJson(relativePath: string) { await this.request("DELETE", relativePath); }
  async putBinary(relativePath: string, data: Buffer, contentType: string, condition?: JsonWriteCondition) { const headers: Record<string,string> = { "content-type": contentType }; if (condition?.ifMatch) headers["if-match"] = condition.ifMatch; if (condition?.ifNoneMatch) headers["if-none-match"] = condition.ifNoneMatch; const res = await this.request("PUT", relativePath, data, headers); if (res.status === 409 || res.status === 412) throw new StorageConflictError(); if (!res.ok) throw new Error(`object_storage_binary_write_${res.status}`); return { objectKey: normalizeStorageKey(relativePath), mimeType: contentType, size: data.length, checksum: sha256(data) }; }
  async getBinary(relativePath: string) { const res = await this.request("GET", relativePath); if (!res.ok) throw new Error(`object_storage_binary_read_${res.status}`); const data = Buffer.from(await res.arrayBuffer()); return { data, mimeType: res.headers.get("content-type") || undefined, size: data.length, checksum: sha256(data) }; }
  async createBinaryDownloadUrl(relativePath: string, expiresSeconds = 900) {
    const cfg = objectConfig();
    const normalizedPath = normalizeStorageKey(relativePath);
    const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(this.key(normalizedPath))}`);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${cfg.region}/s3/aws4_request`;
    const expires = Math.max(60, Math.min(604_800, Math.floor(Number(expiresSeconds) || 900)));
    const params: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(expires),
      "X-Amz-SignedHeaders": "host",
    };
    const query = canonicalQuery(params);
    const canonicalRequest = ["GET", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, date), cfg.region), "s3"), "aws4_request");
    params["X-Amz-Signature"] = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    url.search = canonicalQuery(params);
    return url.toString();
  }
  async binaryExists(relativePath: string) { return this.head(relativePath); }
  async deleteBinary(relativePath: string) { await this.request("DELETE", relativePath); }
  async exists(relativePath: string) { return this.head(relativePath); }
  private async listRawObjects(normalizedPrefix: string, stripConfiguredPrefix: boolean) {
    const cfg = objectConfig();
    const objects: StorageObject[] = [];
    let continuationToken = "";
    do {
      const params: Record<string, string> = { "list-type": "2", prefix: normalizedPrefix, "max-keys": "1000" };
      if (continuationToken) params["continuation-token"] = continuationToken;
      const response = await this.bucketRequest(params);
      if (!response.ok) throw new Error(`object_storage_list_${response.status}`);
      const xml = await response.text();
      for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || []) {
        const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "";
        const key = decodeXml(rawKey);
        const relative = stripConfiguredPrefix && cfg.prefix && key.startsWith(`${cfg.prefix}/`) ? key.slice(cfg.prefix.length + 1) : key;
        const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
        const size = Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || 0);
        if (relative) objects.push({ key: relative, lastModified, size });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      continuationToken = truncated ? decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || "") : "";
    } while (continuationToken);
    return objects;
  }
  async listObjects(prefix: string) {
    const cfg = objectConfig();
    const requested = String(prefix || "").trim();
    return this.listRawObjects([cfg.prefix, requested ? normalizeStorageKey(requested) : ""].filter(Boolean).join("/"), true);
  }
  async listBucketObjects(prefix = "") {
    const requested = String(prefix || "").trim();
    return this.listRawObjects(requested ? normalizeStorageKey(requested) : "", false);
  }
  async listObjectVersions() {
    const versions: StorageObjectVersion[] = [];
    let keyMarker = "";
    let versionIdMarker = "";
    do {
      const params: Record<string, string> = { versions: "", "max-keys": "1000" };
      if (keyMarker) params["key-marker"] = keyMarker;
      if (versionIdMarker) params["version-id-marker"] = versionIdMarker;
      const response = await this.bucketRequest(params);
      if (!response.ok) throw new Error(`object_storage_list_versions_${response.status}`);
      const xml = await response.text();
      for (const block of xml.match(/<(Version|DeleteMarker)>[\s\S]*?<\/\1>/g) || []) {
        const deleteMarker = block.startsWith("<DeleteMarker>");
        const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "");
        const versionId = decodeXml(block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1] || "");
        const lastModified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
        const size = deleteMarker ? 0 : Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || 0);
        if (key && versionId) versions.push({ key, versionId, lastModified, size, deleteMarker, isLatest: /<IsLatest>true<\/IsLatest>/.test(block) });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      keyMarker = truncated ? decodeXml(xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1] || "") : "";
      versionIdMarker = truncated ? decodeXml(xml.match(/<NextVersionIdMarker>([\s\S]*?)<\/NextVersionIdMarker>/)?.[1] || "") : "";
    } while (keyMarker || versionIdMarker);
    return versions;
  }
  private async listMultipartParts(key: string, uploadId: string) {
    const cfg = objectConfig();
    let partMarker = "";
    let parts = 0;
    let bytes = 0;
    do {
      const params: Record<string, string> = { uploadId, "max-parts": "1000" };
      if (partMarker) params["part-number-marker"] = partMarker;
      const query = canonicalQuery(params);
      const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
      url.search = query;
      const response = await this.signedRequest("GET", url, undefined, {}, query);
      if (!response.ok) throw new Error(`object_storage_list_parts_${response.status}`);
      const xml = await response.text();
      for (const block of xml.match(/<Part>[\s\S]*?<\/Part>/g) || []) {
        parts += 1;
        bytes += Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || 0);
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      partMarker = truncated ? String(xml.match(/<NextPartNumberMarker>([\s\S]*?)<\/NextPartNumberMarker>/)?.[1] || "") : "";
    } while (partMarker);
    return { parts, bytes };
  }
  async listMultipartUploads() {
    const uploads: Array<{ key: string; uploadId: string; initiated?: string }> = [];
    let keyMarker = "";
    let uploadIdMarker = "";
    do {
      const params: Record<string, string> = { uploads: "", "max-uploads": "1000" };
      if (keyMarker) params["key-marker"] = keyMarker;
      if (uploadIdMarker) params["upload-id-marker"] = uploadIdMarker;
      const response = await this.bucketRequest(params);
      if (!response.ok) throw new Error(`object_storage_list_uploads_${response.status}`);
      const xml = await response.text();
      for (const block of xml.match(/<Upload>[\s\S]*?<\/Upload>/g) || []) {
        const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || "");
        const uploadId = decodeXml(block.match(/<UploadId>([\s\S]*?)<\/UploadId>/)?.[1] || "");
        const initiated = block.match(/<Initiated>([\s\S]*?)<\/Initiated>/)?.[1];
        if (key && uploadId) uploads.push({ key, uploadId, initiated });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      keyMarker = truncated ? decodeXml(xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1] || "") : "";
      uploadIdMarker = truncated ? decodeXml(xml.match(/<NextUploadIdMarker>([\s\S]*?)<\/NextUploadIdMarker>/)?.[1] || "") : "";
    } while (keyMarker || uploadIdMarker);
    const result: StorageMultipartUpload[] = [];
    for (const upload of uploads) result.push({ ...upload, ...(await this.listMultipartParts(upload.key, upload.uploadId)) });
    return result;
  }
  async deleteObjects(relativePaths: string[]) {
    const relative = [...new Set(relativePaths.map(normalizeStorageKey))];
    if (!relative.length) return 0;
    if (relative.length > 1_000) throw new Error(`object_storage_batch_delete_limit_${relative.length}`);
    const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${relative.map((key) => `<Object><Key>${encodeXml(this.key(key))}</Key></Object>`).join("")}</Delete>`;
    const response = await this.signedBucketRequest("POST", { delete: "" }, body, {
      "content-type": "application/xml",
      "content-md5": crypto.createHash("md5").update(body).digest("base64"),
      "content-length": String(Buffer.byteLength(body)),
    });
    if (!response.ok) throw new Error(`object_storage_batch_delete_${response.status}`);
    const result = await response.text();
    const failures = result.match(/<Error>[\s\S]*?<\/Error>/g) || [];
    if (failures.length) throw new Error(`object_storage_batch_delete_partial_${failures.length}`);
    return relative.length;
  }
  async deletePrefix(prefix: string) {
    const objects = await this.listObjects(prefix);
    const batches: StorageObject[][] = [];
    for (let index = 0; index < objects.length; index += 1_000) batches.push(objects.slice(index, index + 1_000));
    const concurrency = Math.max(1, Math.min(16, Number(process.env.YC_OBJECT_STORAGE_DELETE_CONCURRENCY || 4)));
    let cursor = 0;
    let deleted = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, batches.length)) }, async () => {
      while (true) {
        const batch = batches[cursor++];
        if (!batch) return;
        try { deleted += await this.deleteObjects(batch.map((object) => object.key)); }
        catch { for (const object of batch) { await this.deleteJson(object.key); deleted++; } }
      }
    }));
    return deleted;
  }
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
export async function readChunkedDataJson<T>(relativePath: string, fallback: T[]): Promise<T[]> { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const stored = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(stored.value)) return readStorageOrSeed<T[]>(relativePath, fallback); const chunks = await Promise.all([...stored.value.chunks].reverse().map((chunk) => storage.readJson<T[]>(paths.rel(chunk.file), []))); const result = chunks.flat(); return result.length || stored.value.total === 0 ? result : fallback; }
export async function appendChunkedDataJson<T extends { id?: string }>(relativePath: string, item: T, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); if (!validIndex(indexMeta.value)) { await createIndexFromBase<T>(relativePath, maxRecordsPerChunk); continue; } const index = indexMeta.value; for (const chunk of index.chunks) { const activeRecords = await storage.readJson<T[]>(paths.rel(chunk.file), []); const duplicate = item.id ? activeRecords.find((record) => record.id === item.id) : null; if (duplicate) { index.total = index.chunks.reduce((total, descriptor) => total + descriptor.count, 0); return duplicate; } } const now = new Date().toISOString(); const activePosition = index.chunks.length - 1; const activeChunk = index.chunks[activePosition]; const appendToExisting = Boolean(activeChunk && activeChunk.count < index.maxRecordsPerChunk); const activeRecords = appendToExisting ? await storage.readJson<T[]>(paths.rel(activeChunk.file), []) : []; const duplicate = item.id ? activeRecords.find((record) => record.id === item.id) : null; if (duplicate) return duplicate; const nextRecords = [{ ...item }, ...activeRecords]; const sequence = appendToExisting ? activePosition + 1 : index.chunks.length + 1; const nextChunk: ChunkDescriptor = { file: immutableChunkFile(paths, sequence), count: nextRecords.length, createdAt: appendToExisting ? activeChunk.createdAt : now, updatedAt: now }; const nextChunks = appendToExisting ? [...index.chunks.slice(0, activePosition), nextChunk] : [...index.chunks, nextChunk]; const nextIndex: ChunkIndex = { ...index, chunks: nextChunks, total: nextChunks.reduce((total, chunk) => total + chunk.count, 0), updatedAt: now }; try { await storage.writeJson(paths.rel(nextChunk.file), nextRecords, { ifNoneMatch: "*" }); await storage.writeJson(paths.rel(paths.indexFile), nextIndex, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : { ifNoneMatch: "*" }); return nextRecords[0]; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function updateChunkedDataJson<T extends { id?: string }>(relativePath: string, id: string, update: (item: T) => T) { return withCollectionLock(relativePath, async () => { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const indexMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null); const index = validIndex(indexMeta.value) ? indexMeta.value : await ensureChunkIndex<T>(relativePath); for (let i = index.chunks.length - 1; i >= 0; i--) { const chunk = index.chunks[i]; const records = await storage.readJson<T[]>(paths.rel(chunk.file), []); const recordIndex = records.findIndex((record) => record.id === id); if (recordIndex === -1) continue; const nextRecords = [...records]; const updated = update(nextRecords[recordIndex]); nextRecords[recordIndex] = updated; const now = new Date().toISOString(); const nextChunk: ChunkDescriptor = { file: immutableChunkFile(paths, i + 1), count: nextRecords.length, createdAt: chunk.createdAt, updatedAt: now }; const nextChunks = [...index.chunks]; nextChunks[i] = nextChunk; const nextIndex: ChunkIndex = { ...index, chunks: nextChunks, total: nextChunks.reduce((total, descriptor) => total + descriptor.count, 0), updatedAt: now }; try { await storage.writeJson(paths.rel(nextChunk.file), nextRecords, { ifNoneMatch: "*" }); await storage.writeJson(paths.rel(paths.indexFile), nextIndex, indexMeta.found && indexMeta.etag ? { ifMatch: indexMeta.etag } : { ifNoneMatch: "*" }); return updated; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } return null; } throw new StorageConflictError(); }); }
export async function rebuildChunkedIndex(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) { const paths = collectionPaths(relativePath); const storage = getJsonStorage(); const records = await readChunkedDataJson(relativePath, []); const now = new Date().toISOString(); const groupsNewestFirst = []; for (let i = 0; i < records.length; i += maxRecordsPerChunk) groupsNewestFirst.push(records.slice(i, i + maxRecordsPerChunk)); if (!groupsNewestFirst.length) groupsNewestFirst.push([]); const groupsOldestFirst = [...groupsNewestFirst].reverse(); const chunks = groupsOldestFirst.map((group, i) => ({ file: i === 0 ? paths.chunkFile(1) : immutableChunkFile(paths, i + 1), count: group.length, createdAt: now, updatedAt: now })); for (let i = 0; i < groupsOldestFirst.length; i++) await storage.writeJson(paths.rel(chunks[i].file), groupsOldestFirst[i]); const index: ChunkIndex = { version: 1, collection: paths.parsed.name, maxRecordsPerChunk, total: records.length, updatedAt: now, chunks }; await storage.writeJson(paths.rel(paths.indexFile), index); return index; }
export async function mutateDataJson<T>(relativePath: string, fallback: T, updater: (current: T) => T | Promise<T>) { return withCollectionLock(relativePath, async () => { const storage = getJsonStorage(); for (let attempt = 0; attempt < 8; attempt++) { const meta = await storage.readJsonWithMeta<T>(relativePath, fallback); const next = await updater(meta.value); try { await storage.writeJson(relativePath, next, meta.found && meta.etag ? { ifMatch: meta.etag } : { ifNoneMatch: "*" }); return next; } catch (error) { if (error instanceof StorageConflictError) { await sleep(25 * (attempt + 1)); continue; } throw error; } } throw new StorageConflictError(); }); }
export async function checkStorageBootstrap() { const storage = getJsonStorage(); const collections = await Promise.all(REQUIRED_BOOTSTRAP_COLLECTIONS.map(async (collection) => ({ collection, present: (await storage.readJsonWithMeta(collection, null)).found }))); return { driver: storage.driver, collections, bootstrapCompleted: storage.driver === "local" || collections.every((item) => item.present) }; }
