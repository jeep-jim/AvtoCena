"""Owner-authorized archive. Source is read-only; never touches active REG keys."""
import os,json,hashlib,datetime,tempfile,tarfile,io,threading,concurrent.futures,urllib.parse,urllib.request,urllib.error,time
import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
OUT='legacy-archive-report';os.makedirs(OUT,exist_ok=True)
TARGET_BUCKET='avtocena-staging-8120751';BASE='retired/yandex-20261107/'
report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceDeleted':False,'activeREGDataChanged':False,'complete':False,'verifiedObjects':0,'verifiedSourceBytes':0,'archiveBytes':0,'parts':[]}
lock=threading.Lock();stop=threading.Event();deadline=time.monotonic()+50*60

def require(value,message):
    if not value:raise RuntimeError(message)
def save():
    with open(OUT+'/report.json','w') as f:json.dump(report,f,indent=2)
def inventory(client,bucket):
    rows=[];keys=set();tokens=set();token=None
    for _ in range(100):
        q={'Bucket':bucket,'MaxKeys':1000}
        if token:q['ContinuationToken']=token
        d=client.list_objects_v2(**q)
        for row in d.get('Contents',[]):
            require(row['Key'] not in keys,'duplicate_source_key');keys.add(row['Key'])
            require(isinstance(row['Size'],int) and 0<=row['Size']<=2_000_000_000,'unbounded_source_object')
            require(row.get('ETag') and row.get('LastModified'),'source_identity_missing')
            rows.append(row)
        if not d.get('IsTruncated'):return rows
        token=d.get('NextContinuationToken');require(token and token not in tokens,'incomplete_inventory');tokens.add(token)
    raise RuntimeError('inventory_page_limit')
def identity(rows):
    return [[r['Key'],r['Size'],r['ETag'],str(r['LastModified'])] for r in rows]
def digest_json(value):return hashlib.sha256(json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def hash_body(body):
    h=hashlib.sha256();size=0
    try:
        while True:
            chunk=body.read(4*1024*1024)
            if not chunk:break
            h.update(chunk);size+=len(chunk)
    finally:body.close()
    return h.hexdigest(),size
class HashReader:
    def __init__(self,body):self.body=body;self.digest=hashlib.sha256();self.size=0
    def read(self,size=-1):
        b=self.body.read(size);self.digest.update(b);self.size+=len(b);return b
try:
    endpoint=os.environ.get('SOURCE_ENDPOINT') or 'https://storage.yandexcloud.net';parsed=urllib.parse.urlparse(endpoint)
    require(parsed.scheme=='https' and parsed.hostname=='storage.yandexcloud.net','unexpected_source_endpoint')
    source_bucket=os.environ['SOURCE_BUCKET'];require(source_bucket!=TARGET_BUCKET,'same_source_target')
    cfg=Config(signature_version='s3v4',connect_timeout=15,read_timeout=60,retries={'max_attempts':2,'mode':'standard'},max_pool_connections=8,s3={'addressing_style':'path'})
    source=boto3.client('s3',endpoint_url=endpoint,region_name=os.environ.get('SOURCE_REGION') or 'ru-central1',aws_access_key_id=os.environ['SOURCE_ACCESS'],aws_secret_access_key=os.environ['SOURCE_SECRET'],config=cfg)
    target=boto3.client('s3',endpoint_url='https://s3.regru.cloud',region_name='us-east-1',aws_access_key_id=os.environ['TARGET_ACCESS'],aws_secret_access_key=os.environ['TARGET_SECRET'],config=cfg)
    require(source.get_bucket_versioning(Bucket=source_bucket).get('Status','Disabled')=='Disabled','source_historical_versions_need_separate_archive')
    try:report['REGVersioning']=target.get_bucket_versioning(Bucket=TARGET_BUCKET).get('Status','Disabled')
    except Exception as e:report['REGVersioning']='unverified';report['REGVersioningError']=type(e).__name__
    rows=inventory(source,source_bucket);total=sum(r['Size'] for r in rows)
    require(0<len(rows)<=50000 and total<=50_000_000_000,'source_scope_changed')
    digest=digest_json(identity(rows));prefix=BASE+digest+'/'
    report.update({'sourceObjects':len(rows),'sourceBytes':total,'sourceInventoryDigest':digest,'archivePrefix':prefix});save()
    groups=[];group=[];size=0
    for row in rows:
        if group and (size+row['Size']>512_000_000 or len(group)>=400):groups.append(group);group=[];size=0
        group.append(row);size+=row['Size']
    if group:groups.append(group)
    transfer=TransferConfig(multipart_threshold=64*1024*1024,multipart_chunksize=16*1024*1024,max_concurrency=1,use_threads=False)
    def archive_part(pair):
        number,group=pair
        require(not stop.is_set() and time.monotonic()<deadline,'archive_deadline_or_stop')
        try:
            with tempfile.TemporaryDirectory(prefix='legacy-archive-') as tmp:
                archive_path=tmp+'/part.tar.gz';records=[]
                with tarfile.open(archive_path,'w:gz',compresslevel=1) as archive:
                    for index,row in enumerate(group):
                        require(not stop.is_set() and time.monotonic()<deadline,'archive_deadline_or_stop')
                        obj=source.get_object(Bucket=source_bucket,Key=row['Key'],IfMatch=row['ETag'])
                        require(obj.get('ETag')==row['ETag'] and obj['ContentLength']==row['Size'],'source_changed')
                        reader=HashReader(obj['Body']);entry=f'objects/{index:06d}'
                        info=tarfile.TarInfo(entry);info.size=row['Size'];info.mode=0o600;info.mtime=int(row['LastModified'].timestamp())
                        try:archive.addfile(info,reader)
                        finally:obj['Body'].close()
                        require(reader.size==row['Size'],'source_length_mismatch')
                        headers={k:str(obj[k]) for k in ['ContentType','ContentEncoding','ContentDisposition','CacheControl','ContentLanguage','Expires'] if k in obj}
                        records.append({'key':row['Key'],'entry':entry,'bytes':row['Size'],'etag':row['ETag'],'lastModified':str(row['LastModified']),'sha256':reader.digest.hexdigest(),'headers':headers,'metadata':obj.get('Metadata',{})})
                    manifest=json.dumps({'sourceBucket':source_bucket,'records':records},ensure_ascii=False).encode();info=tarfile.TarInfo('manifest.json');info.mode=0o600;info.size=len(manifest);archive.addfile(info,io.BytesIO(manifest))
                with open(archive_path,'rb') as f:archive_hash=hashlib.file_digest(f,'sha256').hexdigest()
                archive_size=os.path.getsize(archive_path);key=prefix+f'part-{number:04d}-{archive_hash}.tar.gz'
                require(key.startswith(BASE) and not key.startswith('migration-staging/full-'),'unsafe_target')
                target.upload_file(archive_path,TARGET_BUCKET,key,ExtraArgs={'ContentType':'application/gzip','ACL':'private','Metadata':{'archive-sha256':archive_hash,'source-inventory-sha256':digest}},Config=transfer)
                if number==0:
                    url='https://s3.regru.cloud/'+TARGET_BUCKET+'/'+urllib.parse.quote(key,safe='/')
                    try:
                        with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=20) as r:anonymous=r.status
                    except urllib.error.HTTPError as e:anonymous=e.code
                    require(anonymous in (403,404),'archive_anonymously_accessible')
                    report['anonymousAccessDenied']=True
                got,length=hash_body(target.get_object(Bucket=TARGET_BUCKET,Key=key)['Body']);require(got==archive_hash and length==archive_size,'archive_readback_mismatch')
                part={'number':number,'key':key,'sha256':archive_hash,'archiveBytes':archive_size,'sourceBytes':sum(r['Size'] for r in group),'sourceObjects':len(group)}
                with lock:
                    report['parts'].append(part);report['verifiedObjects']+=len(group);report['verifiedSourceBytes']+=part['sourceBytes'];report['archiveBytes']+=archive_size;save()
                    print(json.dumps({k:report[k] for k in ['verifiedObjects','sourceObjects','verifiedSourceBytes','archiveBytes']}),flush=True)
                return part
        except Exception:
            stop.set();raise
    archive_part((0,groups[0]))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(archive_part,list(enumerate(groups))[1:]):pass
    require(report['verifiedObjects']==len(rows) and report['verifiedSourceBytes']==total,'incomplete_archive')
    require(identity(rows)==identity(inventory(source,source_bucket)),'source_changed_during_archive')
    archive_manifest={'version':1,'sourceBucket':source_bucket,'sourceVersioning':'Disabled','inventory':identity(rows),'inventoryDigest':digest,'parts':sorted(report['parts'],key=lambda x:x['number']),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    body=json.dumps(archive_manifest,ensure_ascii=False).encode();manifest_hash=hashlib.sha256(body).hexdigest();manifest_key=prefix+'manifest-'+manifest_hash+'.json'
    target.put_object(Bucket=TARGET_BUCKET,Key=manifest_key,Body=body,ACL='private',ContentType='application/json',Metadata={'archive-sha256':manifest_hash})
    got,length=hash_body(target.get_object(Bucket=TARGET_BUCKET,Key=manifest_key)['Body']);require(got==manifest_hash and length==len(body),'manifest_readback_mismatch')
    report.update({'archiveManifestKey':manifest_key,'archiveManifestSha256':manifest_hash,'sourceUnchanged':True,'complete':True,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
except Exception as e:
    report['errorType']=type(e).__name__;report['error']=str(e)[:200] if isinstance(e,RuntimeError) else 'operation_failed_without_private_details';raise SystemExit(1)
finally:
    save();print(json.dumps({k:v for k,v in report.items() if k!='parts'}),flush=True)
