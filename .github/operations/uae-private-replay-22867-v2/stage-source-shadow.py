"""Offline UAE-only, non-servable evidence package. No network/storage/control API."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile

HERE=Path(__file__).resolve().parent
_spec=importlib.util.spec_from_file_location('uae_exact_archive',HERE/'verify-archive-scope.py')
archive=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(archive)
NORMALIZED='990edf60121625b1426b96ff8660bf7d953157cc0fbcec8ef35a6ede3e1c83f6'
LIMIT_BYTES=1024*1024
MAX_ROWS=500

def canonical(x): return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(value): return hashlib.sha256(value).hexdigest()
def require(ok, code):
    if not ok: raise ValueError(code)
def project(key,o):
    require(o.get('market')=='uae' and o.get('sourceId')==archive.S and o.get('status')=='active'
      and str(o.get('sourceOfferId'))==key and re.fullmatch(r'[0-9]+',key)
      and isinstance(o.get('id'),str) and re.fullmatch(r'[a-f0-9]{24}',o['id']), 'uae_source_identity')
    p=o.get('sourcePrice')
    valid=type(p) in (int,float) and math.isfinite(p) and p>0 and o.get('sourceCurrency')=='AED'
    # Explicitly not an admission claim. Distinguish unsupported currency from true missing price.
    status='seller_aed_observation' if valid else 'price_not_observed' if p is None else 'price_unverified'
    def text(v):
        return v.strip() if isinstance(v,str) and len(v)<=256 else None
    return {'id':o['id'],'sourceOfferId':key,'market':'uae','sourceId':archive.S,
      'make':text(o.get('make')),'model':text(o.get('model')),
      'year':o.get('year') if type(o.get('year')) is int and 1886<=o['year']<=2027 else None,
      'sourceObservedAt':o.get('updatedAt'),'sourcePriceStatus':status,'sellerAed':p if valid else None,
      'archivedImageRefCount':len(o['images']) if isinstance(o.get('images'),list) else 0,
      'kind':'archived_source_observation'}

def load_exact(directory):
    rows={}
    for a in archive.A: asof,cursor=archive.replay(directory,a,rows)
    h=hashlib.sha256()
    for k in sorted(rows): h.update(canonical(rows[k])+b'\n')
    require((len(rows),h.hexdigest(),cursor,asof)==(27581,NORMALIZED,324989,'2026-11-19T23:40:39.128Z'),'uae_exact_source_scope')
    return rows,asof,cursor

def write_exclusive(path, body):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as out:
        out.write(body)
        out.flush()
        os.fsync(out.fileno())

def emit(rows, asof, cursor, parent, *, proof, fixture=False):
    records=sorted((project(k,o) for k,o in rows.items()),key=lambda x:x['id'])
    require(records and len({o['id'] for o in records})==len(records),'uae_unique_ids')
    require(fixture or (len(records)==27581 and proof==NORMALIZED and cursor==324989),'uae_exact_admission_input')
    # Fresh directory, mode 0700; no network-capable adapters and no current/activation pointer.
    path=Path(tempfile.mkdtemp(prefix='uae-source-shadow-',dir=parent))
    descriptors=[]
    for i in range(0,len(records),MAX_ROWS):
        chunk=records[i:i+MAX_ROWS]
        body=b''.join(canonical(x)+b'\n' for x in chunk)
        require(len(body)<=LIMIT_BYTES,'uae_chunk_size')
        name=f'rows-{i//MAX_ROWS:05d}.jsonl'
        write_exclusive(path/name,body)
        require((path/name).read_bytes()==body,'uae_chunk_readback')
        descriptors.append({'path':name,'sha256':sha(body),'bytes':len(body),'rows':len(chunk)})
    manifest={'version':1,'kind':'uae-source-evidence-shadow','market':'uae','coverage':'dubicars_only',
       'fixture':fixture,'observedThrough':asof,'cursorObserved':cursor,'normalizedSourceSha256':proof,
       'rows':len(records),'chunks':descriptors,'retainedPredecessorChanged':False,'exclusionsProven':False,
       'officialCurrentRatesProven':False,'photosProven':False,'admissionProven':False,
       'currentActiveBindingProven':False,'currentStockVerified':False,'servable':False,'publicationAllowed':False}
    manifest_body=canonical(manifest)
    digest=sha(manifest_body)
    write_exclusive(path/f'manifest-{digest}.json',manifest_body)
    verify(path,digest)
    return path,digest,manifest

def verify(path,digest):
    require(re.fullmatch(r'[a-f0-9]{64}',digest),'uae_manifest_digest_format')
    name=f'manifest-{digest}.json'
    body=(path/name).read_bytes(); require(sha(body)==digest,'uae_manifest_digest')
    manifest=json.loads(body)
    require(manifest['market']=='uae' and manifest['kind']=='uae-source-evidence-shadow' and manifest['coverage']=='dubicars_only'
       and manifest['version']==1 and all(manifest[k] is False for k in
        ('admissionProven','photosProven','currentActiveBindingProven','currentStockVerified','servable','publicationAllowed')),'uae_shadow_manifest')
    allids=[]
    for i,desc in enumerate(manifest['chunks']):
        require(desc['path']==f'rows-{i:05d}.jsonl' and 0<desc['bytes']<=LIMIT_BYTES,'uae_descriptor')
        block=(path/desc['path']).read_bytes()
        require(len(block)==desc['bytes'] and sha(block)==desc['sha256'],'uae_chunk_digest')
        lines=block.splitlines()
        require(0<len(lines)==desc['rows']<=MAX_ROWS,'uae_chunk_rows')
        for line in lines:
            row=json.loads(line)
            require(row.get('market')=='uae' and row.get('sourceId')==archive.S and row.get('kind')=='archived_source_observation','uae_shadow_row')
            allids.append(row['id'])
    require(set(p.name for p in path.iterdir())=={name,*(d['path'] for d in manifest['chunks'])}
        and len(allids)==len(set(allids))==manifest['rows'] and allids==sorted(allids),'uae_shadow_membership')
    return manifest

if __name__=='__main__':
    require(len(sys.argv)==3,'usage: stage-source-shadow.py ARCHIVE_DIR PRIVATE_LOCAL_PARENT')
    rows,asof,cursor=load_exact(Path(sys.argv[1]))
    path,digest,m=emit(rows,asof,cursor,Path(sys.argv[2]),proof=NORMALIZED)
    print(json.dumps({'scope':m['coverage'],'localDir':str(path),'manifestSha256':digest,
         'rows':m['rows'],'shards':len(m['chunks']),'observedThrough':m['observedThrough'],
         'servable':False,'publicationAllowed':False,'supplierCalls':0,'remoteWrites':0}))
