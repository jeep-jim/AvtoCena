"""Read bounded stopped-candidate diagnostics; never start a process or publish payloads."""
import collections,datetime,json,re,subprocess
release='3048aede91dbfa4287e038075700e1434ba53e85'
name='avtocena-release-'+release[:12]
meta=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
env=dict(v.split('=',1) for v in meta['Config']['Env'] if '=' in v)
assert env.get('AVTOCENA_RELEASE_SHA')==release
assert meta['Config']['Labels']['avtocena.role']=='production'
assert not meta['State']['Running'],'candidate must remain stopped'
print('CANDIDATE',json.dumps({'name':name,'image':meta['Image'],'memoryLimit':meta['HostConfig']['Memory'],'nanoCpus':meta['HostConfig']['NanoCpus'],'state':{k:meta['State'].get(k) for k in ['Status','OOMKilled','ExitCode','StartedAt','FinishedAt']}}))
log=subprocess.run(['docker','logs','--timestamps','--since','2026-11-11T11:41:30Z','--until','2026-11-11T11:43:05Z','--tail','20000',name],capture_output=True,text=True,check=True,timeout=20)
lines=(log.stdout+'\n'+log.stderr).splitlines()
codes=['home_initial_catalog_failed','home_initial_pricing_failed','visitor_restricted','ban_limit','detail_cache_queue_timeout','detail_cache_queue_full','catalog_market_unavailable','catalog_page_unavailable','catalog_offer_related_search_failed','offer_similar_search_failed','object_storage_response_timeout','heap out of memory','FATAL ERROR','ECONNRESET','AbortError','TypeError','ReferenceError','SyntaxError','RangeError']
counts=collections.Counter();reads=[];stacks=[];keep=0
for line in lines:
 for code in codes:
  if code in line:counts[code]+=1
 if 'catalog_storage_read ' in line:
  try:
   row=json.loads(line.split('catalog_storage_read ',1)[1]);reads.append({k:row[k] for k in ['path','ms','found','bytes'] if k in row})
  except Exception:pass
 if any(code in line for code in codes) or re.search(r'\b(?:Error|Exception):',line) or '⨯' in line:keep=14
 if keep:
  if any(code in line for code in codes) or re.search(r'\b(?:Error|Exception):',line) or ' at ' in line or 'market:' in line or 'code:' in line or 'error:' in line:
   safe=re.sub(r'https?://[^\s\"\x27<>]+','[url]',line)
   safe=re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','[email]',safe)
   safe=re.sub(r'(?i)(authorization|token|secret|password|cookie)[=:][^\s,;]+',r'\1=[redacted]',safe)
   stacks.append(safe[:700])
  keep-=1
error_kinds=collections.Counter()
for line in lines:
 match=re.search(r'\b([A-Za-z]*Error):\s*([A-Za-z0-9_.-]+)',line)
 if match:error_kinds[':'.join(match.groups())]+=1
print('ERROR_COUNTS',json.dumps(counts))
print('ERROR_KINDS',json.dumps(error_kinds.most_common(40)))
print('SLOW_READS',json.dumps(sorted(reads,key=lambda x:x.get('ms',0),reverse=True)[:30]))
print('FAILURE_STACKS',json.dumps(stacks[-180:]))
live=json.loads(subprocess.check_output(['docker','inspect','avtocena-production']))[0]
live_env=dict(v.split('=',1) for v in live['Config']['Env'] if '=' in v)
print('RETAINED_PRODUCTION',json.dumps({'release':live_env.get('AVTOCENA_RELEASE_SHA'),'state':{k:live['State'].get(k) for k in ['Running','StartedAt','ExitCode']},'restartCount':live['RestartCount'],'image':live['Image']}))
