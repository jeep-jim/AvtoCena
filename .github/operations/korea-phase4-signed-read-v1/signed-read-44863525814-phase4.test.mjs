import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collect} from './signed-read-44863525814-phase4.mjs';
const metadata=Buffer.from('fixture-verified-phase4-metadata');
const p={receiptSha256:createHash('sha256').update(metadata).digest('hex'),nextPage:1584};
test('bounded reads only and no raw output',async()=>{
 const gets=[],heads=[];
 const r=await collect({readExact:async(k,cap)=>{gets.push([k,cap]);return k.endsWith('phase4-receipt.json')?metadata:Buffer.from('private fixture body');},
 headExact:async k=>{heads.push(k);return false;},verify:data=>{assert.equal(data.length,4);return p;}});
 assert.equal(gets.length,5);assert.equal(heads.length,3);
 assert.equal(r.providerCalls,0);assert.equal(r.objectWrites,0);assert.equal(r.predecessor.nextPage,1584);
 assert.ok(!JSON.stringify(r).includes('private fixture body'));
});
test('newer attempt and existing owner claim refuse evidence',async()=>{
 for(const orphan of [true,false]){
  let reads=0;
  await assert.rejects(collect({readExact:async()=>{reads++;return metadata;},headExact:async k=>orphan?k.endsWith('attempt-1585.json'):k.includes('continuation-claims'),
    verify:()=>p}),orphan?/following_attempt/:/existing_claim/);
  assert.equal(reads,orphan?0:4);
 }
});
test('second receipt read mismatch fails without success fragment',async()=>{
 let n=0;
 await assert.rejects(collect({headExact:async()=>false,verify:()=>p,
  readExact:async k=>k.endsWith('phase4-receipt.json')&&n++===1?Buffer.from('drift'):metadata}),/receipt_check_failed/);
});
