import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {stableOfferId} from '../apps/web/lib/catalog/storage';
import {snapshotBinding} from '../scripts/lib/che168-snapshot.mjs';
import {auditChe168BulkSnapshot,createChe168BulkAuditState,che168BulkAuditGate,che168BulkAuditReadOnlyStorage} from '../scripts/lib/che168-bulk-audit.mjs';

const sourceId='autohome_used_china_open',at='2026-10-09T08:09:40.000Z';
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rawSha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const row=(id:string,changes:Record<string,unknown>={})=>({inner_id:id,data:{inner_id:id,url:`https://www.che168.com/dealer/1/${id}.html`,mark:'Toyota',model:'Corolla',year:'2022',price:'90000',images:[],extra:{},...changes}});
const offer=(id:string,event:number)=>({kind:'offer',event,at,offer:{sourceOfferId:id,sourceId,market:'china',id:stableOfferId(sourceId,id),operational:{provider:'auto-api.com',detailIdentityVerified:true}}});
const price=(id:string,event:number)=>({kind:'price',event,at,innerId:id,price:123});
const removed=(id:string,event:number)=>({kind:'removed',event,at,innerId:id});
const quarantined=(id:string,event:number,reason='missing_model')=>({kind:'quarantine',event,at,innerId:id,reason});

test('audit reproduces CSV quarantine, recovery, price/removal and the importer event comparison order',async()=>{
  const state=createChe168BulkAuditState(20);
  state.addCsvRow(row('1'));
  state.addCsvRow(row('2',{model:'',complectation:'Corolla 1.8',configuration:'1.8',specid:'123',extra:{configuration:{specid:123}}}));
  state.addCsvRow(row('3',{year:'',first_registration:'2023-04'}));
  assert.deepEqual(state.csv.reasons,{missing_model:1,invalid_year:1});
  assert.equal(state.summary().active,1);assert.equal(state.summary().quarantined,2);
  assert.equal(state.csv.quarantineFields.missing_model.withComplectation,1);
  await state.applyJournalEvent(offer('2',20));
  await state.applyJournalEvent(price('1',21));
  await state.applyJournalEvent(removed('1',22));
  await state.applyJournalEvent(quarantined('2',23,'invalid_year'));
  await state.applyJournalEvent(offer('2',24));
  await state.applyJournalEvent(removed('3',25));
  assert.equal(state.summary().active,1);assert.equal(state.summary().quarantined,0);
  // SQL retains the newer active row, while the separate Map still quarantines
  // the ID. An older offer then clears that Map without replacing the event.
  await state.applyJournalEvent(quarantined('2',23));
  assert.equal(state.summary().active,1);assert.equal(state.summary().quarantined,1);
  await state.applyJournalEvent(offer('2',22));
  await state.applyJournalEvent(removed('2',23));
  assert.equal(state.summary().active,1);assert.equal(state.summary().quarantined,0);
  await assert.rejects(()=>state.applyJournalEvent(price('99',26)),/invalid_price/);
  await assert.rejects(()=>state.applyJournalEvent({...offer('2',26),offer:{...offer('2',26).offer,id:'forged'}}),/invalid_event/);
  assert.throws(()=>state.addCsvRow(row('4',{price:''})),/identity_review_required/);
});

test('quarantine gate preserves the exact absolute, percentage and small-count boundaries',()=>{
  assert.equal(che168BulkAuditGate(2189,11).quarantineGatePassed,true);
  assert.equal(che168BulkAuditGate(2188,11).quarantineGatePassed,false);
  assert.equal(che168BulkAuditGate(1,10).quarantineGatePassed,true);
  assert.equal(che168BulkAuditGate(200000,1000).quarantineGatePassed,true);
  const absolute=che168BulkAuditGate(1000000,1001);
  assert.equal(absolute.absoluteLimitExceeded,true);assert.equal(absolute.shareLimitExceeded,false);
  assert.equal(absolute.quarantineGatePassed,false);assert.equal(che168BulkAuditGate(0,0).emptyInventory,true);
});

function fixture(){
  const rows=[row('1'),row('2',{model:''}),row('3',{year:''}),row('4',{year:'2010'})];
  const fields=['inner_id','url','mark','model','year','price','images','extra'];
  const quote=(value:unknown)=>'"'+String(typeof value==='object'?JSON.stringify(value):value).replaceAll('"','""')+'"';
  const bytes=Buffer.from(fields.join('|')+'\n'+rows.map(r=>fields.map(f=>quote((r.data as any)[f])).join('|')).join('\n')+'\n');
  const config={version:1,date:'2026-10-09',filename:'active_offer.csv',host:'https://autobase-barrett.auto-api.com',initialCursor:20,bytes:bytes.length,etag:'"fixture"',modifiedAt:at,delimiter:'|'};
  const binding=snapshotBinding(config),snapshotPrefix=`catalog/provider-snapshots/che168/${binding}`;
  const journalBinding=sha({binding,initialCursor:20,base:null});
  const artifactRunId=BigInt(`0x${journalBinding.slice(0,14)}`).toString();
  const journalPrefix=`catalog/intake-working/che168-v1/${artifactRunId}`;
  const chunkId='11111111-1111-4111-8111-111111111111';
  const chunk={binding:journalBinding,from:20,to:23,changes:3,events:[offer('2',20),price('1',21),removed('1',22)]};
  const head={version:1,binding:journalBinding,initialCursor:20,cursor:23,changes:3,
    bytes:Buffer.byteLength(JSON.stringify(chunk)),chunks:[{id:chunkId,sha:sha(chunk)}]};
  const objects=new Map<string,any>([
    [`${snapshotPrefix}/manifest.json`,{version:1,binding,config,complete:true,parts:[{index:0,bytes:bytes.length,sha256:rawSha(bytes)}]}],
    [`${journalPrefix}/${chunkId}.json`,chunk],
    ['catalog/manifest.json',{version:2,generationId:'still-live',updatedAt:at,markets:{china:{count:123,updatedAt:at}}}],
    ['catalog/intake-cursors/v1/china.json',{version:1,market:'china',generationId:'previous',updatedAt:at,sources:[{sourceId,provider:'auto_api_che168',cursor:18}]}],
  ]);
  let headReads=0,binaryReads=0,writes=0;
  const storage={
    async readJson(key:string,fallback:unknown){return structuredClone(objects.get(key)??fallback);},
    async readJsonWithMeta(key:string){assert.equal(key,`${journalPrefix}/head.json`);headReads++;return {found:true,etag:'"frozen"',value:structuredClone(head)};},
    async getBinary(key:string){assert.equal(key,`${snapshotPrefix}/00000.csv.gz`);binaryReads++;return {data:gzipSync(bytes)};},
    async writeJson(){writes++;throw Error('must_never_write');},
    async putBinary(){writes++;throw Error('must_never_write');},
  };
  return {config,binding,storage,objects,head,chunkKey:`${journalPrefix}/${chunkId}.json`,counts:()=>({headReads,binaryReads,writes})};
}

test('full archived CSV and pinned verified journal produce aggregate-only results with zero writes',async()=>{
  const f=fixture();
  const report=await auditChe168BulkSnapshot({config:f.config,storage:f.storage,yearFrom:2020,expectedCursor:23,expectedChanges:3});
  assert.equal(report.csv.totalRows,4);assert.equal(report.csv.selectedRows,3);
  assert.equal(report.csv.validRows,1);assert.equal(report.csv.quarantinedRows,2);
  assert.equal(report.csv.afterCsv.active,1);assert.equal(report.csv.afterCsv.quarantined,2);
  assert.equal(report.finalInventory.active,1);assert.equal(report.finalInventory.quarantined,1);
  assert.deepEqual(report.finalInventory.reasons,{missing_model:0,invalid_year:1});
  assert.equal(report.journal.cursor,23);assert.equal(report.journal.changes,3);assert.equal(report.journal.chainVerified,true);
  assert.equal(report.actualCatalog.chinaCount,123);assert.equal(report.publishedIntake.cursor,18);
  assert.equal(report.publishedIntake.hasReplica,false);assert.equal(report.baseline,'failed_first_bootstrap');
  assert.deepEqual(f.counts(),{headReads:1,binaryReads:1,writes:0});
  const output=JSON.stringify(report);
  for(const privateField of ['innerId','sourceOfferId','che168.com','Toyota','Corolla','seller','images','source_finished'])assert.equal(output.includes(privateField),false,privateField);
  const facade=che168BulkAuditReadOnlyStorage(f.storage);
  assert.equal(Object.hasOwn(facade,'putBinary'),false);
  await assert.rejects(()=>facade.writeJson(),/write_forbidden/);
  assert.equal(f.counts().writes,0);
});

test('an already-published snapshot, a different head or corrupt journal never silently audits another state',async()=>{
  const published=fixture();
  published.objects.set('catalog/intake-cursors/v1/china.json',{sources:[{sourceId,snapshotBinding:published.binding,replica:{}}]});
  await assert.rejects(()=>auditChe168BulkSnapshot({config:published.config,storage:published.storage,yearFrom:2020,expectedCursor:23,expectedChanges:3}),/already_published/);
  assert.deepEqual(published.counts(),{headReads:0,binaryReads:0,writes:0});
  const moved=fixture();moved.head.cursor=24;
  await assert.rejects(()=>auditChe168BulkSnapshot({config:moved.config,storage:moved.storage,yearFrom:2020,expectedCursor:23,expectedChanges:3}),/unexpected_journal_cursor/);
  assert.equal(moved.counts().binaryReads,0);
  const corrupt=fixture();corrupt.objects.get(corrupt.chunkKey).events[0].event=999;
  await assert.rejects(()=>auditChe168BulkSnapshot({config:corrupt.config,storage:corrupt.storage,yearFrom:2020,expectedCursor:23,expectedChanges:3}),/invalid_replay_checkpoint/);
  assert.equal(corrupt.counts().writes,0);
});


test('year diagnosis reports bounded numeric classes without arbitrary provider text',()=>{
  const state=createChe168BulkAuditState(20);
  state.addCsvRow(row('1',{year:'0'}));
  state.addCsvRow(row('2',{year:'0000'}));
  state.addCsvRow(row('3',{year:'private-provider-text'}));
  state.addCsvRow(row('4',{year:''}));
  assert.deepEqual(state.csv.quarantineFields.invalid_year.valueClasses,{'0':1,'0000':1,other_format:1,empty:1});
  assert.equal(JSON.stringify(state.csv).includes('private-provider-text'),false);
  assert.equal(state.summary().active,0);
  assert.equal(state.summary().quarantined,4);
});
