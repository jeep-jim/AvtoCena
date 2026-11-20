import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {convertMarketOnDisk} from '../scripts/lib/catalog-disk-conversion.mjs';
import {buildChinaCanonicalFromNative} from '../scripts/lib/china-native-canonical.mjs';

const json=x=>Buffer.from(JSON.stringify(x));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=x=>sha(json(x));
const hex=x=>x.repeat(64);
const write=async(root,file,value)=>{
 const buffer=json(value);
 await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
 await fs.writeFile(path.join(root,file),buffer);
 return {file,path:file,bytes:buffer.length,sha256:sha(buffer)};
};
const stat=async(root,file)=>{
 const b=await fs.readFile(path.join(root,file));
 return {file,bytes:b.length,sha256:sha(b)};
};
async function makeFixture(t,{full=false,incomplete=false,badRow=false}={}){
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'native-cn-canon-'));
 t.after(()=>fs.rm(parent,{recursive:true,force:true}));
 const intake=path.join(parent,'intake'),native=path.join(parent,'converted'),authority=path.join(parent,'authority');
 for(const dir of [intake,native,authority])await fs.mkdir(dir);
 const now=Date.now(),validUntil=now+3_600_000;
 const sourceAt=new Date(now-10_000).toISOString(),observedAt=Date.parse(sourceAt),sourceId=full?'autohome_used_china_open':'che168_feed';
 const snapshot=hex('1'),replica=hex('2'),sourceCursor=13123821;
 const evidence=mark=>({state:mark,sha256:hex('a')});
 const removal=(row,mark)=>({id:row.id,market:'china',make:row.make,model:row.model,removedAt:sourceAt,reason:mark,evidence:evidence(mark)});
 const rows=Array.from({length:507},(_,i)=>{
  const sourceOfferId=String(i+92000),id=sha(sourceId+':'+sourceOfferId).slice(0,24);
  return {id,market:'china',sourceOfferId,sourceId,year:2022,status:'active',make:'BMW',model:'X 3',
   powerKw:272,icePowerKw:272,sourcePrice:i===6?12000:103300+i,sourceCurrency:i===6?'USD':'CNY',
   operational:{semanticEvidence:{powerKw:{status:'exact',value:272,source:'native_fixture'}},
    ...(full?{provider:'auto-api.com',detailIdentityVerified:true,che168ActiveVerification:{method:'snapshot_and_complete_change_stream',
     snapshotBinding:snapshot,cursor:badRow&&i===8?sourceCursor-1:sourceCursor,verifiedAt:sourceAt}}:{})}};
 });
 const names=['catalog-rebuild-china-0001.jsonl','catalog-rebuild-china-0002.jsonl'];
 await fs.writeFile(path.join(intake,names[0]),rows.slice(0,501).map(offer=>JSON.stringify({offer})).join('\n')+'\n');
 await fs.writeFile(path.join(intake,names[1]),[...rows.slice(501),{...rows[5],sourcePrice:111222}].map(offer=>JSON.stringify({offer})).join('\n')+'\n');
 const converted=await convertMarketOnDisk({market:'china',directory:intake,files:names,out:native,report:{sources:[]}});
 assert.equal(converted.uniqueObservations,507);assert.equal(converted.shards,2);
 const archive=await write(authority,'evidence/archive-receipt.json',{fixture:true,sourceAt});
 const rawReport=full?await write(authority,'native-report.json',{version:1,market:'china',provider:'auto_api_che168',productionWrites:false,
  completed:true,completedAt:sourceAt,sources:[{sourceId,provider:'auto_api_che168',completeInventory:!incomplete,stopReason:'source_finished',
   rejectedIdentity:0,uniqueOffers:507,observations:507,cursor:sourceCursor,initialCursor:12360638,snapshotBinding:snapshot,
   replica:{cursor:sourceCursor,binding:snapshot,sha256:replica}}],
  confirmedWithdrawals:[{id:'absent-older-id',market:'china',status:'removed'}]}):null;
 const oracle=await write(authority,'evidence/legacy-oracle.json',{fixture:true,powerKw:272});
 const context=await write(authority,'context/data/runtime.json',{fixture:true});
 const shards=[],dispositions=[];
 for(let i=0;i<2;i++){
  const file='catalog-rebuild-china-000'+(i+1)+'.json';
  const sd=await stat(native,file);shards.push(sd);
  const verified=JSON.parse(await fs.readFile(path.join(native,file),'utf8')).offers.map((row,j)=>{
   const out={id:row.id,inputSha256:hash(row)};
   if(i===0&&j===1)return {...out,state:'excluded',reason:'missing_price'};
   if(i===0&&j===2)return full?{...out,state:'excluded',reason:'public_image_rejected'}:{...out,state:'withdrawn',withdrawal:removal(row,'sold')};
   const canonical=i===0&&j===5?{...row,model:'X3'}:i===0&&j===6?{...row,sourceCurrency:'CNY',sourcePrice:84000,
    chinaPriceConversion:{sourceCurrency:'USD',sourcePrice:row.sourcePrice,sourcePriceCny:84000,usdRub:84,cnyRub:12,rateDate:sourceAt.slice(0,10)}}:undefined;
   return {...out,state:'admitted',canonicalSha256:hash(canonical??row),...(canonical?{canonical}:{})};
  });
  dispositions.push({rows:verified,...await write(authority,'disposition-000'+(i+1)+'.json',verified),nativeSha256:sd.sha256});
 }
 const nativeReceipt={version:1,kind:'china-local-confirmed-input-only',sourceCompletedAt:sourceAt,
  sourceExpiresAt:new Date(validUntil).toISOString(),sourceRows:507,archiveManifestSha256:hex('c'),receiptSha256:archive.sha256,
  reportSha256:rawReport?.sha256??hex('d'),shards,shardsSha256:hash(shards),outputBytes:shards.reduce((n,x)=>n+x.bytes,0),inventoryV2SealIssued:false,priced:false,
  providerRequests:0,publicationAuthorized:false,cursorAdvanceAuthorized:false};
 const nativeSha256=(await write(native,'LOCAL_ADMISSION.json',nativeReceipt)).sha256;
 const verdict={version:2,kind:'china-verified-native-disposition-v2',market:'china',inventoryV2SealIssued:true,
  publicationAuthorized:false,cursorAdvanceAuthorized:false,nativeAdmissionSha256:nativeSha256,nativeShardsSha256:nativeReceipt.shardsSha256,
  archiveManifestSha256:nativeReceipt.archiveManifestSha256,reportSha256:nativeReceipt.reportSha256,inventorySealSha256:hex('1'),
  admissionPolicySha256:hex('2'),source:{observedAt,validUntil,receiptSha256:archive.sha256,
   cursor:{stream:'che168-fixture',sequence:sourceCursor,anchorSha256:full?replica:hex('3')}},
  shards:[],counts:{admitted:505,excluded:1,withdrawnNative:1,withdrawnTotal:2},
  priorWithdrawals:[removal({id:'previous-only',make:'BMW',model:'X3'},'removed')],allowedSourceIds:[sourceId]};
 let replacementSha256,order;
 if(full){
  const continuity=await write(native,'LOCAL_CONTINUITY.json',{version:1,kind:'china-local-conversion-continuity-only',
   nativeAdmissionSha256:nativeSha256,archiveManifestSha256:nativeReceipt.archiveManifestSha256,preparedShardsSha256:nativeReceipt.shardsSha256,
   rows:507,sourceExpiresAt:nativeReceipt.sourceExpiresAt,candidate:{cursor:sourceCursor,replicaSha256:replica},
   publishAuthorized:false,cursorAdvanceAuthorized:false});
  const proof=await write(authority,'FRESH_REPLACEMENT.json',{version:1,kind:'china-complete-source-replacement-v1',
   market:'china',coverage:'materialized-full-active-snapshot',previousServingGeneration:'rollback-only',
   publicationAuthorized:false,cursorAdvanceAuthorized:false,ownerApprovalSha256:hex('a'),continuitySha256:continuity.sha256,
   collectorClosureSha256:hex('b'),nativeAdmissionSha256:nativeSha256,nativeShardsSha256:nativeReceipt.shardsSha256,
   archiveManifestSha256:nativeReceipt.archiveManifestSha256,sourceReceiptSha256:archive.sha256,rawReport,rows:507});
  replacementSha256=proof.sha256;
  const admitted=dispositions.flatMap(d=>d.rows).filter(d=>d.state==='admitted').reverse();
  for(const[i,d]of admitted.entries())d.nativeSelectedOrdinal=i;
  order=admitted.map(d=>d.id);
  const h=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
  for(const id of order)h.update(JSON.stringify(id)+'\n');
  Object.assign(verdict,{version:1,kind:'china-verified-fresh-disposition-v1',inventoryV2SealIssued:false,
   inventorySealSha256:replacementSha256,replacementProofSha256:replacementSha256,
   orderedAdmittedIdsSha256:h.digest('hex'),priorWithdrawals:[],counts:{admitted:505,excluded:2,withdrawnNative:0,withdrawnTotal:0}});
 }
 const fxReceipt={market:'china',pricingAsOf:new Date(now-1000).toISOString()};
 const env={version:1,kind:'china-offline-shadow-inputs-v1',dispositionSha256:'replace',inventorySealSha256:verdict.inventorySealSha256,
  generationId:'gen_'+now+'_fixture',pricingFingerprint:hex('4'),calculationVersion:hex('5'),
  fx:{receipt:fxReceipt,receiptSha256:hash(fxReceipt)},modelScope:{make:'BMW',model:'X3'},blockRows:50,runtimeFiles:[context],
  evidence:{archive,oracle}};
 async function pins(){
  for(const part of dispositions){
   const {rows,file}=part;Object.assign(part,await write(authority,file,rows));
  }
  verdict.shards=dispositions.map(({rows,path:_,...part})=>part);
  const dispositionSha256=(await write(authority,'VERIFIED_DISPOSITION.json',verdict)).sha256;
  env.dispositionSha256=dispositionSha256;
  const inputsSha256=(await write(authority,'SHADOW_INPUTS.json',env)).sha256;
  return {nativeRoot:native,authorityRoot:authority,out:path.join(parent,'avtocena-china-canonical-test'),
   nativeSha256,dispositionSha256,inputsSha256,...(full?{replacementSha256}:{})};
 }
 return {rows,dispositions,verdict,pins,order};
}
test('native SQLite conversion → exact disposition → actual archive-shadow preflight; 272 kW and removal vs missing price survive',async t=>{
 const f=await makeFixture(t),args=await f.pins();
 const pkg=await buildChinaCanonicalFromNative(args);
 assert.deepEqual([pkg.sourceRows,pkg.admitted,pkg.excluded,pkg.withdrawnNative,pkg.withdrawnPrior,pkg.chunks,pkg.blocks],[507,505,1,1,1,2,11]);
 const out=JSON.parse(await fs.readFile(path.join(args.out,'shadow-package.json'),'utf8'));
 const rows=JSON.parse(await fs.readFile(path.join(args.out,'canonical/chunk-0001.json'),'utf8'));
 assert.equal(rows.length,500);assert.equal(out.chunks[1].rows,5);
 assert.ok(!rows.some(row=>[f.rows[1].id,f.rows[2].id].includes(row.id)));
 assert.deepEqual(out.withdrawn.map(x=>[x.id,x.reason]),[['previous-only','removed'],[f.rows[2].id,'sold']]);
 assert.deepEqual(pkg.exclusions,{missing_price:1});
 const exact=rows.find(x=>x.id===f.rows[5].id);
 assert.equal(exact.powerKw,272);assert.equal(exact.icePowerKw,272);
 assert.equal(rows.find(x=>x.id===f.rows[6].id).chinaPriceConversion.sourcePrice,12000);
 assert.equal(exact.operational.semanticEvidence.powerKw.value,272);assert.equal(exact.sourcePrice,111222);assert.equal(exact.model,'X3');
 const command=await promisify(execFile)(process.execPath,['--import','tsx','--import','./tests/helpers/offline-fetch.mjs',
  'scripts/catalog-china-archive-shadow.mjs','preflight','--archive',args.out,'--expect-sha',pkg.expectSha256]);
 assert.equal(JSON.parse(command.stdout).status,'canonical_input_verified_only');
 assert.equal(JSON.parse(command.stdout).rows,505);
 assert.equal(JSON.parse(command.stdout).blocks,11);
 await assert.rejects(buildChinaCanonicalFromNative(args),{code:'EEXIST'});
});
test('no V2 verdict, incomplete dispositions, rewritten original kW and mutated native bytes fail closed',async t=>{
 const f=await makeFixture(t),args=await f.pins();
 await assert.rejects(buildChinaCanonicalFromNative({...args,dispositionSha256:''}),/external_pin_required/);
 f.verdict.inventoryV2SealIssued=false;
 await assert.rejects(buildChinaCanonicalFromNative(await f.pins()),/verified_v2_disposition_required/);
 f.verdict.inventoryV2SealIssued=true;
 const first=f.dispositions[0].rows,original=first[3];
 first[3]={...original,state:'missing'};
 await assert.rejects(buildChinaCanonicalFromNative(await f.pins()),/missing_disposition/);
 first[3]=original;
 const current=first[5],wrong={...current.canonical,powerKw:90};
 first[5]={...current,canonical:wrong,canonicalSha256:hash(wrong)};
 await assert.rejects(buildChinaCanonicalFromNative(await f.pins()),/native_kw_changed/);
 first[5]=current;
 const usd=first[6],noAnchor={...usd.canonical};delete noAnchor.chinaPriceConversion;
 first[6]={...usd,canonical:noAnchor,canonicalSha256:hash(noAnchor)};
 await assert.rejects(buildChinaCanonicalFromNative(await f.pins()),/china_price_anchor_required/);
 first[6]=usd;
 const options=await f.pins(),file=path.join(options.nativeRoot,'catalog-rebuild-china-0002.json');
 await fs.appendFile(file,' ');
 await assert.rejects(buildChinaCanonicalFromNative(options),/file_size/);
 assert.equal(await fs.stat(options.out).then(()=>true,e=>{assert.equal(e.code,'ENOENT');return false;}),false);
});

test('complete materialized fresh source alone can replace serving: exact selected order, no old rows or implied sales',async t=>{
 const f=await makeFixture(t,{full:true}),args=await f.pins();
 const pkg=await buildChinaCanonicalFromNative(args);
 assert.deepEqual([pkg.sourceRows,pkg.admitted,pkg.excluded,pkg.withdrawnTotal],[507,505,2,0]);
 const spec=JSON.parse(await fs.readFile(path.join(args.out,'shadow-package.json'),'utf8'));
 assert.equal(spec.conversion.mode,'complete-fresh-replacement');
 assert.equal(spec.conversion.previousServingGeneration,'rollback-only');
 assert.deepEqual(spec.withdrawn,[]);
 const loaded=(await Promise.all(spec.chunks.map(async d=>JSON.parse(await fs.readFile(path.join(args.out,d.path),'utf8'))))).flat();
 assert.deepEqual(loaded.map(x=>x.id),f.order);
 assert.equal(loaded.find(x=>x.id===f.rows[5].id).powerKw,272);
 assert.ok(!(await fs.readdir(args.out)).includes('.ordered-canonical.sqlite'));
 const cmd=await promisify(execFile)(process.execPath,['--import','tsx','--import','./tests/helpers/offline-fetch.mjs',
  'scripts/catalog-china-archive-shadow.mjs','preflight','--archive',args.out,'--expect-sha',pkg.expectSha256]);
 assert.equal(JSON.parse(cmd.stdout).rows,505);
});
test('incremental-only report, row from a different cursor, and old withdrawals cannot qualify as full replacement',async t=>{
 const incremental=await makeFixture(t,{full:true,incomplete:true});
 await assert.rejects(buildChinaCanonicalFromNative(await incremental.pins()),/full_snapshot_report_not_complete/);
 const bad=await makeFixture(t,{full:true,badRow:true});
 await assert.rejects(buildChinaCanonicalFromNative(await bad.pins()),/full_snapshot_row_verification/);
 const noProof=await makeFixture(t,{full:true}),args=await noProof.pins();
 await assert.rejects(buildChinaCanonicalFromNative({...args,replacementSha256:undefined}),/fresh_replacement_pin/);
 noProof.verdict.priorWithdrawals=[{id:'old-not-evidence'}];
 await assert.rejects(buildChinaCanonicalFromNative(await noProof.pins()),/fresh_replacement_pin/);
 assert.equal(await fs.stat(args.out).then(()=>true,e=>{assert.equal(e.code,'ENOENT');return false;}),false);
});
