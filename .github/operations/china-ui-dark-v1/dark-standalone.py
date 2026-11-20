import hashlib,http.client,json,os,re,socket,ssl,stat,subprocess
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
def port():
    listeners=execute('ss','-H','-ltn','sport = :3002')
    # Docker may reserve a port without creating a listening docker-proxy.
    bindings=execute('docker','ps','--format','{{.Ports}}')
    return not listeners.strip() and re.search(rb':3002->',bindings) is None
def main():
    try:
        first=config();a,b=map(role,ROLE);free=port()
        endpoints={m:health(m) for m in ('incumbent','legacy','gateway')}
        fs=os.statvfs('/var/lib/docker'); mem={}
        with open('/proc/meminfo') as f:
            for l in f:
                k=l.split(':',1)[0]
                if k in ('MemTotal','MemAvailable','SwapFree'):mem[k]=int(l.split()[1])*1024
        # RSS changes ordinarily; stability is identity/binding, not RSS.
        a2,b2=map(role,ROLE)
        def identity(d):return {k:v for k,v in d.items() if k!='mainRssBytes'}
        stable=(first==config() and free==port() and
                identity(a)==identity(a2) and identity(b)==identity(b2))
        eligible=stable and a['exact'] and b['exact'] and free and first['exactSingle3000'] and endpoints=={'incumbent':'incumbent','legacy':'legacy','gateway':'incumbent'}
        print(json.dumps({'status':'exact_readback' if eligible else 'ineligible','gateway':first,'endpoints':endpoints,'port3002Free':free,'stableIdentity':stable,'incumbent':{k:v for k,v in a.items() if k not in ('id','pid')},'legacy':{k:v for k,v in b.items() if k not in ('id','pid')},'memoryBytes':mem,'dockerFilesystemFreeBytes':fs.f_bavail*fs.f_frsize},sort_keys=True))
        return 0 if eligible else 1
    except Exception:
        print('{"status":"readback_unverified"}')
        return 1

"""One exact loaded app, local loopback only; no config or catalog writer."""
import fcntl, html.parser, os, json, re, sys, time, urllib.parse
import http.client
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
def expected_postimage_sha():
    fd=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        st=os.fstat(f.fileno())
        need(st.st_uid==0 and stat.S_ISREG(st.st_mode) and 0<st.st_size<=1024*1024,'gateway_scope')
        b=f.read(1024*1024+1)
        need(len(b)==st.st_size and hashlib.sha256(b).hexdigest()==NGINX,'gateway_preimage')
    pattern=rb'(?m)^([\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:)3000(;[\t ]*)$'
    after,n=re.subn(pattern,rb'\g<1>3002\g<2>',b)
    need(n==1,'gateway_postimage')
    return hashlib.sha256(after).hexdigest()
def memory():
    with open('/proc/meminfo') as f:
        for l in f:
            if l.startswith('MemAvailable:'):return int(l.split()[1])*1024
    raise RuntimeError('headroom_unverified')
def fetch(path,limit):
    c=http.client.HTTPConnection('127.0.0.1',3002,timeout=7)
    try:
        c.request('GET',path,headers={'Host':HOST,'Cache-Control':'no-cache','Accept-Encoding':'identity','Connection':'close'})
        r=c.getresponse()
        need(r.status==200,'dark_http_status')
        b=r.read(limit+1);need(len(b)<=limit,'dark_http_body_bound')
        return b
    finally:c.close()
def getjson(path):
    return json.loads(fetch(path,1024*1024))
class Grid(html.parser.HTMLParser):
    def __init__(self):super().__init__();self.batches=[];self.ids=set();self.pages=set()
    def handle_starttag(self,tag,attr):
        attrs=dict(attr)
        if 'data-catalog-batch' in attrs:self.batches.append(attrs['data-catalog-batch'])
        if tag=='a':
            href=attrs.get('href') or ''
            m=re.match(r'^/cars/offer/('+ID+r')(?:[/?]|$)',href)
            if m:self.ids.add(m[1])
            u=urllib.parse.urlsplit(href);q=urllib.parse.parse_qs(u.query)
            if u.path=='/cars/china' and q.get('preparedCut')==[GEN] and q.get('page'):
                self.pages.update(q['page'])
def canary():
    allids=set()
    for page in (1,2):
        q=f'market=china&marketPage=1&page={page}&pageSize=24&preparedCut={GEN}'
        body=getjson('/api/catalog/search?'+q)
        rows=body.get('items');need(body.get('ok') is True and body.get('generationId')==GEN and body.get('total')==TOTAL and isinstance(rows,list) and len(rows)==24,'dark_page')
        need(all(r.get('market')=='china' and re.fullmatch(ID,r.get('id','')) and type(r.get('totalRub')) is int and r['totalRub']>0 for r in rows),'dark_rows')
        ids={r['id'] for r in rows};need(len(ids)==24 and not (ids&allids),'dark_page_overlap');allids|=ids
        html=fetch(f'/cars/china?page={page}&preparedCut={GEN}',4*1024*1024)
        need(b'</html>' in html and b'$RX(' not in html,'dark_ssr_body')
        parser=Grid();parser.feed(html.decode('utf-8'))
        need(parser.batches==[str(page)] and ids<=parser.ids and str(page+1) in parser.pages,'dark_ssr_grid')
    return len(allids)
def launch(image,build):
    expected=env(inspect(ROLE[0][0]));inc=inspect(ROLE[0][0]);mounts(inc)
    need(expected.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')=='1' and expected.get('AVTOCENA_CALCULATION_VERSION')==CALC,'runtime_base')
    expected.update(AVTOCENA_RELEASE_SHA=RELEASE,AVTOCENA_BUILD_CALCULATION_VERSION=build)
    # pass private env from incumbent on an unnamed, inherited descriptor only
    fd=os.memfd_create('china-ui-env',os.MFD_CLOEXEC)
    try:
        payload=''.join(k+'='+v+'\n' for k,v in expected.items()).encode()
        with os.fdopen(os.dup(fd),'wb') as f:f.write(payload)
        os.lseek(fd,0,os.SEEK_SET)
        args=['docker','run','-d','--name',NAME,'--label','avtocena.role=china-ui-grid-dark','--restart','no','--memory','4g',
              '--memory-swap','4g','--cpus','2','--pids-limit','512','--log-opt','max-size=10m','--log-opt','max-file=2','--env-file','/proc/self/fd/'+str(fd)]
        for src,dest in sorted(MOUNTS):args+=['--mount',f'type=bind,src={src},dst={dest},readonly']
        args+=['-p','127.0.0.1:3002:3000',image]
        import subprocess
        p=subprocess.run(args,pass_fds=(fd,),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=90)
        cid=p.stdout.decode().strip()
        need(p.returncode==0 and re.fullmatch('[a-f0-9]{64}',cid),'dark_start')
        return cid
    finally:os.close(fd)
def identity(d,image,build):
    h=d['HostConfig'];c=d['Config'];e=env(d);st=d['State']
    mounts(d)
    need(d['Name']=='/'+NAME and d['Image']==image and c['Labels'].get('org.opencontainers.image.revision')==RELEASE and c['Labels'].get('avtocena.role')=='china-ui-grid-dark' and
         st['Running'] is True and st['OOMKilled'] is False and d['RestartCount']==0 and h['PortBindings']==BIND and h['Privileged'] is False and
         h['Memory']==h['MemorySwap']==4*GIB and h['NanoCpus']==2000000000 and h['PidsLimit']==512 and h['RestartPolicy']['Name']=='no' and
         e.get('AVTOCENA_RELEASE_SHA')==RELEASE and e.get('AVTOCENA_BUILD_CALCULATION_VERSION')==build and e.get('AVTOCENA_CALCULATION_VERSION')==CALC and
         e.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')=='1','dark_identity')
    base=env(inspect(ROLE[0][0]))
    for k in ('AVTOCENA_RELEASE_SHA','AVTOCENA_BUILD_CALCULATION_VERSION'):
        base.pop(k,None);e.pop(k,None)
    need(e==base,'dark_env_inheritance')
    return (d['Id'],st['Pid'],st['StartedAt'])
def ready():
    for _ in range(15):
        try:
            d=getjson('/api/health')
            if d.get('ok') is True and d.get('releaseSha')==RELEASE and d.get('calculationVersion')==CALC:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('dark_health_unverified')
def main(image,build):
    need(re.fullmatch('sha256:[a-f0-9]{64}',image) and build=='672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761','literal_pins')
    with open('/run/lock/avtocena-runtime-change.lock','r') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        before=snapshots()
        need(execute('docker','image','inspect','--format','{{.Id}}','avtocena-regcloud:'+RELEASE).decode().strip()==image,'loaded_image_id')
        names=execute('docker','ps','-a','--format','{{.Names}}').decode().splitlines()
        new=None
        try:
            if NAME not in names:
                v=os.statvfs('/var/lib/docker')
                need(port() and memory()>=8*GIB and v.f_bavail*v.f_frsize>=16*GIB,'dark_capacity')
                new=launch(image,build)
            prior=identity(inspect(NAME),image,build)
            ready()
            count=canary()
            need(snapshots()==before and identity(inspect(NAME),image,build)==prior and memory()>=4*GIB,'dark_readback')
            print(json.dumps({'status':'dark_grid_verified_only','release':RELEASE,'image':image,'generation':GEN,'total':TOTAL,'distinctSample':count,'currentGateway':APP,'nginxSha256':NGINX,'expectedNginxPostimageSha256':expected_postimage_sha(),'containerId':prior[0],'storageWritesByActor':0,'ingressChanged':False}))
        except BaseException:
            # Never stop an adopted, foreign, incumbent, or rollback process.
            if new is not None:
                try: execute('docker','stop','--time','3',new)
                except Exception: pass
            raise
if __name__=='__main__':
    try:
        need(len(sys.argv)==3,'argument_scope')
        main(*sys.argv[1:])
    except Exception as e:
        code=str(e)
        print(json.dumps({'status':'dark_gate_unverified','gate':code if type(e) is RuntimeError and re.fullmatch('[a-z_]+',code) else 'host_operation'}))
        sys.exit(1)
