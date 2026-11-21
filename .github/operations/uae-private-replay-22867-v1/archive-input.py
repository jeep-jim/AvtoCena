"""Privately serialize exact prior feed and explicit historical removals; only pipe same worker."""
import hashlib,json,sys,zipfile
from pathlib import Path
from stage_source_shadow_alias import stage

def main():
 d=Path(sys.argv[1])
 rows,at,cursor=stage.load_exact(d)
 canon=stage.canonical
 previous={}
 # load_exact already pinned ZIP bytes, current source map and normalized digest.
 for spec in stage.archive.A:
  with zipfile.ZipFile(d/f'{spec[0]}.zip') as z:
   for item in stage.archive.lines(z,sorted(n for n in z.namelist() if n.startswith('raw-'+stage.archive.S+'-'))):
    if item['endpoint']!='changes': continue
    for e in item['payload']['result']:
     prior=previous.get(str(e['inner_id']))
     if prior and prior['id']>=e['id']:raise ValueError('uae_old_removal_event_order')
     previous[str(e['inner_id'])]={'id':e['id'],'inner_id':str(e['inner_id']),'change_type':e['change_type'],'created_at':e['created_at']}
 removals=[v for k,v in sorted(previous.items()) if v['change_type']=='removed' and k not in rows]
 proof={'kind':'uae_archive_full_input','cursor':cursor,'observedThrough':at,'count':len(rows),
        'normalizedSha256':stage.NORMALIZED,'historicRemovals':len(removals),
        'historicRemovalsSha256':hashlib.sha256(b''.join(canon(r)+b'\n' for r in removals)).hexdigest()}
 out=sys.stdout.buffer
 out.write(canon(proof)+b'\n')
 for k in sorted(rows):out.write(canon(rows[k])+b'\n')
 for r in removals:out.write(canon(r)+b'\n')
if __name__=='__main__': main()
