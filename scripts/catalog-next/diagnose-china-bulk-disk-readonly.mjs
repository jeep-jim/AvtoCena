import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=path.resolve('.');
const file=path.join(root,'docs/operations/regcloud-staging-known-hosts');
const digest=x=>createHash('sha256').update(x).digest('hex');
const want='fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const codeRemote=String.raw`
import json,os,stat,fcntl
from pathlib import Path
BASE=Path('/opt/avtocena/releases')
RUNTIMES=['d536c1547c4d82a339ed68ced7d8503f09b6810b','38895e53f7f770ee68edb0b8ad53056468b928a5']
FILES=['GENERATION.json','details.sqlite','query.sqlite','FILTER_SEMANTICS.json','FX_RECEIPT.json','RECONCILIATION.json','DISPOSITIONS.ndjson']
def regular(p):
 try:
  v=p.lstat()
  return stat.S_ISREG(v.st_mode) and v.st_uid==0 and v.st_nlink==1
 except FileNotFoundError:return False
def item(directory):
 g=directory/'generation'
 vals={}
 for n in FILES:
  p=g/n
  vals[n]={'present':regular(p),'bytes':p.stat().st_size if regular(p) else 0}
 for key,fp in [('details_incoming',directory/'details.sqlite.incoming.gz'),('query_incoming',directory/'query.sqlite.incoming.gz'),('image_tar',directory/'image.tar')]:
  vals[key]={'present':regular(fp),'bytes':fp.stat().st_size if regular(fp) else 0}
 return {'files':vals,'planPresent':regular(directory/'PLAN.json'),'rollbackPresent':regular(directory/'ROLLED_BACK.json'),
         'acceptedPresent':regular(directory/'ACCEPTED.json')}
v=os.statvfs(BASE)
lockBusy=None
try:
 fd=os.open('/run/lock/avtocena-runtime-change.lock',os.O_RDONLY|os.O_NOFOLLOW)
 try:
  try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);lockBusy=False;fcntl.flock(fd,fcntl.LOCK_UN)
  except BlockingIOError:lockBusy=True
 finally:os.close(fd)
except OSError:pass
results={'diskFreeBytes':v.f_bavail*v.f_frsize,'diskTotalBytes':v.f_blocks*v.f_frsize,'runtimeLockBusy':lockBusy,'runtimes':{}}
for runtime in RUNTIMES:
 home=BASE/runtime/'china-next'
 choices=[]
 if home.is_dir() and not home.is_symlink():
  for p in sorted(home.iterdir()):
   if len(choices)>=30:break
   if not p.is_dir() or p.is_symlink() or len(p.name)!=32:continue
   choices.append(item(p))
 results['runtimes'][runtime]={'attemptsExamined':len(choices),'attempts':choices}
print(json.dumps(results,separators=(',',':')))
`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
if(digest(await fs.readFile(file))!==want)throw Error('china_host_diagnosis_host_key_changed');
if(process.env.GITHUB_REPOSITORY!=='jeep-jim/AvtoCena'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('china_host_diagnosis_invocation');
const keyMaterial=process.env.SSH_PRIVATE_KEY;
if(typeof keyMaterial!=='string'||!keyMaterial.length)throw Error('china_host_diagnosis_missing_key');
const dir=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'china-disk-observe-'));
const key=path.join(dir,'key');
try{
 await fs.writeFile(key,keyMaterial+'\n',{mode:0o600});
 const remote='/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c '+quote(codeRemote);
 const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
  '-o','ForwardAgent=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+file,
  '-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','ConnectTimeout=10',
  '-o','ClearAllForwardings=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3',
  'root@151.248.113.177',remote];
 const child=spawn('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>100000)child.kill('SIGTERM')});
 child.stderr.on('data',d=>{stderr+=d.toString();if(stderr.length>3000)child.kill('SIGTERM')});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
 if(code!==0||stdout.length>100000)throw Error('china_host_diagnosis_remote_failure');
 const report=JSON.parse(stdout);
 if(!Number.isSafeInteger(report.diskFreeBytes)||!Number.isSafeInteger(report.diskTotalBytes)||
    !report.runtimes||!Object.keys(report.runtimes).every(k=>/^[a-f0-9]{40}$/.test(k)))throw Error('china_host_diagnosis_bad_response');
 const clean={diskFreeBytes:report.diskFreeBytes,diskTotalBytes:report.diskTotalBytes,runtimeLockBusy:report.runtimeLockBusy,
  runtimes:Object.fromEntries(Object.entries(report.runtimes).map(([id,r])=>[id,{
   attemptsExamined:r.attemptsExamined,fullDetails:r.attempts.filter(a=>a.files?.['details.sqlite']?.present).length,
   fullQueries:r.attempts.filter(a=>a.files?.['query.sqlite']?.present).length,
   partialDetails:r.attempts.filter(a=>a.files?.details_incoming?.present).length,
   generations:r.attempts.filter(a=>a.files?.['GENERATION.json']?.present).length,
   accepted:r.attempts.filter(a=>a.acceptedPresent).length,
   rolledBack:r.attempts.filter(a=>a.rollbackPresent).length,
   detailsBytes:r.attempts.reduce((sum,a)=>sum+(a.files?.['details.sqlite']?.bytes||0),0),
   queryBytes:r.attempts.reduce((sum,a)=>sum+(a.files?.['query.sqlite']?.bytes||0),0),
   incomingBytes:r.attempts.reduce((sum,a)=>sum+(a.files?.details_incoming?.bytes||0)+(a.files?.query_incoming?.bytes||0),0),
   imageTarBytes:r.attempts.reduce((sum,a)=>sum+(a.files?.image_tar?.bytes||0),0),
   completedPairs:r.attempts.filter(a=>a.files?.['details.sqlite']?.present&&a.files?.['query.sqlite']?.present&&a.rollbackPresent&&!a.acceptedPresent).length
  }]))};
 process.stdout.write(JSON.stringify({kind:'china-disk-and-retained-generation-readonly',...clean})+'\n');
}finally{await fs.rm(dir,{recursive:true,force:true})}
