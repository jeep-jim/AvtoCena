#!/usr/bin/env python3
"""Owner RegCloud host only. Executes one exact operator bundle; no deploy or ingress changes."""
import fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys
BASE=pathlib.Path('/opt/avtocena/releases/85296f6b8797aaa93227b69da7e9e9e928e8f9b5')
SHA=re.compile(r'[a-f0-9]{64}')
KEYS='GITHUB_REPOSITORY GITHUB_REPOSITORY_ID GITHUB_SHA GITHUB_REF GITHUB_WORKFLOW_REF GITHUB_JOB GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_TOKEN'.split()
RKEYS='YC_OBJECT_STORAGE_ENDPOINT YC_OBJECT_STORAGE_BUCKET YC_OBJECT_STORAGE_PREFIX YC_OBJECT_STORAGE_REGION YC_OBJECT_STORAGE_ACCESS_KEY_ID YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'.split()
def require(ok): 
 if not ok: raise ValueError('exact_host_dispatch_refused')
def digest(raw): return hashlib.sha256(raw).hexdigest()
def private(root,name,cap):
 p=root/name
 require(p.resolve()==p)
 with p.open('rb') as f:
  st=os.fstat(f.fileno())
  require(st.st_uid==0 and stat.S_ISREG(st.st_mode) and st.st_nlink==1 and not st.st_mode&0o077 and 0<st.st_size<=cap)
  b=f.read(cap+1);require(len(b)==st.st_size)
 return b
def main():
 require(os.geteuid()==0 and len(sys.argv) in [5,6])
 root=pathlib.Path(sys.argv[1]);pin=sys.argv[2];bundle_pin=sys.argv[3];mode=sys.argv[4]
 require(root.resolve()==root and root.parent==BASE/'china-switch-runs' and re.fullmatch(r'[1-9][0-9]{0,19}',root.name) and
  root.stat().st_uid==0 and root.stat().st_mode&0o077==0 and SHA.fullmatch(pin) and SHA.fullmatch(bundle_pin))
 require(mode in ('activate','read-control','rollback-control','ingress') and (mode in ('rollback-control','ingress'))==(len(sys.argv)==6))
 raw=private(root,'plan.json',65536);require(digest(raw)==pin);p=json.loads(raw)
 code=private(root,'china-dark-control-switch.mjs',8*1024*1024);require(digest(code)==bundle_pin)
 job=json.loads(private(root,'job.json',8192))
 require(set(job)==set(KEYS) and all(isinstance(v,str) and not re.search(r'[\x00\r\n]',v) for v in job.values()) and
  job['GITHUB_RUN_ID']==root.name and p['ownerJob']['runId']==root.name and p['ownerJob']['headSha']==job['GITHUB_SHA'])
 env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root',**job}
 raw_old=subprocess.check_output(['/usr/bin/docker','inspect','--type','container','avtocena-production'],timeout=6)
 [old]=json.loads(raw_old)
 require(old['Image']=='sha256:'+p['incumbent']['imageSha256'] and old['State']['Running'])
 oldenv=dict(x.split('=',1) for x in old['Config']['Env'])
 require(oldenv['AVTOCENA_RELEASE_SHA']==p['incumbent']['release'] and oldenv.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')!='1' and
  all(oldenv.get(k) and not re.search(r'[\x00\r\n]',oldenv[k]) for k in RKEYS))
 env.update({k:oldenv[k] for k in RKEYS})
 env['JSON_STORAGE_DRIVER']='object'
 node=None
 for candidate in [pathlib.Path('/usr/bin/node'),root/'node']:
  if not candidate.is_file():continue
  candidate=candidate.resolve()
  st=candidate.stat();require(st.st_uid==0 and stat.S_ISREG(st.st_mode) and not st.st_mode&0o022)
  try:
   if subprocess.check_output([str(candidate),'--version'],env={'PATH':env['PATH']},timeout=3).strip()==b'v24.22.1':
    node=str(candidate);break
  except (OSError,subprocess.SubprocessError):continue
 require(node)
 if mode=='activate':
  for name,pin_key in [('preview.cjs','previewBundleSha256'),('grant.json','previewGrantSha256')]:
   body=private(root,name,32*1024*1024);require(digest(body)==p[pin_key])
   dst=BASE/'china-private'/name
   require(dst.parent.resolve()==dst.parent and dst.parent.stat().st_uid==0 and dst.parent.stat().st_mode&0o077==0)
   try:
    fd=os.open(dst,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
    with os.fdopen(fd,'wb') as f: f.write(body);f.flush();os.fsync(f.fileno())
   except FileExistsError:
    require(digest(private(dst.parent,name,32*1024*1024))==p[pin_key])
 if mode=='ingress':
  ingress_pin,flip_pin=sys.argv[5].split(':')
  require(SHA.fullmatch(ingress_pin) and SHA.fullmatch(flip_pin) and
   digest(private(root,'ingress-plan.json',16384))==ingress_pin and
   digest(private(root,'flip_ingress.py',65536))==flip_pin)
  os.execve('/usr/bin/python3',['/usr/bin/python3',str(root/'flip_ingress.py'),str(root/'ingress-plan.json'),ingress_pin],env)
 args=[node,str(root/'china-dark-control-switch.mjs'),'--plan',str(root/'plan.json'),'--expect-plan-sha',pin]
 if mode!='read-control':
  # One physical flock; this process becomes Node, keeping the inherited FD.
  fd=os.open('/run/lock/avtocena-runtime-change.lock',os.O_RDONLY|os.O_NOFOLLOW)
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if fd!=9:os.dup2(fd,9,inheritable=True);os.close(fd)
  else:os.set_inheritable(fd,True)
 if mode=='read-control':args.append('--read-control')
 if mode=='rollback-control':
  require(SHA.fullmatch(sys.argv[5]))
  args+=['--rollback-control','--expect-control-sha',sys.argv[5]]
 os.execve(node,args,env)
if __name__=='__main__':
 try: main()
 except BaseException:
  print('{"status":"not_verified","reason":"exact_host_dispatch_refused"}',file=sys.stderr)
  raise SystemExit(1)
