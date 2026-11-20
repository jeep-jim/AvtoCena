import hashlib,http.client,json,os,re,socket,ssl,stat,subprocess,sys,time
APP='85296f6b8797aaa93227b69da7e9e9e928e8f9b5'
OLD='83ff17075e9188dcf227c8752dc064248d5f42e0'
CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
CONFIG='/etc/nginx/conf.d/avtocena-prepare.conf'
ROLE=[('avtocena-china-candidate-85296f6b8797',APP,'0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984',3000,True),('avtocena-production',OLD,'4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd',3001,False)]
HOST='avtocena.com'
def execute(*args):
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,check=True)
    if len(p.stdout)>256*1024:raise ValueError('command_bound')
    return p.stdout
def config():
    fd=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):raise ValueError('config_kind')
        raw=f.read(1024*1024+1)
    if len(raw)>1024*1024:raise ValueError('config_bound')
    lines=re.findall(rb'(?m)^[\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:(\d+);[\t ]*$',raw)
    return {'sha256':hashlib.sha256(raw).hexdigest(),'exactSingle3000':lines==[b'3000']}
def role(r):
    name,rev,image,port,armed=r
    d=json.loads(execute('docker','inspect','--type','container',name))[0]
    hc=d['HostConfig'];c=d['Config'];state=d['State']
    env=dict(i.split('=',1) for i in c['Env'] if '=' in i)
    exact=(d['Image']=='sha256:'+image and d['Name']=='/'+name and c['Labels'].get('org.opencontainers.image.revision')==rev
        and state['Running'] is True and hc['Privileged'] is False and env.get('AVTOCENA_RELEASE_SHA')==rev
        and env.get('AVTOCENA_CALCULATION_VERSION')==CALC and (env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')=='1')==armed
        and hc['PortBindings']=={'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':str(port)}]})
    if re.fullmatch('[a-f0-9]{64}',d['Id']) is None:raise ValueError('role_id')
    pid=state['Pid']; rss=None
    if type(pid) is int and pid>0:
        for line in open('/proc/%d/status'%pid):
            if line.startswith('VmRSS:'):rss=int(line.split()[1])*1024;break
    return {'exact':exact,'id':d['Id'],'pid':pid,'restartCount':d['RestartCount'],'limitBytes':hc['Memory'],'mainRssBytes':rss}
class LocalTLS(http.client.HTTPSConnection):
    def connect(self):
        self.sock=self._context.wrap_socket(socket.create_connection(('127.0.0.1',443),self.timeout),server_hostname=HOST)
def health(mode):
    import time
    conn=(LocalTLS(HOST,timeout=4,context=ssl.create_default_context()) if mode=='gateway'
          else http.client.HTTPConnection('127.0.0.1',3000 if mode=='incumbent' else 3001,timeout=4))
    try:
        conn.request('GET','/api/health?avtocenaReleaseProbe='+str(time.monotonic_ns()),headers={'Host':HOST,'Cache-Control':'no-cache','Connection':'close'})
        res=conn.getresponse(); raw=res.read(8193)
        if res.status!=200 or len(raw)>8192:return 'unknown'
        d=json.loads(raw)
        if d.get('ok') is not True or d.get('calculationVersion')!=CALC:return 'unknown'
        return {APP:'incumbent',OLD:'legacy'}.get(d.get('releaseSha'),'other')
    except Exception:return 'unknown'
    finally: conn.close()
RELEASE='22867cbcfaee27b2e8917b6bf880e44827f67b60'
GEN='gen_1795166586455_china44710087159'
TOTAL=170564
NAME='avtocena-china-grid-dark-22867cbcfaee'
NGINX='135ccf27648e4410f1ab0d23df9cf87c7866d4ae6ee157466c5546097203478a'
GIB=1024**3
ID=r'[a-f0-9]{24}'
BIND={'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':'3002'}]}
MOUNTS={('/opt/avtocena/metrics','/run/avtocena-metrics'),('/opt/avtocena/releases/'+APP+'/china-private','/run/avtocena-china-switch')}
def need(v,code):
    if not v:raise RuntimeError(code)
def inspect(n):
    return json.loads(execute('docker','inspect','--type','container',n))[0]
def mounts(d):
    m=d['Mounts']
    need(len(m)==2 and all(not x['RW'] and x['Type']=='bind' for x in m),'incumbent_mounts')
    need({(x['Source'],x['Destination']) for x in m}==MOUNTS,'incumbent_mount_scope')
def env(d):
    items=[s.split('=',1) for s in d['Config']['Env']]
    need(all(len(x)==2 and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',x[0]) and not re.search(r'[\x00\r\n]',x[1]) for x in items),
         'container_env_scope')
    out=dict(items);need(len(out)==len(items),'container_env_duplicate');return out
def snapshots():
    out=[]
    for x in ROLE:
        d=role(x);d.pop('mainRssBytes')
        need(d['exact'],'held_container_changed')
        out.append(d)
    need(config()=={'sha256':NGINX,'exactSingle3000':True} and health('gateway')=='incumbent','gateway_changed')
    return out
def identity(d,image,build,policy="no"):
    h=d['HostConfig'];c=d['Config'];e=env(d);st=d['State']
    mounts(d)
    need(d['Name']=='/'+NAME and d['Image']==image and c['Labels'].get('org.opencontainers.image.revision')==RELEASE and c['Labels'].get('avtocena.role')=='china-ui-grid-dark' and
         st['Running'] is True and st['OOMKilled'] is False and d['RestartCount']==0 and h['PortBindings']==BIND and h['Privileged'] is False and
         h['Memory']==h['MemorySwap']==4*GIB and h['NanoCpus']==2000000000 and h['PidsLimit']==512 and h['RestartPolicy']=={'Name':policy,'MaximumRetryCount':0} and
         e.get('AVTOCENA_RELEASE_SHA')==RELEASE and e.get('AVTOCENA_BUILD_CALCULATION_VERSION')==build and e.get('AVTOCENA_CALCULATION_VERSION')==CALC and
         e.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')=='1','dark_identity')
    base=env(inspect(ROLE[0][0]))
    for k in ('AVTOCENA_RELEASE_SHA','AVTOCENA_BUILD_CALCULATION_VERSION'):
        base.pop(k,None);e.pop(k,None)
    need(e==base,'dark_env_inheritance')
    return (d['Id'],st['Pid'],st['StartedAt'])
def sha(raw):
    return hashlib.sha256(raw).hexdigest()

import secrets
BASELINE_CALC='672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761'
HOSTNAME='avtocena.com'
NEIGHBORS=('korea','uae','europe','georgia')
READ_PREIMAGE=NGINX
def connect(where):
    if where=='gateway':return LocalTLS(HOSTNAME,timeout=7,context=ssl.create_default_context())
    if where=='public':return http.client.HTTPSConnection(HOSTNAME,timeout=7,context=ssl.create_default_context())
    return http.client.HTTPConnection('127.0.0.1',{'incumbent':3000,'candidate':3002}[where],timeout=7)
def request(where,path,limit):
    need(path.startswith('/') and not path.startswith('//'),'http_path')
    conn=connect(where)
    try:
        conn.request('GET',path,headers={'Host':HOSTNAME,'Cache-Control':'no-cache, no-store','Accept-Encoding':'identity','Connection':'close'})
        r=conn.getresponse()
        if r.status in (307,308):return r.status,r.getheader('Location'),b''
        body=r.read(limit+1)
        need(len(body)<=limit,'response_limit')
        return r.status,None,body
    finally:conn.close()
def raw_ok(where,path,limit):
    status,_,body=request(where,path,limit)
    need(status==200,'http_status')
    return body
from concurrent.futures import ThreadPoolExecutor
EUROPE="/api/catalog/search?market=europe&pageSize=2&sort=updatedAt"
def euro_probe(where):
    t=time.monotonic()
    try:
        code,_,raw=request(where,EUROPE,256*1024)
    except TimeoutError:return {'category':'bounded_timeout'}
    except OSError:return {'category':'transport_error'}
    try:
        v=json.loads(raw)
        need(isinstance(v,dict),'europe_json')
        if code==503 and v.get('ok') is False:
            reason=v.get('reason') or v.get('error')
            need(isinstance(reason,str) and re.fullmatch(r'[a-z0-9_:-]{1,80}',reason),'europe_reason')
            return {'category':'typed_503','reason':reason}
        if code!=200:return {'category':'other_http'}
        rows=v.get('items')
        need(v.get('ok') is True and not v.get('partial') and type(v.get('total')) is int and v['total']>0 and
             isinstance(rows,list) and 0<len(rows)<=2 and all(isinstance(r,dict) and r.get('market')=='europe' and
             isinstance(r.get('id'),str) and 0<len(r['id'])<=160 and
             ('totalRub' not in r or r['totalRub'] is None or type(r['totalRub']) is int and r['totalRub']>0) and
             ('calculationStatus' not in r or r['calculationStatus'] is None or isinstance(r['calculationStatus'],str)) for r in rows),
             'europe_shape')
        ids=[r['id'] for r in rows];need(len(set(ids))==len(ids),'europe_duplicate')
        values={r['id']:(
            ('totalRub' in r,r.get('totalRub')),('calculationStatus' in r,r.get('calculationStatus'))) for r in rows}
        md={k:v[k] for k in ('generationId','snapshotGen','updatedAt','dataUpdatedAt','marketUpdatedAt')
            if isinstance(v.get(k),str) and 1<=len(v[k])<=120}
        return {'category':'exact','total':v['total'],'order':ids,'values':values,'marketDigest':sha(json.dumps(md,sort_keys=True).encode()) if md else None}
    except Exception:return {'category':'malformed'}
def relation(a,b):
    out={'left':a['category'],'right':b['category']}
    if a['category']==b['category']=='typed_503':out['reasonMatch']=a['reason']==b['reason']
    if a['category']==b['category']=='exact':
        ids=a['values'].keys()&b['values'].keys()
        am,bm=a['marketDigest'],b['marketDigest']
        out.update(totalMatch=a['total']==b['total'],idOrderMatch=a['order']==b['order'],
            idSetMatch=a['values'].keys()==b['values'].keys(),pairedRows=len(ids),
            pairedPriceMatch=all(a['values'][i][0]==b['values'][i][0] for i in ids) if ids else None,
            pairedStatusMatch=all(a['values'][i][1]==b['values'][i][1] for i in ids) if ids else None,
            marketDigestEvidence='both' if am and bm else 'one' if am or bm else 'none',
            marketDigestMatch=am==bm if am and bm else None)
    return out
def euro_health(where):
    expected=RELEASE if where=='candidate' else APP
    v=json.loads(raw_ok(where,'/api/health?avtocenaReleaseProbe='+secrets.token_hex(10),8192))
    need(v.get('ok') is True and v.get('releaseSha')==expected and v.get('calculationVersion')==CALC,'health_role')
def diagnose(image,cid):
    need(re.fullmatch('sha256:[a-f0-9]{64}',image) and re.fullmatch('[a-f0-9]{64}',cid),'input_pins')
    held=snapshots(); dark=identity(inspect(NAME),image,BASELINE_CALC)
    need(dark[0]==cid,'dark_receipt_id')
    # No lock file creation, no exclusive locking; compare before/after for races.
    targets=('incumbent','candidate','public')
    for where in targets:euro_health(where)
    results=[]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for _ in range(2):results.append(dict(zip(targets,ex.map(euro_probe,targets))))
    need(snapshots()==held and identity(inspect(NAME),image,BASELINE_CALC)==dark,'runtime_moved')
    for where in targets:euro_health(where)
    print(json.dumps({'status':'europe_comparison_only',
        'first':{where:relation(results[0]['incumbent'],results[0][where]) for where in ('candidate','public')},
        'second':{where:relation(results[1]['incumbent'],results[1][where]) for where in ('candidate','public')},
        'stability':{where:relation(results[0][where],results[1][where]) for where in targets},
        'incumbentAndLegacyStable':True,'candidateStable':True,'nginxSha256':READ_PREIMAGE,'storageWritesByActor':0}))
if __name__=='__main__':
    try:
        need(len(sys.argv)==3,'argument_scope')
        diagnose(*sys.argv[1:])
    except Exception as e:
        reason=str(e)
        allowed={'argument_scope','input_pins','dark_receipt_id','runtime_moved','health_role','dark_identity',
                 'dark_env_inheritance','gateway_changed','held_container_changed','incumbent_mounts','incumbent_mount_scope','http_status'}
        print(json.dumps({'status':'europe_comparison_unverified','phase':reason if reason in allowed else type(e).__name__}))
        sys.exit(1)
