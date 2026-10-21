"""Read-only bounded source inventory check before production activation."""
import datetime,json,os,time
import boto3
from botocore.config import Config
client=boto3.client('s3',endpoint_url=os.environ.get('SOURCE_ENDPOINT') or 'https://storage.yandexcloud.net',region_name=os.environ.get('SOURCE_REGION') or 'ru-central1',aws_access_key_id=os.environ['SOURCE_ACCESS'],aws_secret_access_key=os.environ['SOURCE_SECRET'],config=Config(connect_timeout=15,read_timeout=30,retries={'max_attempts':2},s3={'addressing_style':'path'}))
prefix=os.environ.get('SOURCE_PREFIX','').strip('/')
if prefix:prefix+='/'
rows=[]
for page in client.get_paginator('list_objects_v2').paginate(Bucket=os.environ['SOURCE_BUCKET'],Prefix=prefix):
 rows.extend(page.get('Contents',[]))
 if len(rows)>40000:raise SystemExit('Unexpected source inventory size; stopped')
cutoff=datetime.datetime(2026,10,11,13,23,0,tzinfo=datetime.timezone.utc)
changed=sum(r['LastModified']>cutoff for r in rows)
total=sum(r['Size'] for r in rows)
print(json.dumps({'objects':len(rows),'bytes':total,'modifiedAfterVerifiedCopy':changed,'sourceReadOnly':True}))
if len(rows)!=29001 or total!=44208593855 or changed:raise SystemExit('Source changed after verified copy; activation stopped')
