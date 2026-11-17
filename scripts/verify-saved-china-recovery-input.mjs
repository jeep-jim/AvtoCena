import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const dir=path.join(process.env.CATALOG_INTAKE_INPUT_DIR||'catalog-intake-input','catalog-intake-china');
const stat=fs.statSync(path.join(dir,'report.json'));assert.ok(stat.size<=128*1024**2);
const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
assert.equal(report.completed,true);assert.equal(report.market,'china');assert.equal(report.provider,'auto_api_che168');
assert.equal(report.completedAt,'2026-11-16T23:57:09.965Z');
const at=Date.parse(report.completedAt),age=Date.now()-at;assert.ok(age>=0&&age<=48*3600000,'saved intake too old; do not relabel/recollect automatically');
assert.equal(report.sources.length,1);const source=report.sources[0];
assert.equal(source.completeInventory,true);assert.equal(source.stopReason,'source_finished');assert.equal(source.cursor,13067823);assert.equal(source.uniqueOffers,288619);
const removed=new Map();for(const row of report.confirmedWithdrawals){assert.equal(row.market,'china');assert.equal(row.sourceId,'autohome_used_china_open');assert.equal(row.status,'removed');assert.ok(Date.parse(row.observedAt)<=at);assert.ok(!removed.has(row.id));removed.set(row.id,row);}
assert.equal(removed.size,232277);
const active=new Set();let reappeared=0;
for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.jsonl')).sort()){
 assert.match(name,/^autohome_used_china_open-\d{6}\.jsonl$/);assert.ok(fs.statSync(path.join(dir,name)).size<=32*1024**2);
 const lines=createInterface({input:fs.createReadStream(path.join(dir,name)),crlfDelay:Infinity});
 for await(const line of lines){if(!line)continue;const o=JSON.parse(line).offer;assert.equal(o.market,'china');assert.equal(o.sourceId,'autohome_used_china_open');assert.equal(o.id,createHash('sha256').update(o.sourceId+':'+o.sourceOfferId).digest('hex').slice(0,24));assert.ok(!active.has(o.id));active.add(o.id);assert.equal(o.operational.lastSeenAt,report.completedAt);if(removed.has(o.id)){assert.ok(Date.parse(o.operational.lastSeenAt)>Date.parse(removed.get(o.id).observedAt));reappeared++;}}
}
assert.equal(active.size,288619);assert.equal(reappeared,7999);
for(const id of ['fafbed19e69d8199ae29ccad','8df2c8f6e0022cbbfa8e25a6','d24fa615fb67ae4957a421ba']){assert.ok(removed.has(id));assert.ok(!active.has(id));}
fs.writeFileSync('china-input-proof.json',JSON.stringify({active:active.size,withdrawals:removed.size,reappeared,completedAt:report.completedAt,checkedAt:new Date().toISOString(),supplierRequests:0,productionWrites:false},null,2));
