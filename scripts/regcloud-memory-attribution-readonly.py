#!/usr/bin/env python3
"""Exact read-only host memory attribution. Never log command lines, env, secrets, files or app data."""
import json,os,pathlib,re,subprocess,sys,time
P=pathlib.Path
def emit(x): print(json.dumps(x,ensure_ascii=False,separators=(',',':')),flush=True)
def kib(name):
 d={}
 for line in P(name).read_text().splitlines():
  m=re.match(r'^([A-Za-z_()]+):\s+(\d+)\s*kB$',line)
  if m:d[m.group(1)]=int(m.group(2))*1024
 return d
def number(path):
 try:return int(P(path).read_text().strip())
 except (ValueError,FileNotFoundError,PermissionError):return None
def command(argv,seconds=20):
 p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,timeout=seconds,check=False)
 return p.stdout if p.returncode==0 and len(p.stdout)<=250000 else ''
def cgroup():
 base=P('/sys/fs/cgroup')
 if not (base/'cgroup.controllers').exists():return {'kind':'cgroup-v1-or-unavailable'}
 try:
  raw=(base/'memory.stat').read_text().splitlines()
  kv={k:int(v) for k,v in (line.split() for line in raw if len(line.split())==2)}
  wanted=('anon','file','kernel','slab','sock','shmem','inactive_file','active_file','file_mapped','pagetables','slab_reclaimable')
  return {'kind':'cgroup-v2','currentBytes':number(base/'memory.current'),
          'max':(base/'memory.max').read_text().strip(),'events':{k:int(v) for k,v in
            (line.split() for line in (base/'memory.events').read_text().splitlines())},
          'statBytes':{k:kv[k] for k in wanted if k in kv}}
 except (OSError,ValueError):return {'kind':'unavailable'}
def proc():
 values=[]
 for item in P('/proc').iterdir():
  if not item.name.isdecimal():continue
  try:
   name=(item/'comm').read_text().strip()[:35]
   if not re.fullmatch(r'[\w.()+ -]{1,35}',name):name='other'
   status=kib(item/'status')
   rss=status.get('VmRSS',0);swap=status.get('VmSwap',0)
   if rss<15*1024**2 and swap<5*1024**2:continue
   pss=None
   try:
    v=kib(item/'smaps_rollup')
    pss=v.get('Pss')
   except (PermissionError,FileNotFoundError,ProcessLookupError,OSError):pass
   values.append({'pid':int(item.name),'comm':name,'rssBytes':rss,'pssBytes':pss,'swapBytes':swap})
  except (PermissionError,FileNotFoundError,ProcessLookupError,OSError):continue
 return sorted(values,key=lambda v:(v['pssBytes'] if v['pssBytes'] is not None else v['rssBytes']),reverse=True)[:18]
def docker():
 result=[]
 raw=command(['docker','stats','--no-stream','--format','{{json .}}'],25)
 for line in raw.splitlines()[:40]:
  try:
   v=json.loads(line)
   name=str(v.get('Name',''))[:50]
   if not re.fullmatch(r'[A-Za-z0-9_.-]{1,50}',name):name='other'
   result.append({'id':str(v.get('ID',''))[:12],'name':name,
                  'memUsage':str(v.get('MemUsage',''))[:75],
                  'memPerc':str(v.get('MemPerc',''))[:30],
                  'cpuPerc':str(v.get('CPUPerc',''))[:30]})
  except (ValueError,TypeError):continue
 return result
def readpsi():
 try:return {s.split()[0]:{k:float(v) for k,v in (p.split('=') for p in s.split()[1:] if '=' in p)}
   for s in P('/proc/pressure/memory').read_text().splitlines()}
 except (OSError,ValueError):return {}
def main():
 if len(sys.argv)!=1:raise RuntimeError('arguments')
 mem=kib('/proc/meminfo')
 stat={}
 for line in P('/proc/vmstat').read_text().splitlines():
  parts=line.split()
  if len(parts)==2 and parts[0] in ('oom_kill','pgmajfault','pswpin','pswpout'):
   stat[parts[0]]=int(parts[1])
 v=os.statvfs('/')
 report={'kind':'regcloud-memory-readonly-v1','sampledAtUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
 'memory':{k:mem.get(k) for k in ('MemTotal','MemFree','MemAvailable','Buffers','Cached','SReclaimable','Shmem','SwapTotal','SwapFree','Dirty','Active','Inactive')},
 'vmstat':stat,'pressure':readpsi(),'cgroup':cgroup(),'topProcesses':proc(),'dockerStats':docker(),
 'disk':{'totalBytes':v.f_blocks*v.f_frsize,'freeBytes':v.f_bavail*v.f_frsize}}
 emit(report)
if __name__=='__main__':
 try:main()
 except Exception:emit({'kind':'regcloud-memory-readonly-v1','error':'measurement_unavailable'});sys.exit(1)
