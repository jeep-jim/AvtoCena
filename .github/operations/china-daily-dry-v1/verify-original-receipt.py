#!/usr/bin/env python3
"""Verify existing collect-only terminal evidence and export only exact bounded bytes."""
import hashlib,json,os,pathlib,stat,sys,zipfile
RUN=44457059256
ARTIFACT=14500964905
ATTEMPT=1
REPO=1289722938
REV='038574d914de2436cd10871629b1b0a8fe83a92c'
ARCHIVE='b8a2a25dc27390845dd5a423efa323c9472a338b1b97f413ba96aefa7f3b65ca'
REPORT='894bb1eb1b37042de7ce611e19d8e33bfd58c01546d2a812f2c87f96cd906caf'
ZIP_SHA='c0802faab0b9ecc39e6d44b53d66f76c19cac485258f5ed2c80e5c2b59ac8097'
RECEIPT_SHA='174893f63c5870628a3df1ab3a5241fe49847f01fa579a84d80a369383c3c49a'
def need(ok):
    if not ok:raise ValueError('original_receipt_binding')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(path,cap):
    s=path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and 0<s.st_size<=cap)
    data=path.read_bytes()
    need(len(data)==s.st_size)
    return data
def verify(root):
    run=json.loads(read(root/'run.json',128*1024))
    meta=json.loads(read(root/'artifact.json',64*1024))
    need((run.get('id'),run.get('run_attempt'),run.get('head_sha'),run.get('head_branch'),run.get('event'),run.get('status'),run.get('conclusion'),run.get('path'))==
         (RUN,ATTEMPT,REV,'main','push','completed','success','.github/workflows/collect-china-ordinary-20261119.yml') and
         (run.get('repository',{}).get('id'),run.get('repository',{}).get('full_name'))==(REPO,'jeep-jim/AvtoCena'))
    zpath=root/'receipt.zip';raw=read(zpath,32*1024)
    wf=meta.get('workflow_run',{})
    need(meta.get('id')==ARTIFACT and meta.get('expired') is False and meta.get('digest')=='sha256:'+ZIP_SHA and
         (wf.get('id'),wf.get('head_branch'),wf.get('head_sha'),wf.get('repository_id'),wf.get('head_repository_id'))==(RUN,'main',REV,REPO,REPO) and
         meta.get('name')=='china-collection-receipt-44457059256-1' and meta.get('size_in_bytes')==len(raw) and sha(raw)==ZIP_SHA)
    with zipfile.ZipFile(zpath) as z:
        entries=z.infolist()
        need(len(entries)==1 and entries[0].filename=='own-storage-receipt.json' and not entries[0].is_dir() and
             0<entries[0].file_size<=16*1024 and stat.S_IFMT(entries[0].external_attr>>16) in (0,stat.S_IFREG))
        payload=z.read(entries[0])
    need(sha(payload)==RECEIPT_SHA)
    receipt=json.loads(payload)
    need(receipt.get('version')==1 and receipt.get('market')=='china' and receipt.get('root')=='catalog/nonjp-intake/v1/china/44457059256/1' and
         receipt.get('owner')=={'runId':str(RUN),'attempt':str(ATTEMPT),'revision':REV} and
         receipt.get('manifestSha256')==ARCHIVE and receipt.get('reportDigest')==REPORT)
    out=os.open(root/'original-receipt.json',os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    with os.fdopen(out,'wb') as f:f.write(payload)
if __name__=='__main__':
    try:
        root=pathlib.Path(sys.argv[1])
        need(root.is_absolute() and root.resolve()==root)
        verify(root)
        print('china_original_receipt_binding_verified')
    except (OSError,ValueError,KeyError,TypeError,zipfile.BadZipFile,IndexError):
        print('china_original_receipt_binding_refused',file=sys.stderr)
        raise SystemExit(1)
