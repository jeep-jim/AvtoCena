import fs from "node:fs";
import path from "node:path";

export const JSON_CHUNK_LIMIT = 500;

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

function absoluteDataPath(relativePath: string) {
  return path.join(getDataRoot(), relativePath);
}

function writeJsonFile(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf-8");

  try {
    fs.renameSync(temporaryPath, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  }
}

export function readDataJson<T>(relativePath: string, fallback: T): T {
  try {
    const filePath = absoluteDataPath(relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeDataJson(relativePath: string, value: unknown) {
  writeJsonFile(absoluteDataPath(relativePath), value);
}

export function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) {
  const list = readDataJson<T[]>(relativePath, []);
  const next = [{ ...item }, ...list];
  writeDataJson(relativePath, next);
  return next[0];
}

function collectionPaths(relativePath: string) {
  const directory = path.dirname(relativePath);
  const extension = path.extname(relativePath) || ".json";
  const basename = path.basename(relativePath, extension);

  return {
    directory,
    extension,
    basename,
    indexRelativePath: path.join(directory, `${basename}-index.json`)
  };
}

function createInitialChunkIndex<T>(relativePath: string, maxRecordsPerChunk: number) {
  const { basename, extension, indexRelativePath } = collectionPaths(relativePath);
  const now = new Date().toISOString();
  const legacyItems = readDataJson<T[]>(relativePath, []);
  const newestFirstGroups: T[][] = [];

  for (let offset = 0; offset < legacyItems.length; offset += maxRecordsPerChunk) {
    newestFirstGroups.push(legacyItems.slice(offset, offset + maxRecordsPerChunk));
  }

  if (!newestFirstGroups.length) newestFirstGroups.push([]);

  const oldestFirstGroups = [...newestFirstGroups].reverse();
  const chunks = oldestFirstGroups.map((items, indexPosition) => {
    const file = indexPosition === 0
      ? path.basename(relativePath)
      : `${basename}-${String(indexPosition + 1).padStart(4, "0")}${extension}`;

    writeDataJson(chunkRelativePath(relativePath, file), items);

    return {
      file,
      count: items.length,
      createdAt: now,
      updatedAt: now
    };
  });

  const index: ChunkIndex = {
    version: 1,
    collection: basename,
    maxRecordsPerChunk,
    total: legacyItems.length,
    updatedAt: now,
    chunks
  };

  writeDataJson(indexRelativePath, index);
  return index;
}

function readChunkIndex(relativePath: string) {
  const { indexRelativePath } = collectionPaths(relativePath);
  return readDataJson<ChunkIndex | null>(indexRelativePath, null);
}

function writeChunkIndex(relativePath: string, index: ChunkIndex) {
  const { indexRelativePath } = collectionPaths(relativePath);
  writeDataJson(indexRelativePath, index);
}

function chunkRelativePath(relativePath: string, file: string) {
  return path.join(path.dirname(relativePath), file);
}

export function readChunkedDataJson<T>(relativePath: string, fallback: T[] = []): T[] {
  const index = readChunkIndex(relativePath);
  if (!index?.chunks?.length) return readDataJson<T[]>(relativePath, fallback);

  const result: T[] = [];

  for (const chunk of [...index.chunks].reverse()) {
    const items = readDataJson<T[]>(chunkRelativePath(relativePath, chunk.file), []);
    result.push(...items);
  }

  return result;
}

export function appendChunkedDataJson<T extends { id?: string }>(
  relativePath: string,
  item: T,
  maxRecordsPerChunk = JSON_CHUNK_LIMIT
) {
  const { basename, extension } = collectionPaths(relativePath);
  const now = new Date().toISOString();
  const index = readChunkIndex(relativePath) ?? createInitialChunkIndex<T>(relativePath, maxRecordsPerChunk);
  const limit = index.maxRecordsPerChunk || maxRecordsPerChunk;

  let currentChunk = index.chunks[index.chunks.length - 1];

  if (!currentChunk || currentChunk.count >= limit) {
    const chunkNumber = index.chunks.length + 1;
    const file = `${basename}-${String(chunkNumber).padStart(4, "0")}${extension}`;

    currentChunk = {
      file,
      count: 0,
      createdAt: now,
      updatedAt: now
    };

    index.chunks.push(currentChunk);
    writeDataJson(chunkRelativePath(relativePath, file), []);
  }

  const currentRelativePath = chunkRelativePath(relativePath, currentChunk.file);
  const currentItems = readDataJson<T[]>(currentRelativePath, []);
  writeDataJson(currentRelativePath, [{ ...item }, ...currentItems]);

  currentChunk.count += 1;
  currentChunk.updatedAt = now;
  index.total += 1;
  index.updatedAt = now;
  index.maxRecordsPerChunk = limit;
  writeChunkIndex(relativePath, index);

  return { ...item };
}

export function updateChunkedDataJson<T extends { id: string }>(
  relativePath: string,
  id: string,
  updater: (item: T) => T
): T | null {
  const now = new Date().toISOString();
  const index = readChunkIndex(relativePath);

  if (!index?.chunks?.length) {
    const items = readDataJson<T[]>(relativePath, []);
    const itemIndex = items.findIndex((item) => item.id === id);
    if (itemIndex === -1) return null;

    const updated = updater(items[itemIndex]);
    items[itemIndex] = updated;
    writeDataJson(relativePath, items);
    return updated;
  }

  for (let indexPosition = index.chunks.length - 1; indexPosition >= 0; indexPosition -= 1) {
    const chunk = index.chunks[indexPosition];
    const relativeChunkPath = chunkRelativePath(relativePath, chunk.file);
    const items = readDataJson<T[]>(relativeChunkPath, []);
    const itemIndex = items.findIndex((item) => item.id === id);

    if (itemIndex === -1) continue;

    const updated = updater(items[itemIndex]);
    items[itemIndex] = updated;
    writeDataJson(relativeChunkPath, items);

    chunk.updatedAt = now;
    index.updatedAt = now;
    writeChunkIndex(relativePath, index);
    return updated;
  }

  return null;
}

export function getChunkedCollectionInfo(relativePath: string) {
  const index = readChunkIndex(relativePath);
  if (index) return index;

  const items = readDataJson<unknown[]>(relativePath, []);
  return {
    version: 1 as const,
    collection: collectionPaths(relativePath).basename,
    maxRecordsPerChunk: JSON_CHUNK_LIMIT,
    total: items.length,
    updatedAt: null,
    chunks: [
      {
        file: path.basename(relativePath),
        count: items.length,
        createdAt: null,
        updatedAt: null
      }
    ]
  };
}
