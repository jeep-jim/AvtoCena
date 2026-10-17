import crypto from "node:crypto";
import path from "node:path";
import { getJsonStorage, StorageConflictError } from "./data";

type ChunkDescriptor = {
  file: string;
  count: number;
  createdAt: string;
  updatedAt: string;
};

type ChunkIndex = {
  version: 1;
  collection: string;
  maxRecordsPerChunk: number;
  total: number;
  updatedAt: string;
  chunks: ChunkDescriptor[];
};

function collectionPaths(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  const parsed = path.posix.parse(normalized);
  const directory = parsed.dir;
  const extension = parsed.ext || ".json";
  const indexFile = `${parsed.name}-index${extension}`;
  const rel = (file: string) => path.posix.join(directory, file);
  const chunkFile = (sequence: number) => `${parsed.name}-${String(sequence).padStart(4, "0")}-${crypto.randomUUID()}${extension}`;
  return { parsed, indexFile, rel, chunkFile };
}

function validIndex(value: unknown): value is ChunkIndex {
  const candidate = value as Partial<ChunkIndex>;
  return Boolean(candidate
    && typeof candidate === "object"
    && candidate.version === 1
    && typeof candidate.collection === "string"
    && Array.isArray(candidate.chunks));
}

export async function replaceChunkedDataJson<T>(
  relativePath: string,
  records: T[],
  maxRecordsPerChunk = 250,
) {
  const paths = collectionPaths(relativePath);
  const storage = getJsonStorage();
  const chunkSize = Math.max(1, Math.min(500, Math.floor(maxRecordsPerChunk)));

  for (let attempt = 0; attempt < 8; attempt++) {
    const currentMeta = await storage.readJsonWithMeta<unknown>(paths.rel(paths.indexFile), null);
    const currentIndex = validIndex(currentMeta.value) ? currentMeta.value : null;
    const now = new Date().toISOString();
    const groups = [] as T[][];
    for (let index = 0; index < records.length; index += chunkSize) {
      groups.push(records.slice(index, index + chunkSize));
    }
    if (!groups.length) groups.push([]);

    const chunks: ChunkDescriptor[] = groups.map((group, index) => ({
      file: paths.chunkFile(index + 1),
      count: group.length,
      createdAt: now,
      updatedAt: now,
    }));

    try {
      for (let index = 0; index < groups.length; index++) {
        await storage.writeJson(paths.rel(chunks[index].file), groups[index], { ifNoneMatch: "*" });
      }

      const nextIndex: ChunkIndex = {
        version: 1,
        collection: paths.parsed.name,
        maxRecordsPerChunk: chunkSize,
        total: records.length,
        updatedAt: now,
        chunks,
      };
      await storage.writeJson(
        paths.rel(paths.indexFile),
        nextIndex,
        currentMeta.found && currentMeta.etag ? { ifMatch: currentMeta.etag } : { ifNoneMatch: "*" },
      );

      if (currentIndex && storage.deleteJson) {
        const active = new Set(chunks.map((chunk) => chunk.file));
        await Promise.all(currentIndex.chunks
          .filter((chunk) => !active.has(chunk.file))
          .map((chunk) => storage.deleteJson?.(paths.rel(chunk.file)).catch(() => undefined)));
      }
      return nextIndex;
    } catch (error) {
      await Promise.all(chunks.map((chunk) => storage.deleteJson?.(paths.rel(chunk.file)).catch(() => undefined)));
      if (error instanceof StorageConflictError) continue;
      throw error;
    }
  }

  throw new StorageConflictError();
}
