"""Read only. Approved installed-image/ingress gates plus stdin JS file probe."""
import hashlib
import http.client
import json
import os
import re
import secrets
import socket
import ssl
import stat
import subprocess
import sys

HOST = 'avtocena.com'
CONFIG = '/etc/nginx/conf.d/avtocena-prepare.conf'
NGINX = 'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
CANDIDATE = '52e44ba2810796f9a12ac83984d9571f71ac1290d852206d2a259ad44da02a8d'
IMAGE = 'sha256:8a7326fc17de9a28ae66a4915e68038ac089ba4cdf2954bd7fcbd7cbda46ccf8'
RELEASE = '22867cbcfaee27b2e8917b6bf880e44827f67b60'
CALC = '4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'
PROBE_SHA='e6bb219feec654d9b3b4432b166b27f8f3f362bef84b7fac77e00c22713db850'
INDEX='bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b'

def need(check,reason):
    if not check: raise RuntimeError(reason)

class Gateway(http.client.HTTPSConnection):
    def connect(self):
        raw=socket.create_connection(('127.0.0.1',443),timeout=self.timeout)
        self.sock=self._context.wrap_socket(raw,server_hostname=HOST)

def health(kind):
    if kind == 'gateway': conn=Gateway(HOST,timeout=5,context=ssl.create_default_context())
    elif kind == 'public': conn=http.client.HTTPSConnection(HOST,timeout=5,context=ssl.create_default_context())
    else: conn=http.client.HTTPConnection('127.0.0.1',3002,timeout=5)
    try:
        conn.request('GET','/api/health?avtocenaReleaseProbe='+secrets.token_hex(10),headers={
            'Host':HOST,'Cache-Control':'no-cache, no-store','Accept-Encoding':'identity','Connection':'close'})
        r=conn.getresponse()
        b=r.read(8193)
        need(r.status==200 and len(b)<=8192,'health_not_ok')
        d=json.loads(b)
        need(d.get('ok') is True and d.get('releaseSha')==RELEASE and d.get('calculationVersion')==CALC,'health_release_mismatch')
    finally:conn.close()

def digest(b): return hashlib.sha256(b).hexdigest()

def config():
    fd=os.open(CONFIG,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1,'nginx_config_shape')
        with os.fdopen(fd,'rb',closefd=False) as f: b=f.read(1048577)
    finally: os.close(fd)
    need(len(b)<=1048576 and digest(b)==NGINX,'nginx_digest_mismatch')
    ports=re.findall(rb'(?m)^[\t ]*proxy_pass[\t ]+http://127\.0\.0\.1:(300[02]);[\t ]*$',b)
    need(ports==[b'3002'],'nginx_target_mismatch')

def docker(args,b=None,timeout=5):
    result=subprocess.run(['/usr/bin/docker',*args],input=b,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=timeout,check=True)
    need(len(result.stdout)<=16384,'docker_response_budget')
    return result.stdout

def identity():
    fmt='{{json .Id}} {{json .Image}} {{json .State.Running}} {{json .State.Pid}} {{json .NetworkSettings.Ports}}'
    value=docker(['inspect','--type','container','--format',fmt,CANDIDATE]).decode().strip()
    parser=json.JSONDecoder(); got=[]
    for _ in range(5):
        item,end=parser.raw_decode(value);got.append(item);value=value[end:].lstrip()
    need(not value and got[0]==CANDIDATE and got[1]==IMAGE and got[2] is True and isinstance(got[3],int) and got[3]>0,'candidate_identity_mismatch')
    need(got[4].get('3000/tcp')==[{'HostIp':'127.0.0.1','HostPort':'3002'}],'candidate_loopback_binding_mismatch')
    return got[3]

def main():
    b=sys.stdin.buffer.read(16385)
    need(len(b)<=16384 and digest(b)==PROBE_SHA,'probe_source_mismatch')
    config(); pid=identity()
    for where in ('direct','gateway','public'):health(where)
    data=json.loads(docker(['exec','-i',CANDIDATE,'node','--max-old-space-size=384','--input-type=module','-',
                           '--fixed-installed-file'],b,timeout=25))
    need(data.get('status')=='bound_installed_index_structural_availability_only' and data.get('release')==RELEASE and
         data.get('indexDigest')==INDEX and data.get('publicationAllowed') is False,'technical_readback_unverified')
    config()
    need(identity()==pid,'candidate_changed_during_probe')
    health('gateway')
    print(json.dumps(data|{'servingCandidateVerified':True,'ingressUpstream':3002,'knownActivationRun':44732171258,
                           'verifiedPublicAndLoopbackReleaseHealth':True,'nginxDigestMatched':True},separators=(',',':')))

if __name__=='__main__':
    try: main()
    except Exception as e:
        safe={'nginx_config_shape','nginx_digest_mismatch','nginx_target_mismatch','candidate_identity_mismatch',
              'candidate_loopback_binding_mismatch','probe_source_mismatch','health_not_ok','health_release_mismatch',
              'technical_readback_unverified','candidate_changed_during_probe','docker_response_budget'}
        reason=str(e) if type(e) is RuntimeError and str(e) in safe else 'unavailable_or_timeout'
        print(json.dumps({'status':'installed_UAE_probe_inconclusive','reason':reason,'publicationAllowed':False}))
        sys.exit(1)
