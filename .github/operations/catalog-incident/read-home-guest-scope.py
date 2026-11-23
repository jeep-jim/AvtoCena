"""Read guest completeness at the retained origin and check the previous unrouted candidate."""
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import socket
import time

GATEWAY = Path('/etc/nginx/conf.d/avtocena-prepare.conf')
GATEWAY_DIGEST = 'b55e61e9686c639d9f0deac678b881ec56633e1cfd2b4703084b0ad9aaecaf6f'
RETAINED = '22867cbcfaee27b2e8917b6bf880e44827f67b60'
CANDIDATE_ID = '332b590b7a1582797fb763bb6289e44534f42648044f1eb70600ea9a08f29396'
assert hashlib.sha256(GATEWAY.read_bytes()).hexdigest() == GATEWAY_DIGEST
parts = os.environ['SSH_CONNECTION'].split()
assert len(parts) == 4 and ipaddress.ip_address(parts[0]).is_global

def guest(path, peer):
    connection = http.client.HTTPConnection('127.0.0.1', 3002, timeout=48)
    try:
        headers = {'Host':'avtocena.com','Accept-Encoding':'identity','Cache-Control':'no-cache','Connection':'close'}
        if peer:
            headers['X-Real-IP'] = parts[0]
        connection.request('GET', path, headers=headers)
        response = connection.getresponse()
        data = response.read(8 * 1024**2 + 1)
        assert response.status == 200 and len(data) <= 8 * 1024**2
        return json.loads(data)
    finally:
        connection.close()

def identity():
    assert guest('/api/health', False)['releaseSha'] == RETAINED
    assert hashlib.sha256(GATEWAY.read_bytes()).hexdigest() == GATEWAY_DIGEST

def presence():
    class Docker(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(8)
            self.sock.connect('/var/run/docker.sock')
    conn = Docker('localhost', timeout=8)
    try:
        conn.request('GET','/containers/' + CANDIDATE_ID + '/json')
        res = conn.getresponse()
        assert res.status in (200,404)
        return res.status
    finally:
        conn.close()

identity()
start = time.time()
result = {'readOnly':True,'retained':RETAINED,'candidateId':CANDIDATE_ID,'dockerStatus':presence(),'sample':[]}
for peer in [False,True]:
    home = guest('/api/catalog/home', peer)
    result['sample'].append({'realGuestPeer':peer,'total':home.get('total'),'items':len(home.get('items',[])),
        'incomplete':home.get('countIncomplete'),'partial':home.get('partial'),'marketCounts':home.get('marketCounts',{}),
        'generation':home.get('generationId'),'japanCountAvailable':bool((home.get('marketCountInfo') or {}).get('japan'))})
identity()
assert presence() == result['dockerStatus']
result['finishedAt'] = int(time.time())
result['elapsedSeconds'] = round(time.time()-start,2)
print(json.dumps(result))
