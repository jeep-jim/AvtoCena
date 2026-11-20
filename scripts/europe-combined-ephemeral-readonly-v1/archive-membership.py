"""Validate the pinned existing GitHub ZIP and print an aggregate membership seal."""
import datetime as dt
import hashlib
import json
import pathlib
import sys
import zipfile

p=pathlib.Path(sys.argv[1]); digest="d822258671996030c53e934adfd3b48136243241f4f442b62172728b50319316"
source='autoscout_europe_open'
raw_ids=set(); offers={}; return_count=0
with p.open('rb') as file:
    assert hashlib.file_digest(file,'sha256').hexdigest()==digest
    file.seek(0)
    with zipfile.ZipFile(file) as z:
        prefix=[f'autoscout_europe_open-{i:06}.jsonl' for i in range(1,25)]
        raw=[f'raw-autoscout_europe_open-{i:06}.jsonl' for i in range(1,6)]
        assert set(z.namelist())==set(prefix+raw+['report.json','own-storage-receipt.json'])
        assert len(z.namelist())==31
        count=0
        for name in raw:
            with z.open(name) as lines:
                for line in lines:
                    page=json.loads(line); count+=1
                    assert page['sourceId']==source and page['kind']=='source_page'
                    assert page['cursor']==(None if count==1 else str(count))
                    assert page['nextCursor']==(None if count==201 else str(count+1))
                    if count==201: assert page['items']==[]
                    raw_ids.update(x['id'] for x in page['items'])
                    return_count+=len(page['items'])
        assert count==201 and return_count==3630
        for name in prefix:
            with z.open(name) as lines:
                for line in lines:
                    item=json.loads(line)['offer']
                    assert item['sourceId']==source and item['market']=='europe' and item['sourceCurrency']=='EUR'
                    observation=item.get('operational',{}).get('lastSeenAt') or item.get('updatedAt')
                    observation=dt.datetime.fromisoformat(observation).isoformat(timespec='milliseconds').replace('+00:00','Z')
                    offer=[item['id'],item['sourceOfferId'],item['sourcePrice'],observation]
                    offers[item['id']]=offer
        assert len(raw_ids)==len(offers)==3609
        assert set(x[1] for x in offers.values())==raw_ids
        output=json.dumps([offers[id] for id in sorted(offers)],ensure_ascii=False,separators=(',',':')).encode()
        print(json.dumps({'artifact':14584484747,'archiveConfirmed':True,'rawPages':count,
          'sourceCount':len(offers),'sourceOnlyObservationsSha':hashlib.sha256(output).hexdigest()}))
        if len(sys.argv)==3:
            with pathlib.Path(sys.argv[2]).open('xb') as f:
                f.write(output)
