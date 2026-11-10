#!/usr/bin/env python3
"""Bounded anonymous reads; no restart, settings, stored data or supplier requests."""
import json, subprocess, re, time, urllib.request, urllib.error


def command(args, timeout=10):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True).stdout.strip()

port = command(['docker', 'inspect', '--format', '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}', 'avtocena-production'])
assert re.fullmatch(r'[0-9]{2,5}', port)
local = 'http://127.0.0.1:' + port
state = command(['docker', 'inspect', '--format', 'running={{.State.Running}} oomKilled={{.State.OOMKilled}} restarts={{.RestartCount}}', 'avtocena-production'])
print('BLOG_RUNTIME', state, flush=True)
print('BLOG_RESOURCES_BEFORE', command(['docker','stats','--no-stream','--format','memory={{.MemUsage}} cpu={{.CPUPerc}}','avtocena-production']), flush=True)
for name, base, path in [('local-health',local,'/api/health'),('local-blog-cold',local,'/blog'),('local-blog-repeat',local,'/blog'),('public-health','https://avtocena.com','/api/health'),('public-blog','https://avtocena.com','/blog')]:
    start=time.monotonic()
    result={'sample':name,'path':path}
    try:
        req=urllib.request.Request(base+path, headers={'Host':'avtocena.com','User-Agent':'AvtoCena-Owner-Incident-Read/1.0','Accept-Encoding':'identity'})
        with urllib.request.urlopen(req, timeout=15) as response:
            result.update(status=response.status,headersSeconds=round(time.monotonic()-start,3))
            body=bytearray()
            while True:
                part=response.read(65536)
                if not part: break
                body.extend(part)
                if len(body)>4*1024*1024: raise ValueError('response_size_bound')
                if time.monotonic()-start>20: raise TimeoutError('total_deadline')
            result['bytes']=len(body)
            if path=='/api/health':
                health=json.loads(body)
                result.update(ok=health.get('ok'),releaseSha=health.get('releaseSha'))
            else:
                html=body.decode('utf-8')
                result.update(blogHeading='Автоблог</h1>' in html,incompleteStream='</html>' not in html or '$RX(' in html)
    except Exception as exc:
        result['error']=type(exc).__name__
    result['seconds']=round(time.monotonic()-start,3)
    print('BLOG_LATENCY',json.dumps(result,ensure_ascii=False),flush=True)
print('BLOG_RESOURCES_AFTER',command(['docker','stats','--no-stream','--format','memory={{.MemUsage}} cpu={{.CPUPerc}}','avtocena-production']),flush=True)
