import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_RECORDS_PER_CHUNK = 500;

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

export function getDataRoot() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "data"),
    path.join(cwd, "..", "..", "data"),
    path.join(cwd, "..", "data"),
    path.join(process.cwd(), "apps", "web", "..", "..", "data")
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? path.join(cwd, "data");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(temporaryPath, filePath);
}

function collectionPaths(relativePath: string) {
  const parsed = path.parse(relativePath);
  const directory = path.join(getDataRoot(), parsed.dir);
  const baseFile = parsed.base;
  const basePath = path.join(directory, baseFile);
  const indexFile = `${parsed.name}-index${parsed.ext || ".json"}`;
  const indexPath = path.join(directory, indexFile);

  function chunkFile(sequence: number) {
    if (sequence <= 1) return baseFile;
    return `${parsed.name}-${String(sequence).padStart(4, "0")}${parsed.ext || ".json"}`;
  }

  return {
    parsed,
    directory,
    baseFile,
    basePath,
    indexFile,
    indexPath,
    chunkFile
  };
}

function validIndex(value: unknown): value is ChunkIndex {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChunkIndex>;

  return (
    candidate.version === 1 &&
    typeof candidate.collection === "string" &&
    typeof candidate.maxRecordsPerChunk === "number" &&
    Array.isArray(candidate.chunks)
  );
}

function createIndexFromBase<T>(relativePath: string, maxRecordsPerChunk: number) {
  const paths = collectionPaths(relativePath);
  const existing = readJsonFile<T[]>(paths.basePath, []);
  const now = new Date().toISOString();
  const groupsNewestFirst: T[][] = [];

  for (let offset = 0; offset < existing.length; offset += maxRecordsPerChunk) {
    groupsNewestFirst.push(existing.slice(offset, offset + maxRecordsPerChunk));
  }

  if (!groupsNewestFirst.length) groupsNewestFirst.push([]);

  const groupsOldestFirst = [...groupsNewestFirst].reverse();
  const chunks: ChunkDescriptor[] = groupsOldestFirst.map((group, index) => {
    const file = paths.chunkFile(index + 1);
    writeJsonFileAtomic(path.join(paths.directory, file), group);

    return {
      file,
      count: group.length,
      createdAt: now,
      updatedAt: now
    };
  });

  const index: ChunkIndex = {
    version: 1,
    collection: paths.parsed.name,
    maxRecordsPerChunk,
    total: existing.length,
    updatedAt: now,
    chunks
  };

  writeJsonFileAtomic(paths.indexPath, index);
  return index;
}

function ensureChunkIndex<T>(relativePath: string, maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK) {
  const paths = collectionPaths(relativePath);
  const stored = readJsonFile<unknown>(paths.indexPath, null);

  if (validIndex(stored)) return stored;
  return createIndexFromBase<T>(relativePath, maxRecordsPerChunk);
}

export function readDataJson<T>(relativePath: string, fallback: T): T {
  return readJsonFile(path.join(getDataRoot(), relativePath), fallback);
}

export function writeDataJson(relativePath: string, value: unknown) {
  writeJsonFileAtomic(path.join(getDataRoot(), relativePath), value);
}

export function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) {
  const list = readDataJson<T[]>(relativePath, []);
  const next = [{ ...item }, ...list];
  writeDataJson(relativePath, next);
  return next[0];
}

export function readChunkedDataJson<T>(relativePath: string, fallback: T[]): T[] {
  const paths = collectionPaths(relativePath);
  const stored = readJsonFile<unknown>(paths.indexPath, null);

  if (!validIndex(stored)) {
    return readJsonFile<T[]>(paths.basePath, fallback);
  }

  const result: T[] = [];

  for (const chunk of [...stored.chunks].reverse()) {
    const records = readJsonFile<T[]>(path.join(paths.directory, chunk.file), []);
    result.push(...records);
  }

  return result.length || stored.total === 0 ? result : fallback;
}

export function appendChunkedDataJson<T extends { id?: string }>(
  relativePath: string,
  item: T,
  maxRecordsPerChunk = DEFAULT_MAX_RECORDS_PER_CHUNK
) {
  const paths = collectionPaths(relativePath);
  const index = ensureChunkIndex<T>(relativePath, maxRecordsPerChunk);
  const now = new Date().toISOString();
  let activeChunk = index.chunks[index.chunks.length - 1];

  if (!activeChunk || activeChunk.count >= index.maxRecordsPerChunk) {
    activeChunk = {
      file: paths.chunkFile(index.chunks.length + 1),
      count: 0,
      createdAt: now,
      updatedAt: now
    };
    index.chunks.push(activeChunk);
  }

  const chunkPath = path.join(paths.directory, activeChunk.file);
  const records = readJsonFile<T[]>(chunkPath, []);
  const storedItem = { ...item };
  records.unshift(storedItem);

  writeJsonFileAtomic(chunkPath, records);

  activeChunk.count = records.length;
  activeChunk.updatedAt = now;
  index.total = index.chunks.reduce((total, chunk) => total + chunk.count, 0);
  index.updatedAt = now;
  writeJsonFileAtomic(paths.indexPath, index);

  return storedItem;
}

export function updateChunkedDataJson<T extends { id?: string }>(
  relativePath: string,
  id: string,
  update: (item: T) => T
) {
  const paths = collectionPaths(relativePath);
  const index = ensureChunkIndex<T>(relativePath);

  for (let chunkIndex = index.chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = index.chunks[chunkIndex];
    const chunkPath = path.join(paths.directory, chunk.file);
    const records = readJsonFile<T[]>(chunkPath, []);
    const recordIndex = records.findIndex((record) => record.id === id);

    if (recordIndex === -1) continue;

    const updated = update(records[recordIndex]);
    records[recordIndex] = updated;
    writeJsonFileAtomic(chunkPath, records);

    const now = new Date().toISOString();
    chunk.count = records.length;
    chunk.updatedAt = now;
    index.total = index.chunks.reduce((total, descriptor) => total + descriptor.count, 0);
    index.updatedAt = now;
    writeJsonFileAtomic(paths.indexPath, index);

    return updated;
  }

  return null;
}
