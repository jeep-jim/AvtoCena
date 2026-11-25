import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable,PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PHOTO_IMAGE_REUSE,receivePhotoImageStream,verifyRestoredPhotoReceipt,
 photoImageRemoteProgram,retrievePhotoImage,restoreChinaPhotoImage} from '../scripts/catalog-next/restore-photo-image.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const sourceProof=pins=>({kind:'china-photo-image-stream-complete-v1',archiveSha256:pins.archiveSha256,
 sourceUnchanged:true,ingressUnchanged:true,retainedHealthy:true,hostWrites:0});
const builder={version:'29.1.3',driver:'overlayfs',driverType:'io.containerd.snapshotter.v1'};
const archive=Buffer.concat([Buffer.from([0,10,255,20,80,79,84,79,10,0]),Buffer.alloc(246,42)]);
function data(){
 const plan={version:1,market:'china',codeScope:'catalog-photo-japan-power-v1',runtimeSha:'4'.repeat(40),
  runtimeTree:'8'.repeat(40),retainedRuntime:'d'.repeat(40),runtimeDiffSha256:'e'.repeat(64),runtimeFiles:['public-app.ts']};
 const pricingPlan={runtimeSha:'6'.repeat(40),runtimeTree:'2'.repeat(40)};
 const proof={runtimeSha:plan.runtimeSha,runtimeTree:plan.runtimeTree,retainedRuntime:plan.retainedRuntime,
  runtimeDiffSha256:plan.runtimeDiffSha256,runtimeFiles:plan.runtimeFiles,protectedPathsUnchanged:true};
 const compatibility={version:1,kind:'china-serving-pricing-compatibility-v1',runtimeSha:plan.runtimeSha,protectedPricingPathsUnchanged:true};
 const inspection={Id:'sha256:'+'7'.repeat(64),Descriptor:{digest:'sha256:'+'7'.repeat(64)},Os:'linux',Architecture:'amd64',Size:123,
  Config:{Labels:{'org.opencontainers.image.revision':plan.runtimeSha,'org.opencontainers.image.source':'https://github.com/jeep-jim/AvtoCena','avtocena.application':'web'}},
  RootFS:{Type:'layers',Layers:['sha256:'+'3'.repeat(64)]},
  Manifests:[{ID:'sha256:'+'9'.repeat(64),Descriptor:{digest:'sha256:'+'9'.repeat(64)},Kind:'image',Available:true,
   Size:{Content:123,Total:1123},ImageData:{Platform:{os:'linux',architecture:'amd64'},Size:{Unpacked:1000}}}]};
 const receipt={version:1,kind:'china-runtime-image-v1',market:'china',codeScope:plan.codeScope,...proof,
  imageId:inspection.Id,imageUnpackedBytes:inspection.Size,configSha256:hash(JSON.stringify(inspection.Config)),
  rootFsSha256:hash(JSON.stringify(inspection.RootFS)),platform:'linux/amd64',bytes:archive.length,sha256:hash(archive),builder,
  servingCompatibility:compatibility,pricingRuntimeSha:pricingPlan.runtimeSha,pricingRuntimeTree:pricingPlan.runtimeTree,
  archiveRoundTripVerified:true,activationAuthorized:false,hostContacted:false,privateDataIncluded:false};
 const raw=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
 const nonce='c'.repeat(32);
 const pins={...PHOTO_IMAGE_REUSE,...proof,imageId:receipt.imageId,imageUnpackedBytes:receipt.imageUnpackedBytes,
  configSha256:receipt.configSha256,rootFsSha256:receipt.rootFsSha256,archiveBytes:archive.length,archiveSha256:hash(archive),
  receiptBytes:raw.length,receiptSha256:hash(raw),attemptHash:hash(nonce).slice(0,16)};
 return {plan,pricingPlan,proof,compatibility,inspection,receipt,raw,pins,nonce};
}
const frame=(f,body=archive,footer=sourceProof(f.pins))=>Buffer.concat([
 Buffer.from(JSON.stringify({kind:'china-photo-image-stream-v1',archiveBytes:f.pins.archiveBytes,receiptBase64:f.raw.toString('base64')})+'\n'),
 body,Buffer.from('\n'+JSON.stringify(footer)+'\n')]);
async function temporary(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'photo-image-restore-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('the restore source remains the exact first tested4302 image rather than a tag or the later rebuilt image',()=>{
 assert.equal(PHOTO_IMAGE_REUSE.runId,45612015245);assert.equal(PHOTO_IMAGE_REUSE.artifactId,15021264404);
 assert.equal(PHOTO_IMAGE_REUSE.attemptHash,'106d43b93feba748');
 assert.equal(PHOTO_IMAGE_REUSE.receiptSha256,'611048611374e929004ce3849cd929e84b3a786f07f2c343226df83b21d52a38');
 assert.equal(PHOTO_IMAGE_REUSE.archiveSha256,'467f6550705bdae18be74ee5af095ddd45723d00c29a0a9deed6fa730fe2ed00');
 assert.equal(PHOTO_IMAGE_REUSE.imageId,'sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65');
});

test('binary framing preserves exact original receipt and tar across arbitrary chunk boundaries',async t=>{
 const f=data(),dir=await temporary(t),all=frame(f),chunks=[];
 for(let offset=0;offset<all.length;offset+=7)chunks.push(all.subarray(offset,offset+7));
 const out=path.join(dir,'image.tar'),result=await receivePhotoImageStream(Readable.from(chunks),out,f.pins);
 assert.deepEqual(await fs.readFile(out),archive);assert.deepEqual(result.receiptRaw,f.raw);assert.deepEqual(result.sourceProof,sourceProof(f.pins));
 await assert.rejects(receivePhotoImageStream(Readable.from([all]),out,f.pins),{code:'EEXIST'});
});

test('bad receipt, changed/truncated archive, trailing bytes and failed source fence cannot complete a stream',async t=>{
 const f=data(),dir=await temporary(t);
 const variants=[frame({...f,raw:Buffer.from('different')}),frame(f,Buffer.from('changed')),frame(f).subarray(0,-30),
  Buffer.concat([frame(f),Buffer.from('trailing')]),frame(f,archive,{...sourceProof(f.pins),hostWrites:1}),Buffer.alloc(65537,65)];
 for(let index=0;index<variants.length;index++)await assert.rejects(receivePhotoImageStream(Readable.from([variants[index]]),path.join(dir,'bad-'+index),f.pins),/china_image_restore_/);
});

test('a pinned receipt must still bind the freshly verified source, pricing and compatibility',()=>{
 const f=data();assert.deepEqual(verifyRestoredPhotoReceipt(f.raw,f),f.receipt);
 for(const changed of [
  {...f,plan:{...f.plan,runtimeSha:'5'.repeat(40)}},
  {...f,proof:{...f.proof,protectedPathsUnchanged:false}},
  {...f,pricingPlan:{...f.pricingPlan,runtimeSha:'5'.repeat(40)}},
  {...f,compatibility:{...f.compatibility,protectedPricingPathsUnchanged:false}},
 ])assert.throws(()=>verifyRestoredPhotoReceipt(f.raw,changed),/china_image_restore_/);
});

async function fixture(t){
 const f=data(),dir=await temporary(t),socket=path.join(dir,'docker.sock');
 // This local test environment rejects Unix bind with EPERM. Model only this
 // fixture inode's socket type; realpath/symlink/file checks stay real and the
 // production code has no capability to bypass them.
 await fs.writeFile(socket,'isolated fixture socket');
 const realLstat=fs.lstat.bind(fs);
 t.mock.method(fs,'lstat',async(filename,...args)=>{
  const metadata=await realLstat(filename,...args);
  return String(filename)===socket?{isSocket:()=>true}:metadata;
 });
 const calls=[];let loads=0,storageReads=0;
 const options={root:dir,runtimeRoot:dir,plan:f.plan,pricingPlan:f.pricingPlan,runnerTemp:dir,dockerHost:'unix://'+socket,
  privateKey:'never passed to Docker',pins:f.pins,verifyRuntime:async()=>f.proof,verifyCompatibility:async()=>f.compatibility,
  retrieve:async({directory})=>{await fs.writeFile(path.join(directory,'image.tar'),archive,{flag:'wx'});return {receiptRaw:f.raw,sourceProof:sourceProof(f.pins)};},
  readStorageInspection:async()=>{storageReads++;return structuredClone(f.inspection);},
  execute:async(command,args,options)=>{
   assert.equal(command,'/usr/bin/docker');assert.equal(args[0],'--host=unix://'+socket);
   assert.deepEqual(Object.keys(options.env).sort(),['DOCKER_CONFIG','DOCKER_HOST','PATH']);
   const action=args.slice(1);calls.push(action);
   if(action[0]==='info')return Buffer.from(JSON.stringify({ServerVersion:'29.1.3',Driver:'overlayfs',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]}));
   if(action[1]==='ls')return Buffer.from('');
   if(action[1]==='load'){loads++;return Buffer.from('');}
   if(action[1]==='inspect')return Buffer.from(JSON.stringify(f.inspection));
   if(action[1]==='save'){await fs.writeFile(action[3],archive,{flag:'wx'});return Buffer.from('');}
   if(action[1]==='rm')return Buffer.from('');
   assert.fail('unexpected Docker operation');
  }};
 return {...f,dir,calls,options,loads:()=>loads,storageReads:()=>storageReads};
}

test('isolated offline roundtrip keeps original receipt truthful and writes separate restore/storage evidence',async t=>{
 const f=await fixture(t),report=await restoreChinaPhotoImage(f.options),out=path.join(f.dir,'china-release-build');
 assert.equal(report.restored,true);assert.equal(report.hostContacted,true);assert.equal(report.hostWrites,0);assert.equal(report.registryRequests,0);
 assert.deepEqual(await fs.readFile(path.join(out,'image-receipt.json')),f.raw);
 assert.equal(JSON.parse(await fs.readFile(path.join(out,'image-receipt.json'))).hostContacted,false,'historical build proof stays unchanged');
 assert.equal(JSON.parse(await fs.readFile(path.join(out,'image-storage-proof.json'))).unpackedBytes,1000,'actual unpacked size is separate from legacy packed inspection.Size');
 assert.equal(f.loads(),2);assert.equal(f.storageReads(),2);
 assert.equal(f.calls.filter(row=>row[1]==='rm').length,1);
 assert.equal(f.calls.some(row=>['build','pull','push','run','prune'].includes(row[0])||row.includes('--pull')),false);
 assert.equal((await fs.stat(path.join(out,'image.tar'))).mode&0o777,0o400);
 assert.deepEqual((await fs.readdir(out)).sort(),['image-receipt.json','image-restoration-report.json','image-storage-proof.json','image.tar'].sort());
});

test('changed imported identity and failed roundtrip never create a usable receipt',async t=>{
 for(const failAt of [1,3]){
  const f=await fixture(t),real=f.options.execute;let inspections=0;
  f.options.execute=async(command,args,options)=>{
   const raw=await real(command,args,options);
   if(args[2]==='inspect'&&++inspections===failAt){const inspected=JSON.parse(raw);inspected.RootFS.Layers=['sha256:'+'f'.repeat(64)];return Buffer.from(JSON.stringify(inspected));}
   return raw;
  };
  await assert.rejects(restoreChinaPhotoImage(f.options),/china_image_restore_(import_identity|roundtrip_identity)/);
  await assert.rejects(fs.access(path.join(f.dir,'china-release-build/image-receipt.json')),{code:'ENOENT'});
 }
});

test('a final receipt write failure cannot leave a successful restoration report',async t=>{
 const f=await fixture(t),retrieve=f.options.retrieve;
 f.options.retrieve=async options=>{
  const restored=await retrieve(options);
  await fs.mkdir(path.join(options.directory,'image-receipt.json'));
  return restored;
 };
 await assert.rejects(restoreChinaPhotoImage(f.options),/china_image_restore_failed/);
 const report=JSON.parse(await fs.readFile(path.join(f.dir,'china-release-build/image-restoration-report.json')));
 assert.equal(report.restored,false);assert.equal(report.hostContacted,true);assert.equal(report.hostWrites,0);
});

test('changed source, archive or actual storage proof after reload fails closed',async t=>{
 for(const kind of ['source','archive','storage']){
  const f=await fixture(t);
  if(kind==='source'){let count=0;f.options.verifyRuntime=async()=>++count===1?f.proof:{...f.proof,runtimeTree:'0'.repeat(40)};}
  if(kind==='archive'){
   const execute=f.options.execute;f.options.execute=async(command,args,options)=>{
    const raw=await execute(command,args,options);
    if(args[2]==='rm')await fs.appendFile(path.join(f.dir,'china-release-build/image.tar'),'changed');
    return raw;
   };
  }
  if(kind==='storage'){let count=0;f.options.readStorageInspection=async()=>{const inspection=structuredClone(f.inspection);if(++count===2){inspection.Manifests[0].ImageData.Size.Unpacked++;inspection.Manifests[0].Size.Total++;}return inspection;};}
  await assert.rejects(restoreChinaPhotoImage(f.options),/china_image_restore_(source_changed|archive_changed|storage_changed)/);
  await assert.rejects(fs.access(path.join(f.dir,'china-release-build/image-receipt.json')),{code:'ENOENT'});
 }
});

test('early SSH spawn failure is observed and removes only the runner key directory',async t=>{
 const dir=await temporary(t),known=path.join(dir,'docs/operations/regcloud-staging-known-hosts');
 await fs.mkdir(path.dirname(known),{recursive:true});await fs.writeFile(known,'known host');
 const pins={...data().pins,knownHostsSha256:hash('known host')};
 const spawned=[];
 const spawnImpl=(command,args,options)=>{
  spawned.push({command,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.stdout.end();child.emit('close',1);return true;};
  queueMicrotask(()=>{child.emit('error',new Error('private host text must not escape'));child.stdout.end();child.emit('close',1);});return child;
 };
 await assert.rejects(retrievePhotoImage({root:dir,directory:dir,privateKey:'test private key',pins,spawnImpl}),/china_image_restore_/);
 assert.deepEqual(Object.keys(spawned[0].options.env).sort(),['LANG','PATH']);
 assert.equal(spawned[0].args.includes('test private key'),false);
 assert.deepEqual((await fs.readdir(dir)).sort(),['docs']);
});

test('read-only host code rejects accepted, linked, changed and replaced source files',async t=>{
 const dir=await temporary(t),f=data(),base=path.join(dir,'releases'),home=path.join(base,f.pins.runtimeSha,'china-next'),attempt=path.join(home,f.nonce);
 await fs.mkdir(attempt,{recursive:true,mode:0o700});
 for(const parent of [base,path.dirname(home),home,attempt])await fs.chmod(parent,0o700);
 const plan={mode:'code-update',runtimeSha:f.pins.runtimeSha,runtimeTree:f.pins.runtimeTree,controllerSha:f.pins.controllerSha,
  retainedRuntime:f.pins.retainedRuntime,nonce:f.nonce,imageId:f.pins.imageId,
  files:[{name:'image.tar',bytes:archive.length,sha256:f.pins.archiveSha256},{name:'image-receipt.json',bytes:f.raw.length,sha256:f.pins.receiptSha256}]};
 const rollback={kind:'china-host-rollback-v1',nonce:f.nonce,release:f.pins.runtimeSha,imageId:f.pins.imageId,
  candidateRemoved:true,ingressRestored:true,retainedRunning:true,retainedRuntimeSha:f.pins.retainedRuntime};
 const planRaw=JSON.stringify(plan),rollbackRaw=JSON.stringify(rollback);
 f.pins.planSha256=hash(planRaw);f.pins.rollbackSha256=hash(rollbackRaw);
 await fs.writeFile(path.join(attempt,'PLAN.json'),planRaw,{mode:0o600});
 await fs.writeFile(path.join(attempt,'ROLLED_BACK.json'),rollbackRaw,{mode:0o600});
 await fs.writeFile(path.join(attempt,'image-receipt.json'),f.raw,{mode:0o600});
 const image=path.join(attempt,'image.tar');await fs.writeFile(image,archive,{mode:0o600});
 const config=path.join(dir,'ingress'),lock=path.join(dir,'lock');await fs.writeFile(config,'private ingress',{mode:0o600});await fs.writeFile(lock,'',{mode:0o600});
 const program=photoImageRemoteProgram(f.pins)
  .replaceAll('s.st_uid==0','s.st_uid==os.getuid()')
  .replace("ancestors=[Path('/opt'),Path('/opt/avtocena'),BASE,home.parent,home]","ancestors=[BASE,home.parent,home]")
  .replace('try:main()',`BASE=Path(${JSON.stringify(base)})\nCONFIG=Path(${JSON.stringify(config)})\nLOCK=Path(${JSON.stringify(lock)})\nhealth=lambda ingress:None\ntry:main()`);
 const run=code=>spawnSync('/usr/bin/python3',['-I','-B','-c',code||program],{encoding:null,timeout:5000,maxBuffer:1024*1024});
 const ok=run();assert.equal(ok.status,0,ok.stderr.toString());
 const saved=path.join(dir,'received.tar');await receivePhotoImageStream(Readable.from([ok.stdout]),saved,f.pins);assert.deepEqual(await fs.readFile(saved),archive);
 const assertFailed=()=>{const result=run();assert.equal(result.status,1);assert.equal(result.stderr.toString(),'china_image_restore_host_failed\n');};
 await fs.writeFile(path.join(attempt,'ACCEPTED.json'),'{}');assertFailed();await fs.unlink(path.join(attempt,'ACCEPTED.json'));
 await fs.link(image,path.join(dir,'hardlink'));assertFailed();await fs.unlink(path.join(dir,'hardlink'));
 await fs.rename(image,path.join(dir,'saved-image'));await fs.symlink(path.join(dir,'saved-image'),image);assertFailed();await fs.unlink(image);await fs.rename(path.join(dir,'saved-image'),image);
 await fs.appendFile(path.join(attempt,'PLAN.json'),' ');assertFailed();await fs.writeFile(path.join(attempt,'PLAN.json'),planRaw);
 await fs.writeFile(image,Buffer.from('not the image'));assertFailed();await fs.writeFile(image,archive);
 // Simulate a source-file race during stdout delivery, after its prehash. The
 // final fd/path identity fence must withhold the completion footer.
 const race=program.replace('copied+=len(block);digest.update(block);sys.stdout.buffer.write(block)',
  "copied+=len(block);digest.update(block);sys.stdout.buffer.write(block);os.utime(attempt/'image.tar',ns=(1,1))");
 const raced=run(race);assert.equal(raced.status,1);await assert.rejects(receivePhotoImageStream(Readable.from([raced.stdout]),path.join(dir,'raced.tar'),f.pins),/stream_footer/);
 assert.equal(await fs.readFile(config,'utf8'),'private ingress');assert.deepEqual(await fs.readFile(image),archive);
});
