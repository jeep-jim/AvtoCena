import 'server-only';
import {createHash} from 'node:crypto';
import {constants, type Stats} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ChinaCatalogStatus = Readonly<{
  status: 'ready'; sourceObservedAt: string; rows: number; generationId: string;
}> | Readonly<{status: 'unavailable'}>;

const UNAVAILABLE: ChinaCatalogStatus = Object.freeze({status: 'unavailable'});
const MAX_BYTES = 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/, RUNTIME = /^[a-f0-9]{40}$/;
const GENERATION = /^gen_china_[1-9]\d{0,19}_[1-9]\d{0,5}$/;
const record = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const need = (value: unknown) => { if (!value) throw Error('china_catalog_status_unavailable'); };
const sameFile = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
const sameDirectory = (left: Stats, right: Stats) => right.isDirectory() && !right.isSymbolicLink() &&
  left.dev === right.dev && left.ino === right.ino;
const configured = (environment: NodeJS.ProcessEnv) => ({
  directory: environment.CATALOG_CHINA_LOCAL_GENERATION_DIR || '',
  manifestSha256: environment.CATALOG_CHINA_LOCAL_MANIFEST_SHA256 || '',
  runtimeSha: environment.CATALOG_CHINA_LOCAL_RUNTIME_SHA || '',
});

function sourceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)) return false;
  const instant = Date.parse(value);
  // Date.parse normalizes impossible dates; reject those instead of displaying them.
  return Number.isFinite(instant) && instant <= Date.now() &&
    new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19);
}

function project(value: unknown, runtimeSha: string): ChinaCatalogStatus {
  need(record(value));
  const manifest = value as Record<string, any>;
  need(manifest.version === 1 && manifest.kind === 'china-local-generation-v1' && manifest.market === 'china' &&
    manifest.prepared === true && manifest.runtimeSha === runtimeSha &&
    typeof manifest.generationId === 'string' && GENERATION.test(manifest.generationId));
  const {source, queryIndex, reconciliation, rows} = manifest;
  need(record(source) && source.supplierLatestVerified === true && sourceDate(source.sourceObservedAt) &&
    Number.isSafeInteger(source.cursor) && source.cursor >= 0);
  need(Number.isSafeInteger(rows) && rows > 0 && record(queryIndex) && queryIndex.version === 1 &&
    queryIndex.kind === 'china-query-index-v1' && queryIndex.rows === rows && record(queryIndex.binding) &&
    queryIndex.binding.version === 1 && queryIndex.binding.market === 'china' &&
    queryIndex.binding.generationId === manifest.generationId &&
    queryIndex.binding.sourceCursor === source.cursor && queryIndex.binding.sourceObservedAt === source.sourceObservedAt);
  need(record(reconciliation) && reconciliation.version === 1 &&
    reconciliation.kind === 'china-frozen-pricing-reconciliation-v1' && reconciliation.market === 'china' &&
    reconciliation.generationId === manifest.generationId && reconciliation.admittedRows === rows &&
    reconciliation.sourceObservedAt === source.sourceObservedAt && reconciliation.supplierLatestVerified === true);
  // This is the source observation in the mounted generation, not acceptedAt.
  // The sealed preparation manifest deliberately retains published:false.
  return Object.freeze({status: 'ready', sourceObservedAt: source.sourceObservedAt, rows, generationId: manifest.generationId});
}

/** Owner metadata only: one bounded local manifest, without opening the catalog
 * reader, SQLite, generation payloads, mutable storage or a network connection.
 * The Linux directory handle pins the configured mount during the file read. */
export async function readChinaCatalogStatus(environment: NodeJS.ProcessEnv = process.env): Promise<ChinaCatalogStatus> {
  let directory: Awaited<ReturnType<typeof fs.open>> | undefined;
  let file: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const config = configured(environment);
    need(path.isAbsolute(config.directory) && config.directory !== path.parse(config.directory).root &&
      path.normalize(config.directory) === config.directory && SHA.test(config.manifestSha256) && RUNTIME.test(config.runtimeSha));
    const beforeDirectory = await fs.lstat(config.directory);
    need(beforeDirectory.isDirectory() && !beforeDirectory.isSymbolicLink() && await fs.realpath(config.directory) === config.directory);
    directory = await fs.open(config.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const directoryFd = '/proc/self/fd/' + directory.fd;
    need(sameDirectory(beforeDirectory, await directory.stat()) && await fs.realpath(directoryFd) === config.directory);
    const filename = path.join(config.directory, 'GENERATION.json');
    const pinnedFilename = directoryFd + '/GENERATION.json';
    const beforeFile = await fs.lstat(pinnedFilename);
    need(beforeFile.isFile() && !beforeFile.isSymbolicLink() && beforeFile.nlink === 1 &&
      beforeFile.size > 0 && beforeFile.size <= MAX_BYTES);
    file = await fs.open(pinnedFilename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    need(sameFile(beforeFile, await file.stat()) && await fs.realpath('/proc/self/fd/' + file.fd) === filename);
    // Never read beyond the initial bounded size, even if the file changes.
    const bytes = Buffer.alloc(beforeFile.size);
    for (let offset = 0; offset < bytes.length;) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      need(read.bytesRead > 0); offset += read.bytesRead;
    }
    need(sameFile(beforeFile, await file.stat()) && sameFile(beforeFile, await fs.lstat(pinnedFilename)) &&
      sameDirectory(beforeDirectory, await fs.lstat(config.directory)) && await fs.realpath(config.directory) === config.directory &&
      JSON.stringify(configured(environment)) === JSON.stringify(config));
    need(createHash('sha256').update(bytes).digest('hex') === config.manifestSha256);
    return project(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), config.runtimeSha);
  } catch {
    return UNAVAILABLE;
  } finally {
    await file?.close().catch(() => {});
    await directory?.close().catch(() => {});
  }
}
