import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createChinaStateStorage,inspectChinaPublicationState} from './china-state.mjs';

const remote=String.raw`
import datetime,fcntl,hashlib,http.client,json,os,re,stat,subprocess
from pathlib import Path
BASE=Path('/opt/avtocena/releases')
OLD='38895e53f7f770ee68edb0b8ad53056468b928a5'
FAILED='d536c1547c4d82a339ed68ced7d8503f09b6810b'
GEN='gen_china_45369451603_1'
MAN='d5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75'
PREVIOUS='56d6b94fea70457e0ce2b0820596da9972846b90'
CONFIG=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
def need(v,reason):
 if not v:raise RuntimeError('china_safe_cleanup_'+reason)
def protected_directory(p):
 v=p.lstat()
 need(stat.S_ISDIR(v.st_mode) and not p.is_symlink() and v.st_uid==0 and not (v.st_mode & 0o022),'folder_identity')
def ordinary(p):
 try:
  v=p.lstat()
  return stat.S_ISREG(v.st_mode) and v.st_uid==0 and v.st_nlink==1 and not p.is_symlink()
 except FileNotFoundError:return False
def js(p):
 need(ordinary(p) and p.stat().st_size<=256*1024,'proof_file')
 return json.loads(p.read_bytes())
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for chunk in iter(lambda:f.read(2*1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def current_site():
 raw=CONFIG.read_bytes();found=re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$',raw)
 need(len(found)==1 and 3000<=int(found[0])<4000,'ingress')
 con=http.client.HTTPConnection('127.0.0.1',int(found[0]),timeout=12)
 try:
  con.request('GET','/api/health',headers={'Host':'avtocena.com','Accept':'application/json','Connection':'close'})
  res=con.getresponse();body=res.read(100000)
  need(res.status==200 and len(body)<=100000,'health_status')
  val=json.loads(body)
  need(val.get('ok') is True and val.get('releaseSha')==PREVIOUS,'health_identity')
 finally:con.close()
 return raw
def rows():
 result=subprocess.run(['/usr/bin/docker','ps','-q','--no-trunc'],capture_output=True,text=True,timeout=30,check=True)
 names=[x.strip() for x in result.stdout.splitlines() if x.strip()]
 need(len(names)<150,'docker_count')
 paths=[]
 for name in names:
  need(re.fullmatch(r'[a-f0-9]{64}',name),'docker_identity')
  r=subprocess.run(['/usr/bin/docker','inspect',name],capture_output=True,text=True,timeout=30,check=True)
  inspected=json.loads(r.stdout)
  need(len(inspected)==1 and inspected[0]['Id']==name,'docker_inspect')
  for m in inspected[0].get('Mounts',[]):
   source=m.get('Source')
   if isinstance(source,str) and source.startswith('/'):paths.append(os.path.realpath(source))
 return paths
def not_mounted(folder,mounts):
 root=str(folder)
 for m in mounts:
  if m==root or m.startswith(root+'/') or root.startswith(m+'/'):
   return False
 return True
def attempt(p):
 protected_directory(p);protected_directory(p/'generation')
 plan=js(p/'PLAN.json')
 need(plan.get('version')==1 and plan.get('market')=='china' and plan.get('generationId')==GEN and
      plan.get('generationManifestSha256')==MAN and plan.get('runtimeSha')==p.parent.parent.name and
      plan.get('nonce')==p.name,'plan_binding')
 desc={f.get('name'):f for f in plan.get('files',[]) if isinstance(f,dict)}
 need(set(['details.sqlite','query.sqlite','GENERATION.json']).issubset(desc),'plan_descriptors')
 for n in ('details.sqlite','query.sqlite','GENERATION.json'):
  v=desc[n]
  need(type(v.get('bytes')) is int and v['bytes']>0 and re.fullmatch(r'[a-f0-9]{64}',v.get('sha256','')),'file_descriptor')
 return plan,desc
def pairs(home,mounts):
 values=[]
 for p in sorted(home.iterdir()):
  if not p.is_dir() or p.is_symlink() or not re.fullmatch(r'[a-f0-9]{32}',p.name):continue
  if not ordinary(p/'PLAN.json') or not ordinary(p/'ROLLED_BACK.json') or (p/'ACCEPTED.json').exists():continue
  plan,desc=attempt(p)
  rollback=js(p/'ROLLED_BACK.json')
  need(rollback.get('kind')=='china-host-rollback-v1' and rollback.get('nonce')==p.name and
       rollback.get('release')==OLD and rollback.get('generationManifestSha256')==MAN and
       rollback.get('retainedRuntimeSha')==PREVIOUS and rollback.get('candidateRemoved') is True and
       rollback.get('ingressRestored') is True,'rolled_back_proof')
  files=[p/'generation'/x for x in ('details.sqlite','query.sqlite')]
  if all(ordinary(file) and file.stat().st_size==desc[file.name]['bytes'] for file in files):
   need(not_mounted(p,mounts),'candidate_mounted')
   values.append((p,files,desc))
 return sorted(values,key=lambda x:(x[0].stat().st_mtime_ns,x[0].name))
def main():
 protected_directory(BASE)
 fd=os.open('/run/lock/avtocena-runtime-change.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  st=os.fstat(fd);need(stat.S_ISREG(st.st_mode) and st.st_uid==0,'lock_identity')
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  ingress=current_site()
  mounted=rows()
  oldhome=BASE/OLD/'china-next';failedhome=BASE/FAILED/'china-next'
  for parent in (BASE/OLD,oldhome,BASE/FAILED,failedhome):protected_directory(parent)
  saved=pairs(oldhome,mounted)
  need(len(saved)>=3,'not_enough_preserved_copies')
  # Keep the newest authenticated complete image's two databases, retaining
  # every plan, receipt and manifest for forensic history.
  keeper=saved[-1]
  for item in keeper[1]:
   need(digest(item)==keeper[2][item.name]['sha256'],'retained_copy_integrity')
  doomed=saved[:-1][:2]
  need(len(doomed)==2 and len(saved)-len(doomed)>=1,'retention')
  pending=[]
  for p in sorted(failedhome.iterdir()):
   if p.is_dir() and not p.is_symlink() and re.fullmatch(r'[a-f0-9]{32}',p.name):
    plan,desc=attempt(p)
    need(plan.get('controllerSha')=='6a8a177d368eb3700999087769393435d10607e8','last_failed_controller')
    need(not (p/'ACCEPTED.json').exists() and not (p/'ROLLED_BACK.json').exists() and
         not (p/'generation'/'query.sqlite').exists(),'not_unaccepted_partial')
    need(not_mounted(p,mounted),'last_failed_mounted')
    for f in (p/'generation'/'details.sqlite',p/'details.sqlite.incoming.gz'):
     if ordinary(f):pending.append(f)
  need(len(pending)<=2,'failed_partial_scope')
  targets=[f for p,files,_ in doomed for f in files]+pending
  need(4<=len(targets)<=6 and len({str(f) for f in targets})==len(targets),'target_count')
  before=os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize
  expected=sum(f.stat().st_blocks*512 for f in targets)
  need(expected>8*1024**3,'expected_freed')
  # Recheck current ingress, running mounts and file identities immediately
  # before unlinks. The site remains on the old release throughout.
  need(CONFIG.read_bytes()==ingress and not any(not not_mounted(p,mounted) for p,_,_ in doomed),'last_guard')
  for f in targets:
   need(ordinary(f),'target_changed')
  for f in targets:f.unlink()
  after=os.statvfs(BASE).f_bavail*os.statvfs(BASE).f_frsize
  need(after>before and (keeper[1][0]).exists() and (keeper[1][1]).exists()
       and CONFIG.read_bytes()==ingress,'post_guard')
  print(json.dumps({'kind':'china-safe-bulk-cleanup-v1','filesRemoved':len(targets),
    'failedAttemptsCleaned':len(doomed),'partialFailedFilesRemoved':len(pending),
    'preservedCompletePairs':len(saved)-len(doomed),
    'estimatedAllocatedBytesRemoved':expected,'diskFreeBefore':before,'diskFreeAfter':after},separators=(',',':')))
 finally:
  os.close(fd)
main()
`;
const EXPECTED_HOST='fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const sha=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function main(){
 if(process.env.GITHUB_REPOSITORY!=='jeep-jim/AvtoCena'||process.env.GITHUB_REPOSITORY_ID!=='1289722938'||
    process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('cleanup_wrong_invocation');
 const storage=createChinaStateStorage();
 await storage.assertPrivateBucket();
 async function assertNoAccepted(){
  const [accepted,intent,lease]=await Promise.all(['accepted','intent','lease'].map(name=>storage.read(name)));
  const state=inspectChinaPublicationState({accepted,intent});
  if(accepted.value?.current||accepted.value?.pending||!['resolved','idle'].includes(state.status)||
     (lease.value?.status==='held' && Date.parse(lease.value.expiresAt)>Date.now()))
     throw Error('cleanup_china_state_not_idle');
 }
 await assertNoAccepted();
 const known=path.resolve('docs/operations/regcloud-staging-known-hosts');
 if(sha(await fs.readFile(known))!==EXPECTED_HOST)throw Error('cleanup_host_identity');
 const dir=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'china-exact-clean-'));
 const key=path.join(dir,'private-key');
 let output='';
 try{
  const secret=process.env.SSH_PRIVATE_KEY;
  if(!secret||typeof secret!=='string')throw Error('cleanup_key_missing');
  await fs.writeFile(key,secret+'\n',{mode:0o600});
  const command='/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c '+quote(remote);
  const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ForwardAgent=no',
    '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+known,'-o','GlobalKnownHostsFile=/dev/null',
    '-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ClearAllForwardings=yes',
    '-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','root@151.248.113.177',command];
  const child=spawn('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
  let errors='';
  child.stdout.on('data',data=>{output+=data.toString();if(output.length>15000)child.kill('SIGTERM')});
  child.stderr.on('data',data=>{errors+=data.toString();if(errors.length>1000)child.kill('SIGTERM')});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  if(code!==0)throw Error('cleanup_host_failed');
  const proof=JSON.parse(output);
  if(proof.kind!=='china-safe-bulk-cleanup-v1'||proof.filesRemoved<4||proof.failedAttemptsCleaned!==2||
    proof.preservedCompletePairs<1||proof.diskFreeAfter<=proof.diskFreeBefore)throw Error('cleanup_invalid_proof');
  await assertNoAccepted();
  process.stdout.write(JSON.stringify(proof)+'\n');
 }finally{await fs.rm(dir,{recursive:true,force:true})}
}
main().catch(error=>{process.stderr.write(/^cleanup_[a-z_]+$/.test(error?.message||'')?error.message+'\n':'china_cleanup_unverified\n');process.exitCode=1});
