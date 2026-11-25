import fs from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executeImageCommand,verifyChinaImageRuntime,verifyChinaImageBuilder,verifyChinaImageInspection,
 readChinaImageStorageInspection,createChinaImageStorageProof} from './build-release-image.mjs';
import {verifyServingCompatibility} from './serving-compatibility.mjs';
import {verifyChinaCodeInvocation} from './code-entry.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const need=(value,code)=>{if(!value)throw Error('china_image_restore_'+code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";

// Original build proof: run45612015245, artifact15021264404. No workflow
// input, environment variable, filename or tag can choose a different image.
export const PHOTO_IMAGE_REUSE=Object.freeze({
 runId:45612015245,artifactId:15021264404,
 runtimeSha:'4302f59a0312f35a64fc3cb9c5b25f9463fa9294',
 runtimeTree:'8dc46bbe570c7dfb36e3d953b8e4546f6b255b60',
 retainedRuntime:'d536c1547c4d82a339ed68ced7d8503f09b6810b',
 controllerSha:'118ce5777e3be3a18f99c902db20202f8476d51a',
 attemptHash:'106d43b93feba748',
 planSha256:'05e398d98be77b082d713da7a0984ecfce11733f9b7b7179da87f5206a8b5534',
 rollbackSha256:'a02ed4f8222995a7b9accf7f51b7959a04960d157f12042af6b9a11e0d514068',
 receiptBytes:5754,receiptSha256:'611048611374e929004ce3849cd929e84b3a786f07f2c343226df83b21d52a38',
 archiveBytes:258523648,archiveSha256:'467f6550705bdae18be74ee5af095ddd45723d00c29a0a9deed6fa730fe2ed00',
 imageId:'sha256:7b400c45db84145dd591043af255d7bbf41583189eda91fbe268b64b3d427e65',
 imageUnpackedBytes:258506545,
 configSha256:'813663916283972970a3493a66c4db54978901326aef1679eac4d7160c1fc6c2',
 rootFsSha256:'c9970b91571ae602c80206dcb5b65a7052e34291fa221ced576fd53e6ab75c15',
 calculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',
 knownHostsSha256:'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c',
});

export function photoImageRemoteProgram(pins=PHOTO_IMAGE_REUSE){
 return `import json\nP=json.loads(${JSON.stringify(JSON.stringify(pins))})\n`+String.raw`
import base64,fcntl,hashlib,http.client,json,os,re,signal,stat,sys
from pathlib import Path
BASE=Path('/opt/avtocena/releases')
CONFIG=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
LOCK=Path('/run/lock/avtocena-runtime-change.lock')
def need(v,reason):
 if not v:raise RuntimeError(reason)
def ident(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def directory(p):
 s=p.lstat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022 and p.resolve()==p,'directory');return ident(s)
def regular(s):need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022,'regular')
def health(ingress):
 found=re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$',ingress)
 need(len(found)==1 and 3000<=int(found[0])<4000,'ingress')
 con=http.client.HTTPConnection('127.0.0.1',int(found[0]),timeout=10)
 try:
  con.request('GET','/api/health',headers={'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
  response=con.getresponse();raw=response.read(65537)
  need(response.status==200 and len(raw)<=65536,'health_size')
  value=json.loads(raw)
  need(value.get('ok') is True and value.get('releaseSha')==P['retainedRuntime'] and value.get('calculationVersion')==P['calculationVersion'],'health')
 finally:con.close()
def main():
 signal.alarm(300)
 lock=os.open(LOCK,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);regular(os.fstat(lock))
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 handles=[]
 try:
  home=BASE/P['runtimeSha']/'china-next'
  ancestors=[Path('/opt'),Path('/opt/avtocena'),BASE,home.parent,home]
  saved_dirs={p:directory(p) for p in ancestors}
  choices=[p for p in home.iterdir() if re.fullmatch(r'[a-f0-9]{32}',p.name)]
  need(len(choices)<=64,'attempt_count')
  choices=[p for p in choices if hashlib.sha256(p.name.encode()).hexdigest()[:16]==P['attemptHash']]
  need(len(choices)==1,'attempt');attempt=choices[0];saved_dirs[attempt]=directory(attempt)
  folder=os.open(attempt,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC);handles.append(folder)
  files={}
  def open_file(name,maximum):
   fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=folder);handles.append(fd)
   s=os.fstat(fd);regular(s);need(s.st_size<=maximum,'size');files[name]=(fd,ident(s));return fd
  def read_proof(name,maximum=262144):
   fd=open_file(name,maximum);raw=os.read(fd,maximum+1);need(len(raw)==files[name][1][6],'proof_size');return raw
  plan_raw=read_proof('PLAN.json');rollback_raw=read_proof('ROLLED_BACK.json');receipt_raw=read_proof('image-receipt.json',P['receiptBytes'])
  need(hashlib.sha256(plan_raw).hexdigest()==P['planSha256'] and hashlib.sha256(rollback_raw).hexdigest()==P['rollbackSha256'],'proof_hash')
  need(len(receipt_raw)==P['receiptBytes'] and hashlib.sha256(receipt_raw).hexdigest()==P['receiptSha256'],'receipt_hash')
  plan=json.loads(plan_raw);rollback=json.loads(rollback_raw)
  need(plan.get('mode')=='code-update' and plan.get('runtimeSha')==P['runtimeSha'] and plan.get('runtimeTree')==P['runtimeTree'] and plan.get('controllerSha')==P['controllerSha'] and plan.get('retainedRuntime')==P['retainedRuntime'] and plan.get('nonce')==attempt.name and plan.get('imageId')==P['imageId'],'plan')
  bindings={'nonce':'nonce','release':'runtimeSha','pricingRuntimeSha':'pricingRuntimeSha','imageId':'imageId','generationId':'generationId','generationManifestSha256':'generationManifestSha256','privateGenerationReceiptSha256':'privateGenerationReceiptSha256','sourceDescriptorSha256':'sourceDescriptorSha256'}
  need(rollback.get('kind')=='china-host-rollback-v1' and all(rollback.get(left)==plan.get(right) for left,right in bindings.items()) and rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True and rollback.get('retainedRunning') is True and rollback.get('retainedRuntimeSha')==P['retainedRuntime'],'rollback')
  descriptors={r.get('name'):r for r in plan.get('files',[]) if isinstance(r,dict)}
  for name,size,digest in [('image.tar',P['archiveBytes'],P['archiveSha256']),('image-receipt.json',P['receiptBytes'],P['receiptSha256'])]:
   need(descriptors.get(name,{}).get('bytes')==size and descriptors.get(name,{}).get('sha256')==digest,'descriptor')
  image=open_file('image.tar',P['archiveBytes']);need(os.fstat(image).st_size==P['archiveBytes'],'archive_size')
  config_fd=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);handles.append(config_fd)
  config_stat=os.fstat(config_fd);regular(config_stat);need(config_stat.st_size<=1048576,'config_size')
  ingress=os.read(config_fd,1048577);need(len(ingress)==config_stat.st_size,'config_read')
  def fence():
   need(all(directory(p)==identity for p,identity in saved_dirs.items()),'directory_changed')
   for name,(fd,identity) in files.items():
    need(ident(os.fstat(fd))==identity and ident(os.stat(name,dir_fd=folder,follow_symlinks=False))==identity,'file_changed')
   for name in ['ACCEPTED.json','ACCEPTED.pending']:
    try:os.stat(name,dir_fd=folder,follow_symlinks=False)
    except FileNotFoundError:pass
    else:raise RuntimeError('accepted')
   need(ident(CONFIG.lstat())==ident(config_stat) and CONFIG.read_bytes()==ingress,'ingress_changed')
   health(ingress)
  fence();digest=hashlib.sha256()
  while True:
   block=os.read(image,1024*1024)
   if not block:break
   digest.update(block)
  need(digest.hexdigest()==P['archiveSha256'],'archive_hash');os.lseek(image,0,os.SEEK_SET);fence()
  header={'kind':'china-photo-image-stream-v1','archiveBytes':P['archiveBytes'],'receiptBase64':base64.b64encode(receipt_raw).decode()}
  sys.stdout.buffer.write(json.dumps(header,separators=(',',':')).encode()+b'\n');sys.stdout.buffer.flush()
  copied=0;digest=hashlib.sha256()
  while copied<P['archiveBytes']:
   block=os.read(image,min(1024*1024,P['archiveBytes']-copied));need(block,'archive_truncated')
   copied+=len(block);digest.update(block);sys.stdout.buffer.write(block)
  sys.stdout.buffer.flush();need(copied==P['archiveBytes'] and digest.hexdigest()==P['archiveSha256'],'stream_hash');fence()
  footer={'kind':'china-photo-image-stream-complete-v1','archiveSha256':digest.hexdigest(),'sourceUnchanged':True,'ingressUnchanged':True,'retainedHealthy':True,'hostWrites':0}
  sys.stdout.buffer.write(b'\n'+json.dumps(footer,separators=(',',':')).encode()+b'\n');sys.stdout.buffer.flush()
 finally:
  for fd in reversed(handles):os.close(fd)
  os.close(lock)
try:main()
except BaseException:
 sys.stderr.write('china_image_restore_host_failed\n');sys.exit(1)
`;
}

export async function receivePhotoImageStream(stream,filename,pins=PHOTO_IMAGE_REUSE){
 let header=Buffer.alloc(0),footer=Buffer.alloc(0),receiptRaw,output,remaining=pins.archiveBytes;
 const digest=createHash('sha256');
 try{
  for await(const raw of stream){
   let chunk=Buffer.from(raw);
   if(!receiptRaw){
    const end=chunk.indexOf(10);
    if(end<0){header=Buffer.concat([header,chunk]);need(header.length<=65536,'stream_header_size');continue;}
    header=Buffer.concat([header,chunk.subarray(0,end)]);need(header.length<=65536,'stream_header_size');
    let value;try{value=JSON.parse(header);}catch{need(false,'stream_header');}
    need(value?.kind==='china-photo-image-stream-v1'&&value.archiveBytes===pins.archiveBytes
     &&typeof value.receiptBase64==='string'&&value.receiptBase64.length<=16384,'stream_binding');
    receiptRaw=Buffer.from(value.receiptBase64,'base64');
    need(receiptRaw.toString('base64')===value.receiptBase64&&receiptRaw.length===pins.receiptBytes
     &&hash(receiptRaw)===pins.receiptSha256,'receipt_hash');
    output=await fs.open(filename,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    chunk=chunk.subarray(end+1);
   }
   if(remaining){
    const body=chunk.subarray(0,Math.min(remaining,chunk.length));
    if(body.length){await output.writeFile(body);digest.update(body);remaining-=body.length;chunk=chunk.subarray(body.length);}
   }
   if(chunk.length){footer=Buffer.concat([footer,chunk]);need(footer.length<=65536,'stream_footer_size');}
  }
  need(receiptRaw&&remaining===0&&digest.digest('hex')===pins.archiveSha256,'archive_hash');
  let value;try{value=JSON.parse(footer.toString('utf8'));}catch{need(false,'stream_footer');}
  need(equal(value,{kind:'china-photo-image-stream-complete-v1',archiveSha256:pins.archiveSha256,
   sourceUnchanged:true,ingressUnchanged:true,retainedHealthy:true,hostWrites:0}),'stream_footer');
  await output.sync();return {receiptRaw,sourceProof:value};
 }finally{await output?.close();}
}

export async function retrievePhotoImage({root=ROOT,directory,privateKey,pins=PHOTO_IMAGE_REUSE,spawnImpl=spawn}){
 const known=path.join(root,'docs/operations/regcloud-staging-known-hosts');
 need(hash(await fs.readFile(known))===pins.knownHostsSha256,'host_key');
 need(typeof privateKey==='string'&&privateKey.length>0,'key');
 const keyDirectory=await fs.mkdtemp(path.join(directory,'ssh-')),key=path.join(keyDirectory,'private-key');
 let child,timer,received;
 try{
  await fs.chmod(keyDirectory,0o700);await fs.writeFile(key,privateKey+'\n',{mode:0o600,flag:'wx'});
  const command='/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c '+quote(photoImageRemoteProgram(pins));
  const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ForwardAgent=no',
   '-o','ClearAllForwardings=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,
   '-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','ConnectTimeout=15',
   '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','root@151.248.113.177',command];
  child=spawnImpl('/usr/bin/ssh',args,{env:{PATH,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
  let stderrBytes=0;child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;if(stderrBytes>4096)child.kill('SIGTERM');});
  const completed=new Promise((resolve,reject)=>{child.once('error',()=>reject(Error('china_image_restore_ssh_start')));child.once('close',code=>resolve(code));});
  // Observe early spawn failures while stdout is still being consumed; the
  // original rejection is retained for the later explicit await.
  completed.catch(()=>{});
  // Drain and authenticate the bounded binary stream; no host stderr or source
  // proof payload is copied into logs. The key never reaches a Docker child.
  timer=setTimeout(()=>child.kill('SIGKILL'),330_000);timer.unref();
  try{received=await receivePhotoImageStream(child.stdout,path.join(directory,'image.tar'),pins);}
  catch(error){child.kill('SIGTERM');await completed.catch(()=>{});throw error;}
  need(await completed===0&&stderrBytes<=4096,'ssh_failed');return received;
 }finally{
  clearTimeout(timer);await fs.rm(keyDirectory,{recursive:true,force:true});
 }
}

export function verifyRestoredPhotoReceipt(raw,{pins=PHOTO_IMAGE_REUSE,plan,pricingPlan,proof,compatibility}){
 need(raw.length===pins.receiptBytes&&hash(raw)===pins.receiptSha256,'receipt_hash');
 let receipt;try{receipt=JSON.parse(raw);}catch{need(false,'receipt_json');}
 need(plan.runtimeSha===pins.runtimeSha&&plan.runtimeTree===pins.runtimeTree&&plan.retainedRuntime===pins.retainedRuntime,'plan_pin');
 need(receipt.version===1&&receipt.kind==='china-runtime-image-v1'&&receipt.market==='china'
  &&receipt.codeScope===plan.codeScope&&receipt.archiveRoundTripVerified===true&&receipt.privateDataIncluded===false
  &&receipt.activationAuthorized===false&&receipt.hostContacted===false,'original_build_proof');
 need(['runtimeSha','runtimeTree','retainedRuntime','runtimeDiffSha256','runtimeFiles','protectedPathsUnchanged']
  .every(key=>equal(receipt[key],proof[key]))&&receipt.pricingRuntimeSha===pricingPlan.runtimeSha
  &&receipt.pricingRuntimeTree===pricingPlan.runtimeTree&&equal(receipt.servingCompatibility,compatibility),'source_binding');
 need(['imageId','imageUnpackedBytes','configSha256','rootFsSha256'].every(key=>receipt[key]===pins[key])
  &&receipt.bytes===pins.archiveBytes&&receipt.sha256===pins.archiveSha256&&receipt.platform==='linux/amd64','image_pin');
 need(equal(receipt.builder,{version:'29.1.3',driver:'overlayfs',driverType:'io.containerd.snapshotter.v1'}),'original_builder');
 return receipt;
}

async function seal(filename){
 const before=await fs.lstat(filename);need(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1,'regular_file');
 const digest=createHash('sha256');for await(const chunk of createReadStream(filename,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}))digest.update(chunk);
 const after=await fs.lstat(filename);
 need(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'file_changed');
 return {bytes:after.size,sha256:digest.digest('hex')};
}

export async function restoreChinaPhotoImage({root=ROOT,runtimeRoot,plan,pricingPlan,runnerTemp,dockerHost,privateKey,
 pins=PHOTO_IMAGE_REUSE,execute=executeImageCommand,retrieve=retrievePhotoImage,
 verifyRuntime=verifyChinaImageRuntime,verifyCompatibility=verifyServingCompatibility,
 readStorageInspection=readChinaImageStorageInspection,onProgress=()=>{}}){
 const temporary=await fs.realpath(runnerTemp);
 need(path.isAbsolute(temporary)&&temporary!==path.parse(temporary).root,'runner_temp');
 need(typeof dockerHost==='string'&&dockerHost.startsWith('unix:///'),'builder_socket');
 const socket=dockerHost.slice('unix://'.length);
 need(socket.startsWith(temporary+path.sep)&&socket===path.resolve(socket)&&await fs.realpath(socket)===socket
  &&(await fs.lstat(socket)).isSocket(),'builder_socket');
 const proof=await verifyRuntime({runtimeRoot,plan,execute});
 const compatibility=await verifyCompatibility({runtimeRoot,servingPlan:plan,pricingPlan});
 need(proof.runtimeSha===pins.runtimeSha&&proof.runtimeTree===pins.runtimeTree&&proof.retainedRuntime===pins.retainedRuntime,'plan_pin');
 const directory=path.join(temporary,'china-release-build');await fs.mkdir(directory,{mode:0o700});
 const dockerConfig=path.join(directory,'docker-config');await fs.mkdir(dockerConfig,{mode:0o700});
 const image=path.join(directory,'image.tar'),roundtrip=path.join(directory,'roundtrip.tar');
 const env={PATH,DOCKER_CONFIG:dockerConfig,DOCKER_HOST:dockerHost};
 const docker=(args,options={})=>execute('/usr/bin/docker',['--host='+dockerHost,...args],{...options,env});
 let hostContacted=false;
 try{
  const builder=verifyChinaImageBuilder(JSON.parse(await docker(['info','--format','{{json .}}'])));
  need(String(await docker(['image','ls','--quiet','--no-trunc'])).trim()==='','builder_not_empty');
  onProgress({phase:'china_image_restore_readonly',runtimeSha:pins.runtimeSha,sourceRunId:pins.runId});
  hostContacted=true;
  const restored=await retrieve({root,directory,privateKey,pins});
  need(equal(restored.sourceProof,{kind:'china-photo-image-stream-complete-v1',archiveSha256:pins.archiveSha256,
   sourceUnchanged:true,ingressUnchanged:true,retainedHealthy:true,hostWrites:0}),'source_fence');
  const receipt=verifyRestoredPhotoReceipt(restored.receiptRaw,{pins,plan,pricingPlan,proof,compatibility});
  const originalSeal={bytes:pins.archiveBytes,sha256:pins.archiveSha256};
  need(equal(await seal(image),originalSeal),'archive_hash');
  const inspect=async()=>verifyChinaImageInspection(JSON.parse(await docker(['image','inspect','--format','{{json .}}',pins.imageId])),pins.runtimeSha);
  const expected={imageId:pins.imageId,imageUnpackedBytes:pins.imageUnpackedBytes,configSha256:pins.configSha256,
   rootFsSha256:pins.rootFsSha256,platform:'linux/amd64'};
  await docker(['image','load','--input',image],{timeoutMs:900000});
  need(equal(await inspect(),expected),'import_identity');
  const readStorageProof=async()=>createChinaImageStorageProof({
   inspection:await readStorageInspection({dockerHost,imageId:pins.imageId}),
   imageReceipt:receipt,imageReceiptSha256:pins.receiptSha256});
  const storageProof=await readStorageProof();
  onProgress({phase:'china_image_restore_roundtrip',imageId:pins.imageId});
  await docker(['image','save','--output',roundtrip,pins.imageId],{timeoutMs:900000});
  need(equal(await inspect(),expected),'export_identity');
  const roundtripSeal=await seal(roundtrip);need(roundtripSeal.bytes>0,'empty_roundtrip');
  await docker(['image','rm',pins.imageId]);
  await docker(['image','load','--input',roundtrip],{timeoutMs:900000});
  need(equal(await inspect(),expected),'roundtrip_identity');
  need(equal(await readStorageProof(),storageProof),'storage_changed');
  need(equal(await seal(roundtrip),roundtripSeal)&&equal(await seal(image),originalSeal),'archive_changed');
  need(equal(await verifyRuntime({runtimeRoot,plan,execute}),proof)
   &&equal(await verifyCompatibility({runtimeRoot,servingPlan:plan,pricingPlan}),compatibility),'source_changed');
  const report={version:1,kind:'china-photo-image-restoration-v1',restored:true,
   runtimeSha:pins.runtimeSha,originalRunId:pins.runId,originalArtifactId:pins.artifactId,
   originalReceiptSha256:pins.receiptSha256,originalArchiveSha256:pins.archiveSha256,imageId:pins.imageId,
   originalReceiptPreserved:true,sourceUnchanged:true,archiveRoundTripVerified:true,builder,
   imageContentBytes:storageProof.contentBytes,imageUnpackedBytes:storageProof.unpackedBytes,
   imageStorageBytes:storageProof.totalBytes,
   hostContacted:true,hostWrites:0,registryRequests:0,privateDataIncluded:false,activationAuthorized:false};
  await fs.chmod(image,0o400);
  await fs.writeFile(path.join(directory,'image-storage-proof.json'),JSON.stringify(storageProof,null,2)+'\n',{mode:0o400,flag:'wx'});
  // Preserve the original receipt bytes: hostContacted:false describes the
  // historical build. The separate restoration report records this host read.
  await fs.writeFile(path.join(directory,'image-receipt.json'),restored.receiptRaw,{mode:0o400,flag:'wx'});
  await fs.writeFile(path.join(directory,'image-restoration-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o400,flag:'wx'});
  onProgress({phase:'china_image_restored',runtimeSha:receipt.runtimeSha,imageId:receipt.imageId,
   bytes:receipt.bytes,sha256:receipt.sha256,hostContacted:true,hostWrites:0});
  return report;
 }catch(error){
  const code=/^china_[a-z0-9_]{1,150}$/.test(error?.message||'')?error.message:'china_image_restore_failed';
  await fs.writeFile(path.join(directory,'image-restoration-report.json'),JSON.stringify({version:1,
   kind:'china-photo-image-restoration-v1',restored:false,errorCode:code,hostContacted,hostWrites:0})+'\n',{mode:0o600,flag:'wx'}).catch(()=>{});
  throw Error(code);
 }finally{
  await fs.rm(roundtrip,{force:true});await fs.rm(dockerConfig,{recursive:true,force:true});
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  need(process.argv.length===3&&['--verify','--run'].includes(process.argv[2]),'arguments');
  verifyChinaCodeInvocation();verifyFrozenSpeedBaselines(ROOT);
  const [plan,pricingPlan]=await Promise.all(['china-code-serving-plan.json','china-plan.json'].map(async name=>
   JSON.parse(await fs.readFile(path.join(ROOT,'.github/operations/catalog-next',name)))));
  need(plan.runtimeSha===PHOTO_IMAGE_REUSE.runtimeSha&&plan.runtimeTree===PHOTO_IMAGE_REUSE.runtimeTree
   &&plan.retainedRuntime===PHOTO_IMAGE_REUSE.retainedRuntime,'plan_pin');
  if(process.argv[2]==='--verify')console.log(JSON.stringify({phase:'china_image_restore_pins_verified',runtimeSha:plan.runtimeSha,hostContacted:false}));
  else{
   const temporary=await fs.realpath(process.env.RUNNER_TEMP),runtimeRoot=await fs.realpath(path.join(temporary,'china-serving-runtime-'+plan.runtimeSha));
   const privateKey=process.env.SSH_PRIVATE_KEY;delete process.env.SSH_PRIVATE_KEY;
   await restoreChinaPhotoImage({root:ROOT,runtimeRoot,plan,pricingPlan,runnerTemp:temporary,
    dockerHost:process.env.CHINA_BUILD_DOCKER_HOST,privateKey,onProgress:value=>console.log(JSON.stringify(value))});
  }
 }catch(error){console.error(/^china_[a-z0-9_]{1,150}$/.test(error?.message||'')?error.message:'china_image_restore_failed');process.exitCode=1;}
}
