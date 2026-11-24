import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync, openSync, closeSync, writeSync, chmodSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {InventoryError, need, hash, safeKey, safePrefix} from './inventory-storage.mjs';

/** Disk-backed inventories: page count, duplicate detection and sorting never require
 * retaining the complete object listing in JavaScript memory. No source storage writes. */
export class InventoryLedger {
  constructor(parent = os.tmpdir()) {
    this.directory = mkdtempSync(path.join(parent, 'china-readonly-inventory-'));
    chmodSync(this.directory, 0o700);
    const file = path.join(this.directory, 'ledger.sqlite');
    closeSync(openSync(file, 'wx', 0o600));
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA temp_store=FILE;
      CREATE TABLE objects(key TEXT PRIMARY KEY, size INTEGER NOT NULL, etag TEXT NOT NULL,
        version_id TEXT, sha256 TEXT, content_type TEXT, content_encoding TEXT);
      CREATE TABLE scans(prefix TEXT PRIMARY KEY, pages INTEGER NOT NULL DEFAULT 0,
        complete INTEGER NOT NULL DEFAULT 0, terminal_sha TEXT, chain_sha TEXT);
      CREATE TABLE seen_keys(prefix TEXT, key TEXT, PRIMARY KEY(prefix,key));
      CREATE TABLE seen_tokens(prefix TEXT, digest TEXT, PRIMARY KEY(prefix,digest));
      CREATE TABLE edges(parent TEXT, field TEXT, child TEXT, kind TEXT, expected_sha TEXT,
        hash_domain TEXT, PRIMARY KEY(parent,field,child));`);
  }
  object(key) { return this.db.prepare('SELECT * FROM objects WHERE key=?').get(key); }
  addObject(value) {
    need(safeKey(value.key) && Number.isSafeInteger(value.size) && value.size >= 0
      && typeof value.etag === 'string' && value.etag, 'inventory_ledger_object');
    const old = this.object(value.key);
    if (old) {
      need(old.size === value.size && old.etag === value.etag
        && (!old.version_id || !value.versionId || old.version_id === value.versionId)
        && (!old.sha256 || !value.sha256 || old.sha256 === value.sha256), 'inventory_object_changed');
      this.db.prepare(`UPDATE objects SET version_id=COALESCE(version_id,?),sha256=COALESCE(sha256,?),
        content_type=COALESCE(content_type,?),content_encoding=COALESCE(content_encoding,?) WHERE key=?`)
        .run(value.versionId ?? null, value.sha256 ?? null, value.contentType ?? null, value.contentEncoding ?? null, value.key);
    } else this.db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?,?)')
      .run(value.key, value.size, value.etag, value.versionId ?? null, value.sha256 ?? null,
        value.contentType ?? null, value.contentEncoding ?? null);
  }
  edge(parent, field, child, kind, expectedSha = null, hashDomain = null) {
    need(safeKey(parent) && typeof field === 'string' && (safeKey(child) || safePrefix(child)), 'inventory_edge_scope');
    const old = this.db.prepare('SELECT * FROM edges WHERE parent=? AND field=? AND child=?').get(parent, field, child);
    if (old) need(old.kind === kind && old.expected_sha === expectedSha && old.hash_domain === hashDomain, 'inventory_edge_conflict');
    else this.db.prepare('INSERT INTO edges VALUES(?,?,?,?,?,?)').run(parent, field, child, kind, expectedSha, hashDomain);
  }
  scan(prefix) { return this.db.prepare('SELECT * FROM scans WHERE prefix=?').get(prefix); }
  beginScan(prefix) {
    need(safePrefix(prefix) && !this.scan(prefix), 'inventory_scan_duplicate');
    this.db.prepare('INSERT INTO scans(prefix) VALUES(?)').run(prefix);
  }
  page(prefix, token, page) {
    const scan = this.scan(prefix);
    need(scan && !scan.complete && Array.isArray(page.objects) && typeof page.truncated === 'boolean'
      && page.keyCount === page.objects.length, 'inventory_page_invalid');
    need(page.truncated ? typeof page.nextToken === 'string' && page.nextToken && page.nextToken !== token
      : page.nextToken === null, 'inventory_list_next_token');
    this.db.exec('BEGIN');
    try {
      const tokenDigest = hash(token ?? '<first>');
      need(!this.db.prepare('SELECT 1 FROM seen_tokens WHERE prefix=? AND digest=?').get(prefix, tokenDigest), 'inventory_list_token_cycle');
      this.db.prepare('INSERT INTO seen_tokens VALUES(?,?)').run(prefix, tokenDigest);
      if (page.truncated) need(!this.db.prepare('SELECT 1 FROM seen_tokens WHERE prefix=? AND digest=?')
        .get(prefix, hash(page.nextToken)), 'inventory_list_token_cycle');
      for (const object of page.objects) {
        need(safeKey(object.key) && object.key.startsWith(prefix), 'inventory_list_key_scope');
        need(!this.db.prepare('SELECT 1 FROM seen_keys WHERE prefix=? AND key=?').get(prefix, object.key), 'inventory_list_duplicate_key');
        this.db.prepare('INSERT INTO seen_keys VALUES(?,?)').run(prefix, object.key);
        this.addObject(object);
      }
      const chain = hash(JSON.stringify([scan.chain_sha, tokenDigest, page.responseSha256, page.keyCount, page.truncated]));
      this.db.prepare('UPDATE scans SET pages=pages+1,complete=?,terminal_sha=?,chain_sha=? WHERE prefix=?')
        .run(page.truncated ? 0 : 1, page.truncated ? null : page.responseSha256, chain, prefix);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error instanceof InventoryError ? error : new InventoryError('inventory_ledger_failed'); }
  }
  summary() {
    const totals = this.db.prepare('SELECT COUNT(*) AS objects,COALESCE(SUM(size),0) AS bytes FROM objects').get();
    const content = this.db.prepare('SELECT COUNT(*) AS objects FROM objects WHERE sha256 IS NOT NULL').get();
    const digest = createHash('sha256');
    for (const row of this.db.prepare('SELECT key,size,etag,version_id FROM objects ORDER BY key').iterate()) digest.update(JSON.stringify(row) + '\n');
    const scans = [];
    for (const scan of this.db.prepare('SELECT * FROM scans ORDER BY prefix').iterate()) {
      const counts = this.db.prepare('SELECT COUNT(*) AS objects,COALESCE(SUM(o.size),0) AS bytes FROM seen_keys s JOIN objects o USING(key) WHERE s.prefix=?').get(scan.prefix);
      scans.push({prefix: scan.prefix, pages: scan.pages, complete: scan.complete === 1,
        objects: counts.objects, bytes: counts.bytes, terminalResponseSha256: scan.terminal_sha, pageChainSha256: scan.chain_sha});
    }
    return {...totals, contentHashedObjects: content.objects, inventorySha256: digest.digest('hex'), scans,
      edges: this.db.prepare('SELECT COUNT(*) AS n FROM edges').get().n};
  }
  exportPrivate(filename) {
    const fd = openSync(filename, 'wx', 0o600);
    try {
      for (const table of ['objects', 'edges', 'scans']) {
        for (const row of this.db.prepare(`SELECT * FROM ${table}`).iterate()) writeSync(fd, JSON.stringify({kind: table, ...row}) + '\n');
      }
    } finally { closeSync(fd); }
  }
  close() { this.db.close(); }
}
