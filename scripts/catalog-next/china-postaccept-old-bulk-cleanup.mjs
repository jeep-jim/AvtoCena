import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createChinaStateStorage,inspectChinaPublicationState} from './china-state.mjs';

const CURRENT='d536c1547c4d82a339ed68ced7d8503f09b6810b';
const OLD='38895e53f7f770ee68edb0b8ad53056468b928a5';
const GENERATION='gen_china_45369451603_1';
const MANIFEST='d5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75';
const HOST_KEY_SHA='fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const remote=String.raw`
import fcntl,http.client,json,os,re,stat,subprocess
from pathlib import Path
BASE=Path('/opt/avtocena/releases')
CURRENT='d536c1547c4d82a339ed68ced7d8503f09b6810b'
OLD='38895e53f7f770ee68edb0b8ad53056468b928a5'
GEN='gen_china_45369451603_1'
MAN='d5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75'
CONFIG=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
FILES={'details.sqlite','query.sqlite','DISPOSITIONS.ndjson','image.tar'}
def need(x,code):
 if not x:raise RuntimeError('china_postaccept_cleanup_'+code)
def checked_folder(p):
 v=p.lstat();need(stat.S_ISDIR(v.st_mode) and not p.is_symlink() and v.st_uid==0 and not (v.st_mode & 0o022),'folder')
def regular(p):
 try:
  v=p.lstat()
  return stat.S_ISREG(v.st_mode) and v.st_uid==0 and v.st_nlink==1 and not p.is_symlink()
 except FileNotFoundError:return False
def proof(p):
 need(regular(p) and p.stat().st_size<=256*1024,'proof')
 return json.loads(p.read_bytes())
def server():
 raw=CONFIG.read_bytes()
 found=re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$',raw)
 need(len(found)==1 and 3000<=int(found[0])<4000,'ingress')
 port=int(found[0]);conn=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
 try:
  conn.request('GET','/api/health',headers={'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
  res=conn.getresponse();b=res.read(100000)
  need(res.status==200 and len(b)<=100000,'health')
  v=json.loads(b)
  need(v.get('ok') is True and v.get('releaseSha')==CURRENT,'current_identity')
 finally:conn.close()
 return raw
def existing_mounts():
 out=subprocess.run(['/usr/bin/docker','ps','-aq','--no-trunc'],capture_output=True,text=True,timeout=30,check=True).stdout
 ids=[p.strip() for p in out.splitlines() if p.strip()]
 need(len(ids)<150,'container_bound')
 values=[]
 for ident in ids:
  need(re.fullmatch(r'[a-f0-9]{64}',ident),'container_id')
  result=subprocess.run(['/usr/bin/docker','inspect',ident],capture_output=True,text=True,timeout=30,check=True)
  rows=json.loads(result.stdout);need(len(rows)==1 and rows[0]['Id']==ident,'inspect')
  for row in rows[0].get('Mounts',[]):
   source=row.get('Source')
   if isinstance(source,str) and source.startswith('/'):values.append(os.path.realpath(source))
 return values
def unmounted(directory,mounts):
 full=str(directory)
 return all(not (m==full or m.startswith(full+'/') or full.startswith(m+'/')) for m in mounts)
def candidate(p,mounts):
 checked_folder(p);checked_folder(p/'generation')
 need(re.fullmatch(r'[a-f0-9]{32}',p.name) and unmounted(p,mounts),'candidate')
 need(regular(p/'PLAN.json') and regular(p/'ROLLED_BACK.json') and not (p/'ACCEPTED.json').exists(),'state')
 plan=proof(p/'PLAN.json')
 rollback=proof(p/'ROLLED_BACK.json')
 need(plan.get('version')==1 and plan.get('market')=='china' and plan.get('runtimeSha')==OLD and
      plan.get('generationId')==GEN and plan.get('generationManifestSha256')==MAN and
      plan.get('nonce')==p.name,'plan')
 need(rollback.get('kind')=='china-host-rollback-v1' and rollback.get('release')==OLD and
      rollback.get('nonce')==p.name and rollback.get('generationManifestSha256')==MAN and
      rollback.get('retainedRuntimeSha')=='56d6b94fea70457e0ce2b0820596da9972846b90' and
      rollback.get('candidateRemoved') is True and rollback.get('ingressRestored') is True,'rollback')
 descriptors={f.get('name'):f for f in plan.get('files',[]) if isinstance(f,dict)}
 files=[]
 for name in sorted(FILES):
  loc=p/name if name=='image.tar' else p/'generation'/name
  if not regular(loc):continue
  desc=descriptors.get(name)
  need(isinstance(desc,dict) and type(desc.get('bytes')) is int and
       loc.stat().st_size==desc['bytes'] and re.fullmatch(r'[a-f0-9]{64}',desc.get('sha256','')),'file_descriptor')
  files.append(loc)
 return files
def main():
 checked_folder(BASE)
 fd=os.open('/run/lock/avtocena-runtime-change.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0,'lock')
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  original=server()
  mounts=existing_mounts()
  old=BASE/OLD/'china-next';current=BASE/CURRENT/'china-next'
  for folder in (BASE/OLD,old,BASE/CURRENT,current):checked_folder(folder)
  need(any(p.is_dir() and (p/'ACCEPTED.json').exists() for p in current.iterdir()),'accepted_runtime_missing')
  targets=[];attempts=0
  for p in sorted(old.iterdir()):
   if not p.is_dir() or p.is_symlink() or not re.fullmatch(r'[a-f0-9]{32}',p.name):continue
   if not (p/'ROLLED_BACK.json').exists() or (p/'ACCEPTED.json').exists():continue
   files=candidate(p,mounts)
   if files:attempts+=1;targets+=files
  need(len(targets)<=32 and len(set(map(str,targets)))==len(targets),'scope')
  before=os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize
  if not targets:
   print(json.dumps({'kind':'china-postaccept-old-bulk-cleanup','removedFiles':0,'removedAttempts':0,'freeBefore':before,'freeAfter':before,'status':'already_clean'}))
   return
  need(sum(p.stat().st_blocks*512 for p in targets)>1024**3,'minimum_old_data')
  # A successful release must still be the serving release while cleanup acts.
  need(CONFIG.read_bytes()==original and unmounted(old,mounts),'last_guard')
  for p in targets:need(regular(p),'identity_changed')
  removed=sum(p.stat().st_blocks*512 for p in targets)
  for p in targets:p.unlink()
  after=os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize
  need(after>before and CONFIG.read_bytes()==original,'post_guard')
  server()
  print(json.dumps({'kind':'china-postaccept-old-bulk-cleanup','removedFiles':len(targets),
    'removedAttempts':attempts,'allocatedBytesRemoved':removed,'freeBefore':before,
    'freeAfter':after,'currentRuntime':CURRENT},separators=(',',':')))
 finally:os.close(fd)
main()
`;
async function main(){
 if(process.env.GITHUB_REPOSITORY!=='jeep-jim/AvtoCena'||process.env.GITHUB_REPOSITORY_ID!=='1289722938'||
  process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('postaccept_invocation');
 const store=createChinaStateStorage();
 await store.assertPrivateBucket();
 async function accepted(){
  const [state,intent,lease]=await Promise.all(['accepted','intent','lease'].map(x=>store.read(x)));
  const inspection=inspectChinaPublicationState({accepted:state,intent}).status;
  if(inspection!=='resolved'||state.value?.current?.runtimeSha!==CURRENT||
    state.value?.current?.generationId!==GENERATION || state.value?.pending!==null ||
    state.value?.rollback?.runtimeSha===OLD ||
    lease.value?.status==='held'&&Date.parse(lease.value.expiresAt)>Date.now())
    throw Error('postaccept_unconfirmed_current');
  return state.value?.current?.proof?.hostReceiptSha256;
 }
 const prior=await accepted();
 const known=path.resolve('docs/operations/regcloud-staging-known-hosts');
 if(sha(await fs.readFile(known))!==HOST_KEY_SHA)throw Error('postaccept_known_host');
 const dir=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'china-postaccept-clean-'));
 const key=path.join(dir,'private-key');
 try{
  const secret=process.env.SSH_PRIVATE_KEY;
  if(typeof secret!=='string'||!secret.length)throw Error('postaccept_no_key');
  await fs.writeFile(key,secret+'\n',{mode:0o600});
  const command='/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c '+quote(remote);
  const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ForwardAgent=no',
   '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','GlobalKnownHostsFile=/dev/null',
   '-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ClearAllForwardings=yes',
   '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','root@151.248.113.177',command];
  const child=spawn('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>12000)child.kill('SIGTERM')});
  child.stderr.on('data',d=>{stderr+=d.toString();if(stderr.length>1600)child.kill('SIGTERM')});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  if(result!==0)throw Error('postaccept_remote_failed');
  const proof=JSON.parse(stdout);
  if(proof.kind!=='china-postaccept-old-bulk-cleanup'||proof.freeAfter<proof.freeBefore||
   proof.currentRuntime!==undefined&&proof.currentRuntime!==CURRENT)throw Error('postaccept_bad_proof');
  if((await accepted())!==prior)throw Error('postaccept_state_changed');
  process.stdout.write(JSON.stringify(proof)+'\n');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
}
main().catch(error=>{process.stderr.write(/^postaccept_[a-z_]+$/.test(error?.message||'')?error.message+'\n':'china_postaccept_cleanup_failed\n');process.exitCode=1});
