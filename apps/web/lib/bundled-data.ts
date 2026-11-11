import fs from "node:fs/promises";
import path from "node:path";
import { getDataRoot } from "./data";

type ChunkDescriptor = { file: string; count: number };
type ChunkIndex = { version: 1; total: number; chunks: ChunkDescriptor[] };

function safeBundledPath(relativePath: string) {
  const root = path.resolve(getDataRoot());
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid_bundled_data_path");
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("invalid_bundled_data_path");
  return target;
}

async function readBundledJson<T>(relativePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(safeBundledPath(relativePath), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function chunkPaths(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const parsed = path.posix.parse(normalized);
  const extension = parsed.ext || ".json";
  const directory = parsed.dir;
  return {
    index: path.posix.join(directory, `${parsed.name}-index${extension}`),
    chunk: (file: string) => path.posix.join(directory, file),
  };
}

function validChunkIndex(value: unknown): value is ChunkIndex {
  const candidate = value as Partial<ChunkIndex>;
  return Boolean(candidate
    && typeof candidate === "object"
    && candidate.version === 1
    && Number.isFinite(Number(candidate.total))
    && Array.isArray(candidate.chunks)
    && candidate.chunks.every((chunk) => chunk && typeof chunk.file === "string" && Number.isFinite(Number(chunk.count))));
}

/**
 * Stable reference knowledge is versioned with the application image in GitHub.
 * Runtime Object Storage can contain historical catalog-era copies of the same
 * paths, so knowledge readers must not let those stale objects shadow the
 * bundled repository snapshot.
 */
export async function readBundledDataJson<T>(relativePath: string, fallback: T): Promise<T> {
  return readBundledJson(relativePath, fallback);
}

export async function readBundledChunkedDataJson<T>(relativePath: string, fallback: T[]): Promise<T[]> {
  const paths = chunkPaths(relativePath);
  const index = await readBundledJson<unknown>(paths.index, null);
  if (!validChunkIndex(index)) return readBundledJson(relativePath, fallback);
  const chunks = await Promise.all(index.chunks.map((chunk) => readBundledJson<T[]>(paths.chunk(chunk.file), [])));
  const records = chunks.flat();
  if (records.length === Number(index.total)) return records;
  if (Number(index.total) === 0) return [];
  return fallback;
}
