#!/usr/bin/env python3
"""Bind the small durable receipt to a terminal existing collect-only Actions job."""
import hashlib,json,os,pathlib,re,stat,sys,zipfile
root=pathlib.Path(os.environ['RUNNER_TEMP'])/'china-job'
run=json.loads((root/'producer-run.json').read_text())
meta=json.loads((root/'producer-artifact.json').read_text())
def require(ok):
 if not ok: raise SystemExit('fresh_china_producer_binding_refused')
vid=os.environ['CHINA_COLLECTOR_REVISION'];rid=int(os.environ['CHINA_COLLECTOR_RUN']);att=int(os.environ['CHINA_COLLECTOR_ATTEMPT'])
aid=int(os.environ['CHINA_RECEIPT_ARTIFACT']);expected_zip=os.environ['CHINA_RECEIPT_ZIP_SHA256']
require(re.fullmatch('[a-f0-9]{40}',vid) and re.fullmatch('[a-f0-9]{64}',expected_zip))
require(run.get('id')==rid and run.get('run_attempt')==att and run.get('head_sha')==vid and run.get('head_branch')=='main'
 and run.get('status')=='completed' and run.get('conclusion')=='success' and run.get('event')=='push'
 and run.get('path')=='.github/workflows/collect-china-ordinary-20261119.yml'
 and run.get('repository',{}).get('full_name')=='jeep-jim/AvtoCena')
repo_id=run['repository']['id'];require(repo_id==1289722938);w=meta.get('workflow_run',{})
archive=root/'producer-receipt.zip'
require(meta.get('id')==aid and meta.get('expired') is False and meta.get('digest')=='sha256:'+expected_zip
        and meta.get('name')==f'china-collection-receipt-{rid}-{att}'
        and w.get('id')==rid and w.get('head_sha')==vid and w.get('head_branch')=='main'
        and w.get('repository_id')==repo_id and w.get('head_repository_id')==repo_id
        and 0<meta.get('size_in_bytes',0)<=32768
        and archive.stat().st_size==meta['size_in_bytes'] and hashlib.sha256(archive.read_bytes()).hexdigest()==expected_zip)
with zipfile.ZipFile(archive) as z:
 infos=z.infolist()
 require(len(infos)==1 and infos[0].filename=='own-storage-receipt.json' and not infos[0].is_dir()
         and 0<infos[0].file_size<=32768 and stat.S_IFMT(infos[0].external_attr>>16) in (0,stat.S_IFREG))
 data=z.read(infos[0])
receipt=json.loads(data);rootkey=f'catalog/nonjp-intake/v1/china/{rid}/{att}'
require(receipt.get('version')==1 and receipt.get('market')=='china' and receipt.get('root')==rootkey
        and receipt.get('owner')=={'runId':str(rid),'attempt':str(att),'revision':vid}
        and receipt.get('manifestSha256')==os.environ['CHINA_EXPECTED_ARCHIVE_SHA256']
        and receipt.get('reportDigest')==os.environ['CHINA_EXPECTED_REPORT_DIGEST'])
with (root/'producer-receipt.json').open('xb') as f: f.write(data)
print('exact_terminal_collect_only_receipt_verified')
