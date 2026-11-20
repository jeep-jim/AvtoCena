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
            print(json.dumps({'status':'dark_grid_verified_only','release':RELEASE,'image':image,'generation':GEN,'total':TOTAL,'distinctSample':count,'currentGateway':APP,'nginxSha256':NGINX,'containerId':prior[0],'storageWritesByActor':0,'ingressChanged':False}))
        except BaseException:
            # Never stop an adopted, foreign, incumbent, or rollback process.
            if new is not None:
                try: execute('docker','stop','--time','3',new)
                except Exception: pass
            raise

"""Pure gateway transaction core. No CLI, SSH, Docker, storage or supplier access."""
import hashlib
import re

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def require(value, reason):
    if not value:
        raise RuntimeError(reason)

def postimage(before):
    pattern=rb'(?m)^([\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:)3000(;[\t ]*)$'
    after,n=re.subn(pattern,rb'\g<1>3002\g<2>',before)
    require(n==1,'ambiguous_gateway_upstream')
    return after

def cut(io, pivot):
    """Under existing runtime lock; io methods must implement reviewed host gates."""
    before=io.read_config()
    require(sha(before)==pivot['nginxBeforeSha256'],'gateway_preimage')
    after=postimage(before)
    require(sha(after)==pivot['nginxAfterSha256'],'gateway_postimage')
    io.identities()
    io.health('gateway','incumbent')
    io.health('public','incumbent')
    baseline=io.protected('incumbent')
    io.health('candidate','candidate')
    io.grid('candidate')
    require(io.protected('candidate')==baseline,'protected_dark_parity')
    io.backup_exclusive(before,after)
    io.identities()
    require(io.read_config()==before,'foreign_pre_switch')
    try:
        io.persist_policy()
        io.identities()
        io.replace(after,sha(before))
        io.test_and_reload()
        io.health('gateway','candidate')
        io.health('public','candidate')
        io.grid('gateway')
        io.grid('public')
        require(io.protected('public')==baseline,'protected_public_parity')
        io.identities()
        require(io.read_config()==after,'foreign_post_switch')
        io.record_success()
    except BaseException:
        current=io.read_config()
        require(current in (after,before),'rollback_refused_foreign_gateway')
        if current==after: io.replace(before,sha(after))
        io.test_and_reload()
        io.health('gateway','incumbent')
        io.health('public','incumbent')
        require(io.read_config()==before,'incumbent_restore_config')
        io.revert_policy()
        io.identities()
        io.record_rollback()
        raise

import concurrent.futures, secrets, signal, tempfile
from pathlib import Path
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
def grid(where):
    # Reuse exact dark validator, injecting only the target. Calls synchronous, no concurrent use.
    g=canary.__globals__
    old=(g['getjson'],g['fetch'])
    try:
        g['getjson']=lambda p:json.loads(raw_ok(where,p,1024*1024))
        g['fetch']=lambda p,n:raw_ok(where,p,n)
        need(canary()==48,'ordinary_grid')
    finally:g['getjson'],g['fetch']=old
def sample(where):
    q=urllib.parse.urlencode({'market':'china','make':'BMW','model':'X3','sort':'totalRub','pageSize':1,'preparedCut':GEN})
    v=json.loads(raw_ok(where,'/api/catalog/search?'+q,256*1024))
    rows=v.get('items')
    need(v.get('ok') is True and v.get('generationId')==GEN and type(v.get('total')) is int and v['total']>0 and isinstance(rows,list) and len(rows)==1,'bmw_list')
    r=rows[0];rid=r.get('id');price=r.get('totalRub')
    need(r.get('market')=='china' and isinstance(rid,str) and re.fullmatch(ID,rid) and type(price) is int and price>0,'bmw_price')
    prefix='/cars/offer/'+rid
    query=urllib.parse.urlencode({'market':'china','preparedCut':GEN})
    status,loc,body=request(where,prefix+'?'+query,4*1024*1024)
    if status in (307,308):
        u=urllib.parse.urlsplit(urllib.parse.urljoin('https://'+HOSTNAME,loc or ''))
        need(u.scheme=='https' and u.netloc==HOSTNAME and not u.fragment and re.fullmatch(prefix+r'/[a-z0-9-]{1,160}',u.path) and
             sorted(urllib.parse.parse_qsl(u.query,keep_blank_values=True))==[('market','china'),('preparedCut',GEN)],'bmw_redirect')
        status,_,body=request(where,u.path+'?'+u.query,4*1024*1024)
    tags=re.findall(rb'<main\b[^>]*\bdata-offer-id="[^"]+"[^>]*>',body)
    need(status==200 and b'</html>' in body and b'$RX(' not in body and len(tags)==1 and
         (' data-offer-id="'+rid+'"').encode() in tags[0] and (' data-offer-price-rub="'+str(price)+'"').encode() in tags[0],
         'bmw_detail_price')
    return v['total'],rid,price
def protected(where):
    def one(m):
        p='/api/catalog/search?'+urllib.parse.urlencode({'market':m,'pageSize':2,'sort':'updatedAt'})
        v=json.loads(raw_ok(where,p,256*1024))
        rows=v.get('items')
        need(v.get('ok') is True and not v.get('partial') and type(v.get('total')) is int and v['total']>0 and
             isinstance(rows,list) and 0<len(rows)<=2 and all(r.get('market')==m and isinstance(r.get('id'),str) and
             type(r.get('totalRub')) is int and r['totalRub']>0 for r in rows),'protected_parity_sample')
        return (m,v['total'],tuple((r['id'],r['totalRub'],r.get('calculationStatus')) for r in rows))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:return tuple(ex.map(one,NEIGHBORS))
def fsync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def write_x(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    fsync_dir(path.parent)
def read_regular():
    fd=os.open(CONFIG,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as f:
        s=os.fstat(f.fileno())
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1,'config_metadata')
        raw=f.read(1048577)
    need(len(raw)<=1048576,'config_bound')
    return raw,s
def command(*args):
    p=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20,check=True)
class IO:
    def __init__(self,run,image,cid,digest_after):
        self.image=image;self.cid=cid;self.initial=None;self.comparison=None;self.policy="no";self.policy_attempted=False
        self.rollback_dir=Path('/opt/avtocena/releases')/APP/('china-ui-ingress-'+run+'-1')
        self.after=digest_after
    def read_config(self):return read_regular()[0]
    def identities(self):
        held=[]
        for r in ROLE:
            v=role(r);v.pop('mainRssBytes')
            need(v['exact'],'incumbent_role')
            held.append(v)
        d=inspect(NAME)
        pid=identity(d,self.image,BASELINE_CALC,self.policy)
        need(pid[0]==self.cid,'candidate_id')
        shape=(held,pid)
        if self.initial is None:self.initial=shape
        else:need(shape==self.initial,'process_identity_changed')
    def apply_policy(self,policy):
        p=subprocess.run(['docker','update','--restart',policy,self.cid],stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,timeout=12,check=True)
    def persist_policy(self):
        self.identities()
        self.policy_attempted=True
        self.apply_policy('unless-stopped')
        self.policy='unless-stopped'
        self.identities()
    def revert_policy(self):
        if not self.policy_attempted:return
        d=inspect(NAME)
        observed=d['HostConfig']['RestartPolicy']['Name']
        need(observed in ('no','unless-stopped'),'foreign_restart_policy')
        need(identity(d,self.image,BASELINE_CALC,observed)==self.initial[1],'candidate_modified_before_policy_revert')
        if observed!='no':self.apply_policy('no')
        self.policy='no'
        self.identities()
    def health(self,where,role_name):
        expect={'incumbent':APP,'candidate':RELEASE}[role_name]
        deadline=time.monotonic()+20
        for _ in range(5):
            try:
                v=json.loads(raw_ok(where,'/api/health?avtocenaReleaseProbe='+secrets.token_hex(10),8192))
                if v.get('ok') is True and v.get('releaseSha')==expect and v.get('calculationVersion')==CALC:return
            except (OSError,RuntimeError,ValueError):pass
            if time.monotonic()>=deadline:break
            time.sleep(0.4)
        raise RuntimeError('exact_health_unverified')
    def grid(self,where):
        grid(where);got=sample(where)
        if self.comparison is None:
            need(where=='candidate','dark_golden_required')
            self.comparison=got
        else:need(got==self.comparison,'bmw_public_parity')
    def protected(self,where):return protected(where)
    def backup_exclusive(self,before,after):
        parent=self.rollback_dir.parent
        need(parent.resolve()==parent and parent.is_dir() and os.stat(parent).st_uid==0,'receipt_parent')
        self.rollback_dir.mkdir(mode=0o700)
        write_x(self.rollback_dir/'nginx.before',before)
        write_x(self.rollback_dir/'expect.json',json.dumps(dict(before=sha(before),after=sha(after),candidateId=self.cid,candidateProcess=self.initial[1],policyBefore='no',policyAfter='unless-stopped',release=RELEASE,image=self.image)).encode())
        fsync_dir(parent)
    def replace(self,data,expected):
        before,s=read_regular()
        need(sha(before)==expected,'foreign_preimage')
        parent=Path(CONFIG).parent
        with tempfile.NamedTemporaryFile(dir=parent,prefix='.avtocena-ui-',delete=False) as f:
            tmp=Path(f.name)
            try:
                os.fchmod(f.fileno(),stat.S_IMODE(s.st_mode));os.fchown(f.fileno(),s.st_uid,s.st_gid)
                f.write(data);f.flush();os.fsync(f.fileno())
                need(sha(self.read_config())==expected,'foreign_preimage_race')
                os.replace(tmp,CONFIG);fsync_dir(parent)
            finally:tmp.unlink(missing_ok=True)
    def test_and_reload(self):command('/usr/sbin/nginx','-t');command('/usr/bin/systemctl','reload','nginx')
    def record_success(self):
        v={'status':'china_grid_ingress_verified','release':RELEASE,'generation':GEN,'total':TOTAL,'image':self.image,'candidateId':self.cid,'nginxSha256':self.after,'candidateRestartPolicy':'unless-stopped','catalogWritesByActor':0}
        write_x(self.rollback_dir/'ingress.json',json.dumps(v).encode());print(json.dumps(v),flush=True)
    def record_rollback(self):
        v={'status':'china_grid_ingress_rolled_back','release':APP,'nginxSha256':READ_PREIMAGE,'candidateRestartPolicy':self.policy,'catalogWritesByActor':0}
        write_x(self.rollback_dir/'rollback.json',json.dumps(v).encode());print(json.dumps(v),flush=True)
def run(runid,image,cid,after):
    need(re.fullmatch(r'[0-9]{1,20}',runid) and re.fullmatch(r'sha256:[a-f0-9]{64}',image) and
         re.fullmatch('[a-f0-9]{64}',cid) and re.fullmatch('[a-f0-9]{64}',after),'launch_pins')
    with open('/run/lock/avtocena-runtime-change.lock','r') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        def interrupted(signum,frame):
            for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,signal.SIG_IGN)
            raise RuntimeError('ingress_interrupted')
        for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,interrupted)
        cut(IO(runid,image,cid,after),dict(nginxBeforeSha256=READ_PREIMAGE,nginxAfterSha256=after))
if __name__=='__main__':
    try:
        need(len(sys.argv)==5,'argument_scope')
        run(*sys.argv[1:])
    except Exception as err:
        r=str(err)
        print(json.dumps({'status':'china_grid_ingress_unverified','gate':r if type(err) is RuntimeError and re.fullmatch('[a-z_]+',r) else 'host_operation'}),flush=True)
        sys.exit(1)
