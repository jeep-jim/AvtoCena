"""Final one-line ingress transaction; no catalog writes, container lifecycle or global settings."""
import concurrent.futures
import contextlib
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode, urljoin, urlsplit, parse_qsl

APP='85296f6b8797aaa93227b69da7e9e9e928e8f9b5'
OLD='83ff17075e9188dcf227c8752dc064248d5f42e0'
CALC='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
CANDIDATE='avtocena-china-candidate-85296f6b8797'
NEW_IMAGE='sha256:0bfe542a991a69aaa4f416726a221e4e845986cc15c98a414e24ea7cff462984'
OLD_IMAGE='sha256:4a055ba772496c7de89594acbbc1c1bc02ac2d2b20050cfad7f637d1f5646dfd'
NEW_PORT=3000
OLD_PORT=3001
HOST='avtocena.com'
RELEASE_ROOT=Path('/opt/avtocena/releases')/APP
CONFIG=Path('/etc/nginx/conf.d/avtocena-prepare.conf')
LOCK='/run/lock/avtocena-runtime-change.lock'
MAX_CONFIG=1024*1024
PERSISTED_PRIOR_RUN='44724452099'
PERSISTED_EXPECT_SHA='a3a8a51449b1c2357bb2b43d7eaeaf426de5d5561a9076b2514bde049d1fd658'
SHA=r'[a-f0-9]{64}'
ID=r'[a-f0-9]{24}'
GEN=r'gen_\d{13}_[a-z0-9]{1,64}'
NEIGHBORS=('korea','uae','europe','georgia')
def now_ms():return int(time.time()*1000)
def digest(data):return hashlib.sha256(data).hexdigest()
def need(ok,code):
    if not ok:raise Refused(code)
class Refused(Exception):pass
class HealthReleaseRefused(Refused):
    def __init__(self,evidence):
        super().__init__('https_release')
        self.evidence=evidence
        self.logged=False
    def log(self):
        if not self.logged:
            self.logged=True
            print(json.dumps({'status':'china_ingress_health_mismatch',**self.evidence}),file=sys.stderr,flush=True)

def positive(value,upper=10**9):return type(value) is int and 0<value<=upper
def match(value,regex):return isinstance(value,str) and bool(re.fullmatch(regex,value))
def title(value):
    return isinstance(value,str) and value==value.strip() and 0<len(value)<=80 and value.isprintable() and ',' not in value and '|' not in value

def exact_card_uri(o,gen):
    prefix='/cars/offer/'+o['cardId']
    route=o.get('canonicalCardUri')
    need(isinstance(route,str) and 1<=len(route)<=1024 and route.startswith(prefix+'/'),'live_card_uri')
    parsed=urlsplit(route)
    need(not parsed.scheme and not parsed.netloc and not parsed.fragment and
         match(parsed.path,re.escape(prefix)+r'/[a-z0-9-]{1,160}') and
         sorted(parse_qsl(parsed.query,keep_blank_values=True))==[('market','china'),('preparedCut',gen)],'live_card_uri')
    return route

def plan_valid(p,now):
    need(p.get('version')==1 and p.get('kind')=='china-final-ingress-v1' and
         [p.get(k) for k in ('appSha','previousSha','protectedCalc','candidateImage','oldImage','oldPort','candidatePort')]==
         [APP,OLD,CALC,NEW_IMAGE,OLD_IMAGE,OLD_PORT,NEW_PORT] and
         all(match(p.get(k),SHA) for k in ('oldContainerId','candidateContainerId','nginxBeforeSha256','controlReaderSha256','darkPlanSha256')) and
         p['oldContainerId']!=p['candidateContainerId'] and positive(p.get('expiresAt'),10**14) and
         now<p['expiresAt']<=now+480_000 and p.get('authorizesIngress') is True and p.get('authorizesDataWrite') is False,'ingress_plan')
    need(match(p.get('githubRunId'),r'[1-9][0-9]{0,19}') and p.get('controlNode') in ('system','private') and
         match(p.get('controlReaderFile'),r'[A-Za-z0-9_-]+\.mjs') and
         match(p.get('darkPlanFile'),r'[A-Za-z0-9_-]+\.json'),'control_actor_paths')
    c=p.get('control',{})
    need(set(c)=={'checksum','etag','revision','generationId','readySha256'} and match(c.get('checksum'),SHA) and
         match(c.get('readySha256'),SHA) and match(c.get('etag'),r'[\x21-\x7e]{1,150}') and
         positive(c.get('revision')) and match(c.get('generationId'),GEN),'control_binding')
    d=p.get('dark',{})
    need(d.get('status')=='china_dark_control_verified' and d.get('controlSha256')==c['checksum'] and
         d.get('generationId')==c['generationId'] and d.get('runtimeRelease')==APP and
         d.get('publicIngressChanged') is False and d.get('cursorAdvanced') is False,'dark_receipt')
    o=p.get('ordinary',{})
    need(o.get('version')==1 and o.get('kind')=='normal-china-runtime-readback' and o.get('readySha256')==c['readySha256'] and
         o.get('generationId')==c['generationId'] and o.get('buildSha256')==NEW_IMAGE.removeprefix('sha256:') and
         positive(o.get('checkedAt'),10**14) and 0<=now-o['checkedAt']<=180000 and match(o.get('cardId'),ID) and
         positive(o.get('listRub')) and o.get('listRub')==o.get('detailRub') and positive(o.get('filteredCount')),'ordinary_receipt')
    exact_card_uri(o,c['generationId'])
    if 'persistedCandidateProof' in p:
        proof=p['persistedCandidateProof']
        need(isinstance(proof,dict) and set(proof)=={'priorRunId','expectSha256'} and
             proof['priorRunId']==PERSISTED_PRIOR_RUN and proof['expectSha256']==PERSISTED_EXPECT_SHA and
             c['revision']==5,'persisted_candidate_authority')
    need(title(p.get('make')) and title(p.get('model')),'model_scope')
    return p

def changed_config(before):
    locations=list(re.finditer(rb'^  location / \{\r?\n[\s\S]*?^  \}',before,re.M))
    need(len(locations)==1,'single_app_location')
    loc=locations[0]
    old=b'    proxy_pass http://127.0.0.1:3001;'
    new=b'    proxy_pass http://127.0.0.1:3000;'
    need(loc.group().splitlines().count(old)==1 and new not in loc.group() and
         len(re.findall(rb'^\s*proxy_pass\s+',loc.group(),re.M))==1,'exact_app_upstream')
    return before[:loc.start()]+loc.group().replace(old,new)+before[loc.end():]

def verify_container(d,p,candidate):
    normal='1' if candidate else None
    cid=p['candidateContainerId' if candidate else 'oldContainerId']
    image=NEW_IMAGE if candidate else OLD_IMAGE
    rev=APP if candidate else OLD
    name=CANDIDATE if candidate else 'avtocena-production'
    port=str(NEW_PORT if candidate else OLD_PORT)
    env=dict(v.split('=',1) for v in d.get('Config',{}).get('Env',[]) if '=' in v)
    bindings=d.get('HostConfig',{}).get('PortBindings')
    need(d.get('Id')==cid and d.get('Image')==image and d.get('Name')=='/'+name and d.get('State',{}).get('Running') is True and
         d.get('HostConfig',{}).get('Privileged') is False and
         d.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')==rev and
         bindings=={'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':port}]} and env.get('AVTOCENA_RELEASE_SHA')==rev and
         env.get('AVTOCENA_CALCULATION_VERSION')==CALC and
         (env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')==normal if candidate else env.get('AVTOCENA_CHINA_REGCLOUD_RUNTIME')!='1'),'container_fence')

def restart_identity(d,p):
    verify_container(d,p,True)
    state=d.get('State',{})
    process=(state.get('StartedAt'),state.get('Pid'),d.get('RestartCount'))
    need(match(process[0],r'[^\\s]{1,80}') and positive(process[1]) and type(process[2]) is int and process[2]>=0,
         'candidate_process_identity')
    policy=d.get('HostConfig',{}).get('RestartPolicy')
    need(policy in ({'Name':'no','MaximumRetryCount':0},{'Name':'unless-stopped','MaximumRetryCount':0}),
         'candidate_restart_policy_scope')
    return process,policy['Name']

def run(p,io):
    fresh=lambda:need(io.now()<p['expiresAt'],'plan_expired')
    def verify():
        verify_container(io.inspect('avtocena-production'),p,False)
        verify_container(io.inspect(CANDIDATE),p,True)
        need(io.control()==p['control'],'signed_control_changed')
    verify();fresh()
    initial_proc,initial_policy=restart_identity(io.inspect(CANDIDATE),p)
    persisted=p.get('persistedCandidateProof')
    need(initial_policy==('unless-stopped' if persisted else 'no'),'persisted_candidate_policy_changed' if persisted else 'candidate_not_dark_policy')
    before=io.read_config()
    need(digest(before)==p['nginxBeforeSha256'],'nginx_preimage')
    after=changed_config(before);next_sha=digest(after)
    if persisted:io.prove_persisted_policy(persisted,p['nginxBeforeSha256'],next_sha,initial_proc)
    io.gateway(OLD,'preflight')
    io.china('alternate',p)
    baseline=io.neighbors('old')
    need(baseline==io.neighbors('alternate'),'protected_before')
    verify();fresh();need(digest(io.read_config())==p['nginxBeforeSha256'],'nginx_raced')
    need(restart_identity(io.inspect(CANDIDATE),p)==(initial_proc,initial_policy),'candidate_dark_raced')
    io.backup(before,next_sha,initial_proc,initial_policy)
    policy_attempted=False
    gateway_attempted=False
    try:
        # This is a scoped Docker metadata update on the candidate's immutable
        # ID only. It must not start/stop/restart any container.
        if initial_policy=='no':
            policy_attempted=True
            io.update_policy(p['candidateContainerId'],'unless-stopped')
        need(restart_identity(io.inspect(CANDIDATE),p)==(initial_proc,'unless-stopped'),'candidate_policy_readback')
        verify();fresh()
        need(digest(io.read_config())==p['nginxBeforeSha256'],'nginx_raced')
        gateway_attempted=True
        io.replace(after,p['nginxBeforeSha256'])
        io.test();io.reload();io.gateway(APP,'candidate_reload')
        io.china('public',p)
        need(baseline==io.neighbors('public'),'protected_after')
        verify();fresh()
        need(restart_identity(io.inspect(CANDIDATE),p)==(initial_proc,'unless-stopped'),'candidate_policy_postimage')
        need(digest(io.read_config())==next_sha,'nginx_postimage')
        proof={'status':'china_public_ingress_verified','runtimeRelease':APP,'generationId':p['control']['generationId'],
                'controlSha256':p['control']['checksum'],'oldContainerRetained':True,'protectedCanariesUnchanged':True,
                'protectedMarketsReadback':{market:('preexisting_unavailable' if row[0]=='unavailable' else 'matched') for market,row in zip(NEIGHBORS,baseline)},
                'nginxBeforeSha256':p['nginxBeforeSha256'],'nginxAfterSha256':next_sha,
                'candidateRestartPolicy':'unless-stopped','candidateProcessUnchanged':True,'publicationDataWrites':0}
        io.record_success(proof)
        return proof
    except BaseException as first:
        if isinstance(first,HealthReleaseRefused):first.log()
        with io.rollback_mode():
            current=digest(io.read_config())
            need(current in (p['nginxBeforeSha256'],next_sha),'rollback_foreign_nginx')
            if current==next_sha:io.replace(before,next_sha)
            if gateway_attempted or current==next_sha:io.test();io.reload()
            verify_container(io.inspect('avtocena-production'),p,False)
            io.gateway(OLD,'rollback_reload')
            need(digest(io.read_config())==p['nginxBeforeSha256'],'rollback_nginx_hash')
            io.record_rollback({'status':'old_ingress_restored','runtimeRelease':OLD,
                                'nginxSha256':p['nginxBeforeSha256'],'doNotAssumeChinaControlRestored':True,
                                'candidateRestartPolicyRollbackPending':policy_attempted})
            if policy_attempted:
                # With old returning public traffic, no newer runtime owner can
                # race under this same lease. An unexpectedly restarted/replaced
                # container is not touched; its new policy must be reconciled.
                process,policy=restart_identity(io.inspect(CANDIDATE),p)
                need(process==initial_proc,'candidate_process_changed_during_rollback')
                if policy=='unless-stopped':io.update_policy(p['candidateContainerId'],'no')
                need(restart_identity(io.inspect(CANDIDATE),p)==(initial_proc,'no'),'candidate_rollback_policy_readback')
                io.record_policy_rollback({'status':'candidate_restart_policy_restored','policy':'no',
                                           'candidateProcessUnchanged':True})
        raise

def read_regular(file,cap):
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as stream:
        st=os.fstat(stream.fileno())
        need(stat.S_ISREG(st.st_mode) and 0<st.st_size<=cap,'read_bound')
        data=stream.read(cap+1)
        need(len(data)==st.st_size and len(data)<=cap,'read_size_changed')
        return data,st

def fsync_dir(path):
    fd=os.open(path,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def write_x(path,data):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    fsync_dir(path.parent)

def command(code,args,timeout=14):
    a=subprocess.run(args,capture_output=True,check=False,timeout=timeout)
    need(a.returncode==0 and len(a.stdout)<=256*1024,'host_'+code)
    return a.stdout

class LoopbackTLS(http.client.HTTPSConnection):
    def connect(self):
        raw=socket.create_connection(('127.0.0.1',443),self.timeout)
        self.sock=self._context.wrap_socket(raw,server_hostname=HOST)

def http_get(target,path,n,max_seconds=9):
    need(path.startswith('/') and not path.startswith('//'),'http_path')
    if target=='old':conn=http.client.HTTPConnection('127.0.0.1',OLD_PORT,timeout=max_seconds)
    elif target=='alternate':conn=http.client.HTTPConnection('127.0.0.1',NEW_PORT,timeout=max_seconds)
    elif target=='gateway':conn=LoopbackTLS(HOST,timeout=max_seconds,context=ssl.create_default_context())
    else:
        need(target=='public','http_target')
        conn=http.client.HTTPSConnection(HOST,timeout=max_seconds,context=ssl.create_default_context())
    try:
        conn.request('GET',path,headers={'Host':HOST,'Accept-Encoding':'identity','Cache-Control':'no-cache, no-store','Connection':'close'})
        answer=conn.getresponse()
        if answer.status in (307,308):return answer.status,answer.getheader('Location'),b''
        body=answer.read(n+1)
        need(len(body)<=n,'http_body_bound')
        return answer.status,None,body
    finally:conn.close()

def response_json(target,path,max_bytes=1024*1024):
    code,_,raw=http_get(target,path,max_bytes)
    return code,json.loads(raw)

def release_role(sha):
    return 'candidate' if sha==APP else 'incumbent' if sha==OLD else 'other' if isinstance(sha,str) else 'missing'

def health_sample(target,release,phase,attempt,max_seconds,cache_bust=False):
    expected=release_role(release)
    evidence={'phase':phase,'endpoint':target,'expectedRelease':expected,'observedRelease':'missing',
              'calculationNamespace':'missing','httpStatus':None,'attempt':attempt,'category':'transport'}
    # Fresh connections already avoid Nginx keep-alive. After HUP a unique
    # query also prevents an external cached answer satisfying the readiness gate.
    path='/api/health'
    if cache_bust:path+='?avtocenaReleaseProbe='+str(time.monotonic_ns())
    try:
        code,_,body=http_get(target,path,8192,max_seconds)
        evidence['httpStatus']=code if type(code) is int and 100<=code<=599 else None
        if code!=200:
            evidence['category']='http_status'
            return evidence
        v=json.loads(body)
        if not isinstance(v,dict) or v.get('ok') is not True or v.get('service')!='avtocena-web':
            evidence['category']='health_json'
            return evidence
        evidence['observedRelease']=release_role(v.get('releaseSha'))
        calc=v.get('calculationVersion')
        evidence['calculationNamespace']='expected' if calc==CALC else 'other' if isinstance(calc,str) else 'missing'
        evidence['category']='match' if evidence['observedRelease']==expected and calc==CALC else 'release_or_namespace'
    except TimeoutError:
        evidence['category']='timeout'
    except ssl.SSLError:
        evidence['category']='tls'
    except (UnicodeError,ValueError):
        evidence['category']='health_json'
    except (OSError,http.client.HTTPException):
        pass
    return evidence

def host_health(target,release,phase,settle=False,now=time.monotonic,sleep=time.sleep):
    # The existing deploy actor allows Nginx HUP to settle. Preserve strict
    # release and calculator identity; allow only the known previous release
    # or a bounded transient gateway status while a fresh worker starts.
    end=now()+8.0 if settle else None
    for attempt in range(1,6 if settle else 2):
        timeout=min(2.0,max(0.1,end-now())) if settle else 9
        e=health_sample(target,release,phase,attempt,timeout,cache_bust=settle)
        if e['category']=='match':
            if not settle:return
            # Passing a cache-busting readiness URL is insufficient: the
            # exact normal health URL must also report the same release.
            e=health_sample(target,release,phase,attempt,min(2.0,max(0.1,end-now())))
            if e['category']=='match':return
        pending=(e['category']=='release_or_namespace' and e['calculationNamespace']=='expected' and
                 e['observedRelease'] in ('candidate','incumbent')) or e['httpStatus'] in (502,503,504) or e['category']=='timeout'
        if not settle or not pending or attempt==5 or now()>=end:raise HealthReleaseRefused(e)
        sleep(min(0.4,max(0,end-now())))

def host_china(target,p):
    host_health(target,APP,target+'_china')
    o=p['ordinary']; gen=p['control']['generationId']
    query=urlencode({'market':'china','make':p['make'],'model':p['model'],'sort':'totalRub','pageSize':1,'preparedCut':gen})
    path='/api/catalog/search?'+query
    for tail,count in (('',False),('&countOnly=1',True)):
        status,v=response_json(target,path+tail)
        rows=v.get('items')
        need(status==200 and v.get('ok') is True and v.get('generationId')==gen and v.get('total')==o['filteredCount'] and
             isinstance(rows,list) and len(rows)==(0 if count else 1),'live_list_count')
        if not count:
            row=rows[0]
            need(row.get('market')=='china' and row.get('id')==o['cardId'] and row.get('totalRub')==o['listRub'] and
                 row.get('preparedChinaSelection',{}).get('generationId')==gen,'live_list_card')
    prefix='/cars/offer/'+o['cardId']
    route=exact_card_uri(o,gen)
    status,loc,html=http_get(target,route,4*1024*1024)
    if status in (307,308):
        url=urlsplit(urljoin('https://'+HOST+route,loc or ''))
        need(url.scheme=='https' and url.netloc==HOST and not url.fragment and
             match(url.path,re.escape(prefix)+r'/[a-z0-9-]{1,160}') and
             sorted(parse_qsl(url.query,keep_blank_values=True))==[('market','china'),('preparedCut',gen)],'live_card_redirect')
        status,_,html=http_get(target,url.path+'?'+url.query,4*1024*1024)
    root=re.findall(rb'<main\b[^>]*\bdata-offer-id="([^"]+)"[^>]*>',html)
    tags=re.findall(rb'<main\b[^>]*\bdata-offer-id="[^"]+"[^>]*>',html)
    need(status==200 and b'</html>' in html and b'$RX(' not in html and root==[o['cardId'].encode()] and
         (' data-offer-price-rub="'+str(o['detailRub'])+'"').encode() in tags[0],'live_ssr_card')

def neighbor_canaries(target):
    def one(m):
        # Explicit local-market canaries only, no Japan supplier call, no broad
        # data preparation. JP remains the existing exact on-demand code path.
        try:
            code,v=response_json(target,'/api/catalog/search?'+urlencode({'market':m,'pageSize':2,'sort':'updatedAt'}),256*1024)
        except TimeoutError:
            # Same preexisting timeout is reported as unverified for this
            # market, not healthy; a prior healthy gate cannot degrade.
            return ('unavailable','bounded_timeout')
        if code==503 and v.get('ok') is False:
            reason=v.get('reason') or v.get('error')
            need(match(reason,r'[a-z0-9_:-]{1,80}'),'protected_reason')
            return ('unavailable',reason)
        rows=v.get('items')
        need(code==200 and v.get('ok') is True and positive(v.get('total')) and not v.get('partial') and
             isinstance(rows,list) and 0<len(rows)<=2 and all(r.get('market')==m and isinstance(r.get('id'),str) for r in rows),'protected_sample')
        return (v['total'],tuple((r['id'],r.get('totalRub'),r.get('calculationStatus')) for r in rows))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return tuple(pool.map(one,NEIGHBORS))

class Host:
    now=staticmethod(now_ms)
    def __init__(self,plan):
        self.plan=plan
        need(os.environ.get('GITHUB_RUN_ID')==plan['githubRunId'] and os.environ.get('GITHUB_JOB')=='switch' and
             os.environ.get('GITHUB_RUN_ATTEMPT')=='1','host_job_scope')
        self.run_dir=RELEASE_ROOT/'china-switch-runs'/plan['githubRunId']
        need(self.run_dir.resolve()==self.run_dir,'host_job_dir')
        self.rollback=self.run_dir/'ingress-rollback'

    def inspect(self,name):return json.loads(command('docker_inspect',['docker','inspect',name]))[0]
    def control(self):
        bundle=self.run_dir/self.plan['controlReaderFile']
        dark_plan=self.run_dir/self.plan['darkPlanFile']
        if self.plan['controlNode']=='private':node=str(self.run_dir/'node')
        else:
            node=next((x for x in ('/usr/bin/node','/usr/local/bin/node') if Path(x).is_file()),None)
            need(node is not None,'control_system_node')

        need(digest(read_regular(bundle,8*1024*1024)[0])==self.plan['controlReaderSha256'] and
             digest(read_regular(dark_plan,16*1024)[0])==self.plan['darkPlanSha256'],'control_actor_bytes')
        need(command('node_version',[node,'--version']).strip()==b'v24.22.1','control_node_version')
        v=json.loads(command('signed_control',[node,str(bundle),'--read-control','--plan',str(dark_plan),
                   '--expect-plan-sha',self.plan['darkPlanSha256']],timeout=30))
        need(v.get('status')=='exact_dark_control' and v.get('storageWrites')==0,'control_actor_readonly')
        return {'checksum':v.get('controlSha256'),'etag':v.get('etag'),'revision':v.get('revision'),
                'generationId':v.get('generationId'),'readySha256':v.get('readySha256')}
    def read_config(self):return read_regular(CONFIG,MAX_CONFIG)[0]
    def gateway(self,release,phase):
        settle=phase in ('candidate_reload','rollback_reload')
        host_health('gateway',release,phase,settle=settle)
        host_health('public',release,phase,settle=settle)
    china=staticmethod(host_china)
    neighbors=staticmethod(neighbor_canaries)
    def prove_persisted_policy(self,proof,before_sha,after_sha,process):
        # Root-only retained receipt from the exact failed transaction. Never
        # infer this from Docker policy or reconstruct from today's image alone.
        folder=RELEASE_ROOT/'china-switch-runs'/PERSISTED_PRIOR_RUN/'ingress-rollback'
        file=folder/'expect.json'
        need(folder.resolve()==folder and file.resolve()==file,'persisted_candidate_path')
        body,st=read_regular(file,8192)
        need(st.st_uid==0 and st.st_nlink==1 and not st.st_mode&0o077 and
             digest(body)==proof['expectSha256'],'persisted_candidate_receipt')
        need(json.loads(body)=={'before':before_sha,'candidate':after_sha,
             'oldContainerId':self.plan['oldContainerId'],'candidateContainerId':self.plan['candidateContainerId'],
             'candidateProcess':list(process),'candidateRestartBefore':'no','candidateRestartAfter':'unless-stopped'},
             'persisted_candidate_process_or_baseline')
    def backup(self,before,expected_after,candidate_process,initial_policy):
        self.rollback.mkdir(mode=0o700,exist_ok=False)
        write_x(self.rollback/'nginx-before.conf',before)
        write_x(self.rollback/'expect.json',json.dumps({'before':digest(before),'candidate':expected_after,'oldContainerId':self.plan['oldContainerId'],
            'candidateContainerId':self.plan['candidateContainerId'],'candidateProcess':candidate_process,
            'candidateRestartBefore':initial_policy,'candidateRestartAfter':'unless-stopped'}).encode())
        fsync_dir(self.run_dir)
    def replace(self,data,expected_before):
        before,original=read_regular(CONFIG,MAX_CONFIG)
        need(digest(before)==expected_before,'nginx_changed')
        with tempfile.NamedTemporaryFile(prefix='.avtocena-prepare-',dir=CONFIG.parent,delete=False) as out:
            name=Path(out.name)
            try:
                os.fchmod(out.fileno(),stat.S_IMODE(original.st_mode));os.fchown(out.fileno(),original.st_uid,original.st_gid)
                out.write(data);out.flush();os.fsync(out.fileno())
                need(digest(self.read_config())==expected_before,'nginx_changed')
                os.replace(name,CONFIG)
                fsync_dir(CONFIG.parent)
            finally:name.unlink(missing_ok=True)
    def update_policy(self,cid,policy):
        need(cid==self.plan['candidateContainerId'] and policy in ('no','unless-stopped'),'policy_update_target')
        command('candidate_restart_policy',['docker','update','--restart',policy,cid],20)
    def test(self):command('nginx_test',['nginx','-t'])
    def reload(self):command('nginx_reload',['systemctl','reload','nginx'],20)
    @contextlib.contextmanager
    def rollback_mode(self):
        for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,signal.SIG_IGN)
        yield
    def record_rollback(self,record):write_x(self.rollback/'rollback.json',json.dumps(record).encode())
    def record_success(self,record):write_x(self.rollback/'ingress.json',json.dumps(record).encode())
    def record_policy_rollback(self,record):write_x(self.rollback/'candidate-policy-rollback.json',json.dumps(record).encode())

if __name__=='__main__':
    def interrupted(*_):raise Refused('interrupted')
    for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(s,interrupted)
    try:
        filename,expected=sys.argv[1:]
        blob,_=read_regular(Path(filename),16*1024)
        need(match(expected,SHA) and digest(blob)==expected,'plan_bytes')
        plan=plan_valid(json.loads(blob),now_ms())
        fd=os.open(LOCK,os.O_WRONLY|os.O_NOFOLLOW)
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            proof=run(plan,Host(plan))
            print(json.dumps(proof),flush=True)
        finally:os.close(fd)
    except BaseException as e:
        if isinstance(e,HealthReleaseRefused):e.log()
        print(json.dumps({'status':'china_ingress_not_verified','reason':str(e) if isinstance(e,Refused) else type(e).__name__}),file=sys.stderr,flush=True)
        raise SystemExit(2)
