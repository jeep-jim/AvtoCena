"""One bounded recovery of the exact already-installed application; no configuration/data edits."""
import subprocess,json,time,re,urllib.request,urllib.error,datetime,pathlib
EXPECTED='17a686182574097b5ade22b37ef8b485e2b53844'
def run(args,timeout=15):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 return p.returncode,p.stdout,p.stderr

def emit(label,value):print(label,json.dumps(value,ensure_ascii=False),flush=True)
code,out,err=run(['docker','inspect','avtocena-production'])
assert code==0,'production_container_missing'
c=json.loads(out)[0]
env=dict(row.split('=',1) for row in c['Config']['Env'] if '=' in row)
assert env.get('AVTOCENA_RELEASE_SHA')==EXPECTED,'unexpected_installed_release'
assert c['Config']['Labels'].get('avtocena.role')=='production','unexpected_container_role'
ports=c['HostConfig']['PortBindings']['3000/tcp']
assert len(ports)==1 and ports[0]['HostIp']=='127.0.0.1','unexpected_port_binding'
port=ports[0]['HostPort'];assert port.isdigit()
config=pathlib.Path('/etc/nginx/conf.d/avtocena-prepare.conf').read_text()
assert re.search(r'proxy_pass\s+http://127\.0\.0\.1:'+port+r'\s*;',config),'proxy_does_not_target_this_container'
emit('BEFORE',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'release':EXPECTED,'state':c['State'],'restartCount':c['RestartCount'],'image':c['Image'],'port':port})
code,out,err=run(['docker','logs','--since','90m','--tail','3000','avtocena-production'])
lines=(out+'\n'+err).splitlines()
patterns=['FATAL ERROR','heap out of memory','JavaScript heap','SIGSEGV','Segmentation fault','Assertion failed','fatal error','ENOMEM','ENOSPC','EADDRINUSE','Starting','Ready in','Debugger listening','Debugger attached']
emit('RUNTIME_DIAGNOSTIC',[l[:600] for l in lines if any(p.lower() in l.lower() for p in patterns)][-35:])
emit('ERROR_COUNTS',{key:sum(key in l for l in lines) for key in ['detail_cache_queue_timeout','detail_cache_queue_full','catalog_page_unavailable','catalog_market_unavailable']})
try:
 errorlog=pathlib.Path('/var/log/nginx/error.log').read_bytes()[-300000:].decode('utf8','replace')
 phrases=['connect() failed','upstream prematurely closed connection','upstream timed out','no live upstreams','upstream sent too big header']
 emit('NGINX_ERROR_COUNTS',{p:errorlog.count(p) for p in phrases})
except Exception as e:emit('NGINX_LOG_ERROR',type(e).__name__)
mem=pathlib.Path('/proc/meminfo').read_text().splitlines()
emit('HOST_MEMORY',[l for l in mem if l.split(':')[0] in ['MemTotal','MemAvailable','SwapTotal','SwapFree']])
code,out,err=run(['docker','stats','--no-stream','--format','{{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}','avtocena-production'],timeout=20);emit('RESOURCE_SAMPLE',out.strip())
def health():
 start=time.monotonic()
 try:
  with urllib.request.urlopen('http://127.0.0.1:'+port+'/api/health',timeout=5) as r:data=json.load(r)
  return {'ok':data.get('ok') is True and data.get('releaseSha')==EXPECTED,'release':data.get('releaseSha'),'seconds':round(time.monotonic()-start,3)}
 except Exception as e:return {'ok':False,'error':type(e).__name__+':'+str(e),'seconds':round(time.monotonic()-start,3)}
before=health();emit('HEALTH_BEFORE',before)
if not before['ok']:
 emit('RECOVERY_ACTION','restart exact existing container once; preserve image, environment, volumes, proxy and application data')
 code,out,err=run(['docker','restart','--time','15','avtocena-production'],timeout=45)
 assert code==0,'restart_failed'
 after=None
 for attempt in range(8):
  after=health()
  if after['ok']:break
  time.sleep(2)
 emit('HEALTH_AFTER',after)
 assert after and after['ok'],'recovery_health_failed'
else:emit('RECOVERY_ACTION','none: exact application health already restored')
code,out,err=run(['docker','inspect','avtocena-production']);c=json.loads(out)[0]
emit('AFTER',{'state':c['State'],'restartCount':c['RestartCount'],'image':c['Image']})
code,out,err=run(['curl','-sS','--max-time','15','--resolve','avtocena.com:443:127.0.0.1','https://avtocena.com/api/health'],timeout=20)
assert code==0,'nginx_health_unavailable'
public=json.loads(out);assert public.get('ok') is True and public.get('releaseSha')==EXPECTED,'nginx_release_mismatch'
emit('NGINX_HEALTH',public)
