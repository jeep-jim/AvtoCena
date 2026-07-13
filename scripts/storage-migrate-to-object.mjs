import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.JSON_STORAGE_DRIVER = 'object';
const root = process.cwd();
const dataRoot = join(root, 'data');
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
if (force) console.warn('WARNING: --force will overwrite existing Object Storage JSON objects.');
const allCollections = ['clients/clients.json','leads/leads.json','activity/feed.json','deals/deals.json','partners/partners.json','partners/accruals.json','cpa/networks.json','cpa/payouts.json','markets/markets.json','settings/site-business.json','settings/change-log.json','contracts/templates.json'];
const collections = onlyArg ? allCollections.filter((item) => item === onlyArg.slice('--only='.length)) : allCollections;
const { ObjectJsonStorage, StorageConflictError } = await import(pathToFileURL(join(root, 'apps/web/lib/data.ts')).href).catch(async () => import('../apps/web/lib/data.ts'));
const storage = dryRun ? null : new ObjectJsonStorage();
function safeJson(filePath, fallback){ try { return JSON.parse(readFileSync(filePath,'utf8')); } catch { return fallback; } }
function countRecords(value){ return Array.isArray(value) ? value.length : (value && typeof value === 'object' && Array.isArray(value.versions) ? value.versions.length : 1); }
function filesFor(collection){ const dir=join(dataRoot, collection.split('/').slice(0,-1).join('/')); const base=collection.split('/').pop(); if (!existsSync(dir)) return { files: [], skipped: 'not_found' }; const name=base.replace(/\.json$/, ''); const files = readdirSync(dir).filter((file) => file===base || file===`${name}-index.json` || (file.startsWith(`${name}-`) && file.endsWith('.json'))).map((file)=>join(dir,file)); return { files, skipped: files.length ? null : 'not_found' }; }
function walk(dir){ if (!existsSync(dir)) return []; return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const full = join(dir, entry.name); return entry.isDirectory() ? walk(full) : [full]; }); }
function mime(file){ const ext=extname(file).toLowerCase(); if(ext==='.png') return 'image/png'; if(ext==='.pdf') return 'application/pdf'; if(ext==='.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; return 'application/octet-stream'; }
const report=[];
for (const collection of collections) {
  const { files, skipped } = filesFor(collection); const item = { collection, files: files.length, records: 0, skipped, skipped_existing: 0, errors: [] };
  for (const file of files) { const rel = relative(dataRoot, file).replaceAll('\\','/'); const json = safeJson(file, null); if (json === null) { item.errors.push({ file: rel, error: 'invalid_json' }); continue; } if (!rel.includes('-index.json')) item.records += countRecords(json); if (!dryRun) { try { await storage.writeJson(rel, json, force ? undefined : { ifNoneMatch: '*' }); const uploaded = await storage.readJson(rel, null); if (JSON.stringify(uploaded) !== JSON.stringify(json)) item.errors.push({ file: rel, error: 'verify_failed' }); } catch (error) { if (error instanceof StorageConflictError && !force) item.skipped_existing += 1; else item.errors.push({ file: rel, error: error instanceof Error ? error.message : 'upload_failed' }); } } }
  report.push(item);
}
const binaryFiles = walk(join(dataRoot, 'contracts', 'uploads'));
const binary = { collection: 'contracts/uploads/**', files: binaryFiles.length, records: binaryFiles.length, skipped: binaryFiles.length ? null : 'not_found', skipped_existing: 0, errors: [] };
for (const file of binaryFiles) { const rel = relative(dataRoot, file).replaceAll('\\','/'); if (!dryRun) { try { const data = readFileSync(file); if (!force && await storage.binaryExists(rel)) { binary.skipped_existing += 1; continue; } await storage.putBinary(rel, data, mime(file), force ? undefined : { ifNoneMatch: '*' }); const uploaded = await storage.getBinary(rel); if (uploaded.size !== statSync(file).size) binary.errors.push({ file: rel, error: 'verify_failed' }); } catch (error) { binary.errors.push({ file: rel, error: error instanceof Error ? error.message : 'upload_failed' }); } } }
report.push(binary);
const hasErrors = report.some((item) => item.errors.length || item.skipped_existing);
console.log(JSON.stringify({ ok: !hasErrors, dryRun, force, driver:'object', bucketConfigured: Boolean(process.env.YC_OBJECT_STORAGE_BUCKET), prefix: process.env.YC_OBJECT_STORAGE_PREFIX || '', report }, null, 2));
if (hasErrors) process.exitCode = 1;
