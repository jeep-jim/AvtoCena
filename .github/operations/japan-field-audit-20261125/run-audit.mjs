import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const source='d536c1547c4d82a339ed68ced7d8503f09b6810b';
const knownHosts=path.resolve('application/docs/operations/regcloud-staging-known-hosts');
if(sha256(await fs.readFile(knownHosts))!=='fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c')throw Error('host_key_pin_changed');
if(process.env.GITHUB_REPOSITORY!=='jeep-jim/AvtoCena'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('audit_invocation_rejected');
const bundle=await fs.readFile(path.join(process.env.RUNNER_TEMP,'japan-raw-field-audit.cjs'));
if(bundle.length>4*1024*1024)throw Error('bundle_too_large');
const program=String.raw`
import base64,datetime,hashlib,json,os,re,stat,subprocess,sys,urllib.request
from pathlib import Path
SOURCE='d536c1547c4d82a339ed68ced7d8503f09b6810b'
CALCULATION='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
CONFIG=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
def run(*args):
 p=subprocess.run(list(args),capture_output=True,timeout=20,check=False)
 if p.returncode:raise RuntimeError('read_command_failed')
 return p.stdout
def health(url):
 with urllib.request.urlopen(url,timeout=15) as r:
  if r.status!=200:raise RuntimeError('health_http_failed')
  value=json.loads(r.read(8192))
 if value.get('ok')!=True or value.get('releaseSha')!=SOURCE or value.get('calculationVersion')!=CALCULATION:raise RuntimeError('health_identity_changed')
 return value
def selected():
 s=CONFIG.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_nlink!=1:raise RuntimeError('config_shape_invalid')
 body=CONFIG.read_bytes()
 # Match the deployed controller's exact proxy_pass directive, not an upstream block.
 ports=re.findall(rb'(?m)^\s*proxy_pass http://127\.0\.0\.1:(\d+);\s*$',body)
 if len(ports)!=1:raise RuntimeError('upstream_ambiguous')
 port=ports[0].decode()
 ids=run('docker','ps','-q').decode().split()
 if not ids:raise RuntimeError('no_containers')
 all_rows=json.loads(run('docker','inspect',*ids))
 matches=[]
 for row in all_rows:
  binds=row.get('NetworkSettings',{}).get('Ports',{}).get('3000/tcp') or []
  if any(x.get('HostIp')=='127.0.0.1' and x.get('HostPort')==port for x in binds):matches.append(row)
 if len(matches)!=1:raise RuntimeError('active_container_ambiguous')
 row=matches[0]
 if row.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')!=SOURCE or not row.get('State',{}).get('Running'):raise RuntimeError('active_revision_changed')
 identity={k:row.get(k) for k in ['Id','Image','Config','HostConfig','Mounts','RestartCount']}
 identity['State']={k:row.get('State',{}).get(k) for k in ['Pid','StartedAt','Running']}
 fingerprint=hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return body,port,row['Id'],fingerprint
def photo_logs():
 signatures={'yS-BjLIhOUbNrvino7j8M_Jph8SHxrdWgoqpIKKGFgY':'224491f1e34e02611835a7be','VIrgfhhS6s-Cwd9xCjnTm7pOUYtp1FV48d4SELXsWrw':'6fed5f32b3ca74517ba33d32','X-JoowLSkwKUZ1DrWs4quUBHN8VTxawv3KVrXTnK1FU':'229cd85c10427cf99b58627e','W0EJi_1uzw6YqxVN8TOTiZxoJbiZQyMmlTac30AYh-s':'31f74138f65e9c6261829991'}
 paths=[Path('/var/log/nginx/access.log')]
 for p in paths:
  try:
   s=p.lstat()
   if not stat.S_ISREG(s.st_mode) or s.st_uid!=0:continue
   with p.open('rb') as f:
    offset=max(0,s.st_size-8*1024*1024);f.seek(offset)
    if offset:f.readline()
    body=f.read(8*1024*1024)
  except OSError:continue
  summary={key:{'offerId':value,'statuses':{},'firstSeenAt':None,'lastSeenAt':None} for key,value in signatures.items()}
  for line in body.decode('utf-8','replace').splitlines():
   if '/api/catalog/photo/' not in line:continue
   m=re.search(r'\[([^\]]+)\]\s+"GET /api/catalog/photo/([A-Za-z0-9_-]+)\?[^"\s]* HTTP/[0-9.]+"\s+(\d{3})\s',line)
   if not m or m[2] not in summary:continue
   try:at=datetime.datetime.strptime(m[1],'%d/%b/%Y:%H:%M:%S %z').isoformat()
   except ValueError:continue
   if not at.startswith('2026-11-25'):continue
   v=summary[m[2]];v['statuses'][m[3]]=v['statuses'].get(m[3],0)+1
   v['firstSeenAt']=v['firstSeenAt'] or at;v['lastSeenAt']=at
  return {'boundedLogAvailable':True,'maxBytes':8*1024*1024,'samples':list(summary.values())}
 return {'boundedLogAvailable':False}
try:
 payload=json.load(sys.stdin)
 bundle=base64.b64decode(payload['bundle'],validate=True)
 if len(bundle)>4*1024*1024 or hashlib.sha256(bundle).hexdigest()!=payload['sha256']:raise RuntimeError('bundle_integrity_failed')
 before=selected();health('https://avtocena.com/api/health');health('http://127.0.0.1:'+before[1]+'/api/health')
 with urllib.request.urlopen('https://api.ipify.org',timeout=15) as r:ip=r.read(100).decode().strip()
 if ip!='151.248.113.177':raise RuntimeError('actual_egress_changed')
 print('AUDIT_HOST_BEFORE',json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseSha':SOURCE,'publicAndLoopbackVerified':True,'actualEgressVerified':True}),flush=True)
 print('CHINA_PHOTO_LOG_COUNTS',json.dumps(photo_logs(),separators=(',',':')),flush=True)
 child=subprocess.run(['timeout','150s','docker','exec','-i','-e','AJES_DIAG_IP='+ip,before[2],'node'],input=bundle,capture_output=True,timeout=165,check=False)
 lines=child.stdout.decode('utf-8','replace').splitlines()
 allowed={'JAPAN_SAVED_FIELD_AUDIT','JAPAN_RAW_FIELD_AUDIT','JAPAN_NORMALIZED_FIELD_AUDIT','JAPAN_FIELD_AUDIT_COMPLETE','JAPAN_FIELD_AUDIT_FAILED','JAPAN_FIELD_AUDIT_SELFTEST'}
 if len(child.stdout)>80000:raise RuntimeError('audit_output_size')
 for line in lines:
  label,sep,data=line.partition(' ')
  if label not in allowed or not sep:raise RuntimeError('audit_output_shape')
  value=json.loads(data)
  print(label,json.dumps(value,separators=(',',':')),flush=True)
 after=selected();health('https://avtocena.com/api/health');health('http://127.0.0.1:'+after[1]+'/api/health')
 unchanged=before==after
 print('AUDIT_HOST_AFTER',json.dumps({'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'releaseSha':SOURCE,'runtimeConfigIngressUnchanged':unchanged,'childExitCode':child.returncode,'childStderrSuppressed':bool(child.stderr)}),flush=True)
 if not unchanged or child.returncode:sys.exit(1)
except Exception as error:
 allowed_reasons={'read_command_failed','health_http_failed','health_identity_changed','config_shape_invalid','upstream_ambiguous','no_containers','active_container_ambiguous','active_revision_changed','bundle_integrity_failed','actual_egress_changed','audit_output_size','audit_output_shape'}
 reason=str(error) if isinstance(error,RuntimeError) and str(error) in allowed_reasons else 'bounded_audit_or_identity_check_failed'
 print('AUDIT_HOST_FAILED',json.dumps({'reason':reason}),flush=True)
 sys.exit(1)
`;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const temp=await fs.mkdtemp(path.join(process.env.RUNNER_TEMP||os.tmpdir(),'japan-fields-read-'));
const key=path.join(temp,'key');
try{
 const secret=process.env.SSH_PRIVATE_KEY;
 if(!secret)throw Error('missing_ssh_key');
 await fs.writeFile(key,secret+'\n',{mode:0o600,flag:'wx'});
 const args=['-F','/dev/null','-T','-i',key,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ForwardAgent=no','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+knownHosts,'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ClearAllForwardings=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=3','root@151.248.113.177','/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c '+quote(program)];
 const child=spawn('/usr/bin/ssh',args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',data=>{stdout+=data.toString();if(stdout.length>100000)child.kill('SIGTERM');});
 child.stderr.on('data',data=>{stderr+=data.toString();if(stderr.length>4000)child.kill('SIGTERM');});
 const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
 child.stdin.end(JSON.stringify({bundle:bundle.toString('base64'),sha256:sha256(bundle)}));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 clearTimeout(timer);
 if(stdout.length>100000)throw Error('remote_output_size');
 await fs.writeFile('japan-fields-and-china-photo-audit.log',stdout);
 process.stdout.write(stdout);
 if(code!==0)throw Error('remote_audit_failed');
}finally{await fs.rm(temp,{recursive:true,force:true});}
