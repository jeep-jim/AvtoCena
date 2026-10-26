#!/usr/bin/env python3
"""One-shot, read-only inspection of an explicitly selected failed candidate.
Never print raw application logs, environment, customer data or credentials.
"""
import collections,json,re,subprocess,sys
release=sys.argv[1]
if not re.fullmatch('[a-f0-9]{40}',release):raise ValueError('invalid_release')
name='avtocena-release-'+release[:12]
info=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
if info['Config']['Image']!='avtocena-regcloud:'+release:raise ValueError('wrong_image')
state=info['State']
if state['Running']:raise ValueError('candidate_must_be_stopped')
print(json.dumps({'release':release,'state':{k:state.get(k) for k in ['Status','OOMKilled','ExitCode','StartedAt','FinishedAt']},'memoryLimit':info['HostConfig']['Memory'],'nanoCpus':info['HostConfig']['NanoCpus']}))
logs=subprocess.run(['docker','logs','--tail','2000',name],capture_output=True,text=True,check=True)
text=logs.stdout+'\n'+logs.stderr
codes=collections.Counter(re.findall(r'\b(?:object_storage_[A-Za-z0-9_]+|detail_cache_[A-Za-z0-9_]+|catalog_[A-Za-z0-9_]+|shared_[A-Za-z0-9_]+|budget_[A-Za-z0-9_]+|UND_ERR_[A-Z_]+|ECONNRESET|ETIMEDOUT|ABORT_ERR|AbortError)\b',text))
paths=collections.Counter(re.findall(r'\bpath=(catalog/[A-Za-z0-9_./-]{1,220})',text))
print(json.dumps({'errorCodes':dict(codes),'catalogErrorPaths':dict(paths)},ensure_ascii=False))
rows=[]
for line in text.splitlines():
 if '{' not in line:continue
 try:value=json.loads(line[line.index('{'):])
 except ValueError:continue
 if not isinstance(value,dict):continue
 route=value.get('path') or value.get('key')
 if not isinstance(route,str) or not re.fullmatch(r'catalog/[A-Za-z0-9_./-]{1,220}',route):continue
 row={'path':route}
 for field in ['ms','elapsedMs','durationMs','bytes','sizeBytes']:
  if isinstance(value.get(field),(float,int)):row[field]=value[field]
 rows.append(row)
print(json.dumps({'catalogTimings':rows[-40:]},ensure_ascii=False))
