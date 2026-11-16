import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {StorageConflictError} from '../apps/web/lib/data';
import {rawDigest,intakeRawReferences} from '../scripts/lib/catalog-raw-provenance.mjs';
import {archiveIntakeDirectory,verifyIntakeArchive,attachIntakeArchiveReceipt,INTAKE_ARCHIVE_RECEIPT} from '../scripts/lib/nonjp-intake-archive.mjs';
import {forkArchivedIntakeForRecovery,retainRecoveryArchive} from '../scripts/lib/nonjp-intake-recovery-fork.mjs';
import {publishedIntakeCheckpoint} from '../scripts/lib/catalog-intake-checkpoint.mjs';

const owner={runId:'123456',attempt:'1',revision:'a'.repeat(40)};
function storageFixture() {
  const objects=new Map<string,any>(), versions=new Map<string,number>(),writes:string[]=[];
  const storage={driver:'object',readJson:async(key:string,fallback:any)=>structuredClone(objects.has(key)?objects.get(key):fallback),
    listBucketObjects:async()=>[...objects].map(([key,value])=>({key,size:Buffer.byteLength(JSON.stringify(value))})),
    readJsonWithMeta:async(key:string,fallback:any)=>({found:objects.has(key),value:structuredClone(objects.has(key)?objects.get(key):fallback),
      etag:objects.has(key)?String(versions.get(key)):undefined}),
    writeJson:async(key:string,value:any,condition:any)=>{
      if (condition?.ifNoneMatch==='*'&&objects.has(key)||condition?.ifMatch&&condition.ifMatch!==String(versions.get(key))) throw new StorageConflictError();
      objects.set(key,structuredClone(value));versions.set(key,(versions.get(key)||0)+1);writes.push(key);
    }};
  return {storage,objects,writes};
}
async function directory(market='uae',partial=false) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nonjp-archive-test-')),input=path.join(root,'input');
  await fs.mkdir(input);
  await fs.writeFile(path.join(input,'report.json'),JSON.stringify({version:1,market,completed:!partial,completedAt:'2026-11-16T12:00:00Z',
    qualityStatus:partial?'partial':'configured_routes_finished',sources:[]}));
  const data=JSON.stringify({offer:{id:'sample',market,sourcePrice:12345,sourceCurrency:'AED',images:['https://images.example/car.jpg'],unknown:null}})+'\n';
  await fs.writeFile(path.join(input,'source-000001.jsonl'),data);
  return {root,input,data};
}

test('legacy repair forks an archived input, preserves original bytes, and carries the old archive into new provenance and cursor',async()=>{
  const f=storageFixture(),d=await directory('china'),nextOwner={...owner,attempt:'2'};
  try {
    const original=await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'china',owner});
    const originalReport=await fs.readFile(path.join(d.input,'report.json'),'utf8');
    let claimed=[];
    const fork=await forkArchivedIntakeForRecovery({storage:f.storage,directory:d.input,market:'china',owner:nextOwner,
      temporaryRoot:d.root,beforeRead:async refs=>{claimed=refs;}});
    assert.notEqual(fork.directory,d.input);
    assert.ok(claimed.some(ref=>ref.root===original.root&&ref.sha256===original.manifestSha256));
    assert.equal(await fs.readFile(path.join(fork.directory,'report.json'),'utf8'),originalReport,'journal input fingerprint remains identical');
    await assert.rejects(fs.stat(path.join(fork.directory,INTAKE_ARCHIVE_RECEIPT)),{code:'ENOENT'});
    let report=retainRecoveryArchive(JSON.parse(originalReport),fork.archivedInput);
    await fs.writeFile(path.join(fork.directory,'report.json'),JSON.stringify(report));
    await fs.appendFile(path.join(fork.directory,'source-000001.jsonl'),'{}\n');
    const replacement=await archiveIntakeDirectory({storage:f.storage,directory:fork.directory,market:'china',owner:nextOwner});
    report=attachIntakeArchiveReceipt(report,replacement);
    assert.deepEqual(intakeRawReferences(report).references.map(row=>row.root).sort(),[original.root,replacement.root].sort());
    const checkpoint=publishedIntakeCheckpoint(report,{market:'china',published:true,generationId:'gen_123_abcd'});
    assert.equal(checkpoint.rawArchiveDependencies[0].root,original.root);
    assert.equal(await fs.readFile(path.join(d.input,'source-000001.jsonl'),'utf8'),d.data);
    assert.equal(await fs.readFile(path.join(d.input,'report.json'),'utf8'),originalReport);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(d.input,INTAKE_ARCHIVE_RECEIPT),'utf8')),original);
    await verifyIntakeArchive({storage:f.storage,receipt:original});
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});

test('recovery refuses a changed local archive or absent protection callback before producing any fork',async()=>{
  const f=storageFixture(),d=await directory('china');
  try {
    await archiveIntakeDirectory({storage:f.storage,directory:d.input,market:'china',owner});
    const args={storage:f.storage,directory:d.input,market:'china',owner,temporaryRoot:d.root};
    await assert.rejects(forkArchivedIntakeForRecovery(args),/claim_required/);
    await fs.appendFile(path.join(d.input,'source-000001.jsonl'),'{}\n');
    await assert.rejects(forkArchivedIntakeForRecovery({...args,beforeRead:async()=>{}}),/source_changed/);
    assert.deepEqual(await fs.readdir(d.root),['input']);
  } finally {await fs.rm(d.root,{recursive:true,force:true});}
});
