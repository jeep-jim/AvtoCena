"""Verify a reviewed image-only marker, without reading credential values."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SHA = r'[a-f0-9]{40}'
DIGEST = r'[a-f0-9]{64}'
MARKER = '.github/market-runs/china-regcloud-reader-image-v1.json'
DIGEST_FIELDS = ('previousCalculator','candidateCalculator','privateIndexSha256','reviewedDeltaSha256')
PIN_FIELDS = ('appSha','previousSha')+DIGEST_FIELDS

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def parse(data):
    require(0 < len(data) <= 4096, 'marker_size')
    p = json.loads(data)
    require(isinstance(p,dict) and set(p)==set(PIN_FIELDS)|{'version','kind','mayLoadImage','mayActivate','mayPublishCatalog'},'marker_shape')
    require(type(p['version']) is int and p['version']==1 and p['kind']=='china-regcloud-reader-image-v1','marker_kind')
    require(type(p['mayLoadImage']) is bool and p['mayActivate'] is False and p['mayPublishCatalog'] is False,'image_only')
    require(all(isinstance(p[k],str) and re.fullmatch(SHA if k in PIN_FIELDS[:2] else DIGEST,p[k]) for k in PIN_FIELDS),'bad_pins')
    require(p['appSha'] != p['previousSha'],'same_code')
    return p

def approved_event(env):
    require(env.get('GITHUB_EVENT_NAME')=='push' and env.get('GITHUB_REF')=='refs/heads/main'
        and env.get('GITHUB_REPOSITORY')=='jeep-jim/AvtoCena' and env.get('GITHUB_RUN_ATTEMPT')=='1','wrong_workflow_actor')

def verify_checkout(p, root):
    def git(*args): return subprocess.check_output(['git','-C',str(root),*args])
    require(git('rev-parse','HEAD').decode().strip()==p['appSha'],'actual_checkout')
    require(not git('status','--porcelain','--untracked-files=all'),'working_tree_changed')
    delta=git('diff','--no-ext-diff','--raw','--no-renames','--abbrev=40','-z',p['previousSha'],p['appSha'],'--')
    require(bool(delta) and hashlib.sha256(delta).hexdigest()==p['reviewedDeltaSha256'],'unreviewed_application_delta')

def verify_protected(p, root):
    def git(*args): return subprocess.check_output(['git','-C',str(root),*args])
    closure=json.loads(Path(__file__).with_name('protected-runtime-files.json').read_bytes())
    require(isinstance(closure,list) and len(closure)==12,'protected_file_closure')
    for item in closure:
        name,blob=item['path'],item['identicalBlob']
        require(bool(re.fullmatch(r'apps/web/lib/catalog/[a-z-]+\.ts',name)) and bool(re.fullmatch(SHA,blob)),'protected_file_pin')
        require(all(git('rev-parse',revision+':'+name).decode().strip()==blob for revision in (p['previousSha'],p['appSha'])),'protected_cost_calculation_changed')
    for prefix in ('packages/engine','data','Dockerfile','package.json','package-lock.json'):
        require(git('rev-parse',p['previousSha']+':'+prefix)==git('rev-parse',p['appSha']+':'+prefix),'protected_engine_or_data_changed')


def equal_health(h,p):
    require(h.get('ok') is True and h.get('releaseSha')==p['previousSha']
        and h.get('calculationVersion')==p['previousCalculator'],'incumbent_changed')

def main():
    approved_event(os.environ)
    p=parse(Path(MARKER).read_bytes())
    mode,*args=sys.argv[1:]
    if mode=='outputs' and not args:
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:
            for k in PIN_FIELDS: print(f'{k}={p[k]}',file=f)
            print('mayLoadImage='+json.dumps(p['mayLoadImage']),file=f)
    elif mode=='checkout' and len(args)==1:
        verify_checkout(p,Path(args[0]))
        verify_protected(p,Path(args[0]))
    elif mode=='prior-health' and not args:
        equal_health(json.load(sys.stdin),p)
    else: raise ValueError('mode')

if __name__=='__main__':
    try: main()
    except Exception as e:
        raise SystemExit('OFF reader image preflight refused: '+(str(e) if type(e) is ValueError else type(e).__name__))
