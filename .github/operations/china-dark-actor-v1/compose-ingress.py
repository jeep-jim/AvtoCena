#!/usr/bin/env python3
"""Compose the exact same-job private dark→ingress transition, no writes to S3 or Nginx."""
import hashlib,json,os,pathlib,re,sys,time
BASE=pathlib.Path('/opt/avtocena/releases/85296f6b8797aaa93227b69da7e9e9e928e8f9b5')
SHA=re.compile(r'[a-f0-9]{64}')
def need(ok):
 if not ok:raise ValueError('ingress_transition_refused')
def h(b):return hashlib.sha256(b).hexdigest()
def read(root,name,cap=64*1024):
 f=root/name
 need(f.resolve()==f and f.stat().st_uid==0 and not f.stat().st_mode&0o077 and f.stat().st_size<=cap)
 return f.read_bytes()
def main():
 need(os.geteuid()==0 and len(sys.argv)==5)
 root=pathlib.Path(sys.argv[1]);actor_pin,plan_pin,authority=sys.argv[2:]
 need(root.resolve()==root and root.parent==BASE/'china-switch-runs' and re.fullmatch(r'[1-9][0-9]{0,19}',root.name)
  and all(SHA.fullmatch(x) for x in (actor_pin,plan_pin,authority)))
 auth=json.loads(read(root,'ingress-authorization.json'))
 need(auth=={'version':1,'ownerIngressApprovalSha256':authority,'authorizesIngress':True,'authorizesDataWrite':False})
 raw=read(root,'plan.json');need(h(raw)==plan_pin);p=json.loads(raw)
 need(p['ownerJob']['runId']==root.name)
 dark=json.loads(read(root,'dark.json'));normal=json.loads(read(root,'ordinary.json'));host=json.loads(read(root,'host.json'));control=json.loads(read(root,'control.json'))
 need(dark.get('status')=='china_dark_control_verified' and dark.get('publicIngressChanged') is False and
  control.get('status')=='exact_dark_control' and control.get('storageWrites')==0 and
  control.get('controlSha256')==dark.get('controlSha256') and control.get('revision')==(3 if p.get('retryRollbackControlSha256') else 1) and
  normal.get('kind')=='normal-china-runtime-readback' and normal.get('readySha256')==control.get('readySha256')==p['target']['readySha256'])
 candidate=p['candidate'];old=p['incumbent'];clock=int(time.time()*1000)
 lifecycle=min(p['validUntil'],clock+180000);need(lifecycle>=clock+60000)
 node='system'
 if (root/'node').is_file():node='private'
 out={'version':1,'kind':'china-final-ingress-v1','appSha':candidate['release'],'previousSha':old['release'],
  'protectedCalc':old['calculationVersion'],'candidateImage':'sha256:'+candidate['imageSha256'],'oldImage':'sha256:'+old['imageSha256'],
  'oldPort':old['port'],'candidatePort':candidate['port'],**host,'controlReaderSha256':actor_pin,'darkPlanSha256':plan_pin,
  'expiresAt':lifecycle,'githubRunId':root.name,'controlNode':node,'controlReaderFile':'china-dark-control-switch.mjs','darkPlanFile':'plan.json',
  'control':{'checksum':control['controlSha256'],**{k:control[k] for k in ('etag','revision','generationId','readySha256')}},
  'dark':dark,'ordinary':normal,**p['query'],'authorizesIngress':True,'authorizesDataWrite':False}
 data=json.dumps(out,separators=(',',':')).encode()
 fd=os.open(root/'ingress-plan.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(data)
 print(h(data))
if __name__=='__main__':
 try:main()
 except BaseException:
  print('ingress_transition_refused',file=sys.stderr)
  raise SystemExit(1)
