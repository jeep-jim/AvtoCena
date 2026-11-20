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
if __name__=='__main__':raise SystemExit(main())
