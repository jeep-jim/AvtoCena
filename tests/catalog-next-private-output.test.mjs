import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {savePrivateChinaSource,chinaSourceOutputRoot} from '../scripts/catalog-next/private-source-output.mjs';

const owner={runId:'123456',attempt:'1',revision:'a'.repeat(40)};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'china-source-output-test-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const sourceManifest={version:1,files:[]};
  for(const [name,content] of [['source.sqlite','private vehicle payload'],['dispositions.ndjson','{"privateId":"1"}\n'],
    ['reconciliation.json','{"sourceRows":1,"eligible":1}']]) {
    const bytes=Buffer.from(content);await fs.writeFile(path.join(directory,name),bytes);
    sourceManifest.files.push({name,bytes:bytes.length,sha256:hash(bytes)});
  }
  await fs.writeFile(path.join(directory,'source-manifest.json'),JSON.stringify(sourceManifest));
  const objects=new Map(),writes=[];
  const storage={driver:'object',putBinary:async(key,bytes,_mime,condition)=>{
    assert.deepEqual(condition,{ifNoneMatch:'*'});assert(!objects.has(key));
    assert(key.startsWith(chinaSourceOutputRoot(owner)+'/'));
    writes.push(key);objects.set(key,Buffer.from(bytes));
  },getBinary:async key=>{assert(objects.has(key));return {data:Buffer.from(objects.get(key))};}};
  return {directory,sourceManifest,objects,writes,storage};
}

test('private source is sealed only after every private output has matched its complete readback',async t=>{
  const f=await fixture(t),result=await savePrivateChinaSource({...f,owner});
  assert.equal(result.published,false);assert.equal(result.deletions,0);assert.equal(result.sourceApiCalls,0);
  assert.equal(result.files.length,4);assert(f.writes.at(-1).endsWith('/complete.json'));
  const complete=JSON.parse(f.objects.get(f.writes.at(-1)));
  assert.equal(hash(f.objects.get(f.writes.at(-1))),result.receiptSha256);
  for(const file of complete.files){
    const bytes=Buffer.concat(file.parts.map(part=>f.objects.get(part.key)));
    assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);
  }
});

test('a lost upload response may be accepted only after exact immutable readback',async t=>{
  const f=await fixture(t),put=f.storage.putBinary;
  f.storage.putBinary=async(...args)=>{await put(...args);throw Error('transport response lost');};
  const result=await savePrivateChinaSource({...f,owner});assert.equal(result.files.length,4);
});

test('corrupted stored bytes never get a complete receipt',async t=>{
  const f=await fixture(t);f.storage.getBinary=async()=>({data:Buffer.from('wrong bytes')});
  await assert.rejects(savePrivateChinaSource({...f,owner}),/readback/);
  assert(!f.writes.some(key=>key.endsWith('/complete.json')));
});

test('a modified local source or foreign file cannot be sealed',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.directory,'source.sqlite'),'changed private source');
  await assert.rejects(savePrivateChinaSource({...f,owner}),/source_changed/);
  assert(!f.writes.some(key=>key.endsWith('/complete.json')));
  const g=await fixture(t);await fs.writeFile(path.join(g.directory,'credentials.txt'),'must stay local');
  await assert.rejects(savePrivateChinaSource({...g,owner}),/output_files/);assert.equal(g.writes.length,0);
});

test('source authority loss prevents a complete receipt without touching live data',async t=>{
  const f=await fixture(t);let calls=0;
  await assert.rejects(savePrivateChinaSource({...f,owner,assertCurrent:async()=>{
    if(++calls>2)throw Error('source authority changed');
  }}),/authority changed/);
  assert(!f.writes.some(key=>key.endsWith('/complete.json')));
  assert(f.writes.every(key=>key.startsWith(chinaSourceOutputRoot(owner)+'/')));
});

test('private roots cannot be redirected to another market, traversal path or arbitrary owner',()=>{
  for(const patch of [{runId:'../europe'},{attempt:'0'},{revision:'main'}])
    assert.throws(()=>chinaSourceOutputRoot({...owner,...patch}),/owner/);
});
