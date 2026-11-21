"""Exact local consumer of the November UAE evidence stage; no network, no output rows."""
from collections import Counter
import hashlib, importlib.util, json, os, pathlib, stat, sys

H='289930537687553b4d47d42936cc6c8ed009b1882862e573527d9208fb6b8c2f'
S=pathlib.Path(__file__).with_name('stage-source-shadow.py')
spec=importlib.util.spec_from_file_location('uae_shadow',S)
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
def check(ok,code):
    if not ok: raise ValueError(code)
def read(dirfd, name, limit):
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=dirfd)
    with os.fdopen(fd,'rb') as stream:
        s=os.fstat(stream.fileno())
        check(stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1
           and 0<s.st_size<=limit,'uae_private_regular_bounded')
        body=stream.read(limit+1)
        check(len(body)==s.st_size,'uae_input_changed')
        return body
def main(path,archive_path):
    rows,asof,cursor=stage.load_exact(pathlib.Path(archive_path))
    projected=sorted((stage.project(k,o) for k,o in rows.items()),key=lambda x:x['id'])
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        check(stat.S_IMODE(os.fstat(fd).st_mode)==0o700,'uae_private_directory')
        mn=f'manifest-{H}.json'; body=read(fd,mn,65536)
        check(stage.sha(body)==H,'uae_exact_manifest')
        m=json.loads(body); chunks=m['chunks']
        check(m['market']=='uae' and m['coverage']=='dubicars_only' and not m['fixture']
          and m['observedThrough']==asof and m['cursorObserved']==cursor and m['rows']==len(projected)
          and m['normalizedSourceSha256']==stage.NORMALIZED and len(chunks)==56
          and all(m[k] is False for k in ('publicationAllowed','servable','currentStockVerified','admissionProven','photosProven','currentActiveBindingProven')),
          'uae_exact_input_contract')
        names={mn}; combined=hashlib.sha256()
        for i,d in enumerate(chunks):
            name=f'rows-{i:05d}.jsonl'; names.add(name)
            expected=b''.join(stage.canonical(x)+b'\n' for x in projected[i*500:(i+1)*500])
            part=read(fd,name,stage.LIMIT_BYTES)
            check(part==expected and d==dict(path=name,sha256=stage.sha(part),bytes=len(part),rows=len(part.splitlines())),
               'uae_exact_projection_mismatch')
            combined.update(part)
        check(set(os.listdir(fd))==names,'uae_unexpected_files')
        return {'kind':'archived_input_only','rows':len(projected),'chunks':len(chunks),'observedThrough':asof,
           'cursorObserved':cursor,'manifestSha256':H,'projectionSha256':combined.hexdigest(),
           'priceObservations':dict(Counter(r['sourcePriceStatus'] for r in projected)),
           'archivedImageRefPresent':sum(r['archivedImageRefCount']>0 for r in projected),
           'photosVerified':False,'currentStockVerified':False,'admissionProven':False,'publicationAllowed':False,
           'externalCalls':0}
    finally: os.close(fd)
if __name__=='__main__':
    check(len(sys.argv)==3,'usage: check-source-shadow.py PRIVATE_LOCAL_SHADOW ARCHIVE_DIR')
    print(json.dumps(main(*sys.argv[1:]),indent=2,sort_keys=True))
