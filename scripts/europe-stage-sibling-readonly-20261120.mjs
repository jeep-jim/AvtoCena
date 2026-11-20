import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// Req. path and exact signature layout from 44683532721; no unscoped client.
const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
const host='s3.regru.cloud';
const source='autoscout_europe_open', sibling='mobile_de_open';
const archiveRoot='catalog/nonjp-intake/v1/europe/44637245131/1';
const archiveKey=archiveRoot+'/complete.json';
const pinKey='catalog/raw-feed-pins/v1/nonjp-intake-europe-44637245131-1.json';
const pub='catalog/manifest.json', internal='catalog/internal/manifest.json';
const lock='catalog/import-lock.json', cursor='catalog/intake-cursors/v1/europe.json';
const controls='catalog/operations/collection-controls-v1.json';
const rawPolicy='catalog/raw-feed-coordination/v1/policy.json';
export const fixed=Object.freeze({pub,internal,lock,cursor,controls,rawPolicy,archiveKey,pinKey});
export const expected=Object.freeze({
  publicGeneration:'gen_1794878284419_a611dfcf',
  publicDigest:'4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038',
  observedInternalGeneration:'gen_1795145660283_bbfbf3d1',
  observedInternalDigest:'df7d672ed585349a06e6718429f5496978f1cf625eacd55a7fc6d7483a72edc4',
  owner:{runId:'44637245131',attempt:'1',revision:'15f51970fb68555ad56b7c40f622517a15643377'},
  archiveSha:'2294967a5d0b1593d9587137bdb8cb2959e335d1ff7f6b442ba283544ab7f62d',
  reportSha:'c8eefab008e25651f955828598a65de7f606b7b392c39410fd56b7f557caa91e',
  reportFileSha:'416fe6e25a7cdb2267288e2e95b8db7f4f8f8668730e4494d337cb8fdf6b61d8',
  referencesSha:'d41c8c077871bb37aecac04fa0e638280b5404935a61b5690e38f6dfa13476a5',
  readyAt:'2026-11-19T23:40:27.552Z', completed:'2026-11-19T23:34:26.268Z',
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const equal=(a,b)=>digest(a)===digest(b);
const gen=x=>typeof x==='string'&&/^gen_\d{1,20}_[a-z0-9-]{1,64}$/.test(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const when=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
function require(condition,code){if(!condition)throw Error(code);}

export function boundedReader({fetcher=fetch,env=process.env,clock=Date.now}={}) {
  const allowed=new Map(Object.values(fixed).map(key=>[key,key===archiveKey?2*1024**2:1024**2]));
  let requests=0,bytes=0,reportAdded=false;
  const deadline=clock()+95_000;
  return Object.freeze({
    stats:()=>({requests,bytes}),
    allowPinnedReport(key, filePartSha) {
      require(!reportAdded&&hex(filePartSha)&&key===archiveRoot+'/files/report.json/0-'+filePartSha+'.json','report_key_scope');
      reportAdded=true;allowed.set(key,32*1024);
    },
    async read(key) {
      require(allowed.has(key),'unapproved_key');
      require(clock()<deadline&&requests<20,'storage_request_budget');
      const access=env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,secret=env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
      require(Boolean(access&&secret),'signing_unavailable');
      ++requests;
      const datetime=new Date(clock()).toISOString().replace(/[:-]|\.\d{3}/g,''),day=datetime.slice(0,8);
      const scope=day+'/us-east-1/s3/aws4_request',pathname=prefix+key;
      const empty=sha(''),headers={host,'x-amz-content-sha256':empty,'x-amz-date':datetime};
      const names=Object.keys(headers).sort(),signed=names.join(';');
      const request=['GET',pathname,'',names.map(name=>name+':'+headers[name]+'\n').join(''),signed,empty].join('\n');
      const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),'us-east-1'),'s3'),'aws4_request');
      headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+
        createHmac('sha256',signing).update(['AWS4-HMAC-SHA256',datetime,scope,sha(request)].join('\n')).digest('hex');
      const r=await fetcher('https://'+host+pathname,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(Math.min(12000,deadline-clock()))});
      if(r.status===404){await r.body?.cancel();return null;}
      const cap=allowed.get(key),n=r.headers.get('content-length'),tag=r.headers.get('etag');
      require(r.status===200&&!r.headers.get('content-encoding')&&/^\d+$/.test(n||'')&&Number(n)>0&&
        Number(n)<=cap&&/^"[^"\r\n]{1,128}"$/.test(tag||''),'storage_status_or_bound');
      const blocks=[];let length=0;
      for await(const block of r.body){
        length+=block.length;bytes+=block.length;
        require(length<=cap&&bytes<=24*1024**2,'storage_body_budget');blocks.push(block);
      }
      require(length===Number(n),'storage_wire_length');
      const body=Buffer.concat(blocks,length);
      return {wireSha256:sha(body),etag:tag,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))};
    },
  });
}

const sourcePaths=(id,x)=>x&&int(x.count)&&x.count>0&&when(x.updatedAt)&&Array.isArray(x.chunks)&&x.chunks.length>0&&
  x.chunks.length<=2000&&new Set(x.chunks).size===x.chunks.length&&x.chunks.every(path=>
    typeof path==='string'&&path.length<240&&path.startsWith('catalog/internal/offers/'+id+'/')&&
    /^gen_\d{1,20}_[a-z0-9-]{1,64}-chunk-[0-9]+\.json$/.test(path.split('/').pop()));
const describeSource=(id,x)=>sourcePaths(id,x)?{count:x.count,chunkCount:x.chunks.length,descriptorSha256:digest(x),
  orderedChunkListSha256:digest(x.chunks),updatedAt:x.updatedAt}:null;
const pair=(a,b)=>a===null||b===null?a===b:a.wireSha256===b.wireSha256&&a.etag===b.etag;
const controlOn=(x,id,group)=>typeof x?.[group]?.[id]?.enabled==='boolean'?x[group][id].enabled:null;
const pointer=x=>x&&gen(x.value?.generationId)?{generation:x.value.generationId,sha256:x.wireSha256,etagSha256:sha(x.etag)}:null;

function archiveDescriptor(value,pin){
  require(value?.version===1&&value?.kind==='nonjp-intake'&&value.market==='europe'&&equal(value.owner,expected.owner)&&
    digest(value)===expected.archiveSha&&value.reportDigest===expected.reportSha,'archive_identity');
  require(Array.isArray(value.files)&&value.files.length===30&&value.collection?.qualityStatus==='partial','archive_files');
  const names=value.files.map(x=>x.name);
  require(new Set(names).size===names.length&&names.every(x=>x==='report.json'||/^(raw-)?autoscout_europe_open-[0-9]{6}\.jsonl$/.test(x)),'archive_source_inventory');
  const f=value.files.find(x=>x.name==='report.json');
  require(f?.bytes===3922&&f.sha256===expected.reportFileSha&&f.parts?.length===1,'archive_report_descriptor');
  const part=f.parts[0];
  require(part.sha256===expected.reportFileSha&&part.bytes===f.bytes&&
    part.key===archiveRoot+'/files/report.json/0-'+part.sha256+'.json','archive_report_part');
  require(pin?.version===1&&['ready','published'].includes(pin.state)&&
    pin.operationId==='nonjp-intake-europe-44637245131-1'&&equal(pin.owner,expected.owner)&&
    pin.readyAt===expected.readyAt&&Array.isArray(pin.references)&&digest(pin.references)===expected.referencesSha&&
    !pin.coordination&&pin.references.length===1&&pin.references[0].root===archiveRoot&&
    pin.references[0].kind==='nonjp-intake'&&pin.references[0].sha256===expected.archiveSha,'archive_pin_identity');
  return part;
}

function readReport(wire,part) {
  require(wire?.version===1&&wire.encoding==='gzip-base64'&&wire.bytes===part.bytes&&
    wire.sha256===part.sha256&&typeof wire.payload==='string'&&wire.payload.length<16384,'archive_report_wire');
  const gz=Buffer.from(wire.payload,'base64');
  require(gz.toString('base64')===wire.payload,'archive_report_encoding');
  const raw=gunzipSync(gz,{maxOutputLength:part.bytes});
  require(raw.length===part.bytes&&sha(raw)===part.sha256,'archive_report_hash');
  const x=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  require(digest(x)===expected.reportSha&&x.market==='europe'&&x.completedAt===expected.completed&&
    x.productionWrites===false&&x.qualityStatus==='partial'&&equal(x.requiredSourceIds,[sibling,source])&&
    equal(x.partialSources,[{sourceId:sibling,reason:'blocked'}])&&equal(x.confirmedWithdrawals,[])&&
    x.sources?.length===2,'archive_report_scope');
  const a=x.sources.find(r=>r.sourceId===source),m=x.sources.find(r=>r.sourceId===sibling);
  require(a?.observations===3609&&a.pages===201&&a.initialCursor===null&&a.cursor===null&&a.done===true&&
    a.stopReason==='source_finished'&&m?.observations===0&&m.pages===0&&m.stopReason==='blocked','archive_source_completion');
  return {asOf:x.completedAt,autoScout:{observations:a.observations,pages:a.pages,detailErrors:a.errors?.length},
    mobile:{observations:m.observations,terminal:m.stopReason},fullEurope:false};
}

export async function inspect({reader,clock=Date.now}) {
  const start=clock(),keys=[pub,internal,lock,cursor,controls,rawPolicy];
  const get=key=>reader.read(key);
  const [before, archive, pin]=await Promise.all([Promise.all(keys.map(get)),get(archiveKey),get(pinKey)]);
  let autosc=null,archiveFailure=null;
  try {
    const part=archiveDescriptor(archive?.value,pin?.value);
    reader.allowPinnedReport(part.key,part.sha256);
    autosc=readReport((await get(part.key))?.value,part);
  } catch {archiveFailure='exact_archive_or_pin_report_unproved';}
  const after=await Promise.all(keys.map(get));
  const stable=keys.every((_,i)=>pair(before[i],after[i]));
  const [p,i,l,c,o,policy]=after;
  const pPtr=pointer(p),iPtr=pointer(i);
  const europe=p?.value?.markets?.europe;
  const mobile=describeSource(sibling,i?.value?.sources?.[sibling]);
  const scout=describeSource(source,i?.value?.sources?.[source]);
  const publicDescriptor=p?.value?.version===2&&europe&&int(europe.count)&&Array.isArray(europe.chunks)&&
    europe.chunks.length<=2000&&europe.chunks.every(x=>typeof x==='string'&&x.length<240)
    ?{count:europe.count,chunkCount:europe.chunks.length,descriptorSha256:digest(europe)}:null;
  const protectedOtherMarkets=p?.value?.markets&&typeof p.value.markets==='object'
    ?Object.fromEntries(Object.entries(p.value.markets).filter(([id])=>['china','korea','uae','georgia','japan'].includes(id)).map(([id,row])=>[id,digest(row)])):null;
  const flag={revision:o?.value?.version===1&&int(o.value.revision)?o.value.revision:null,market:controlOn(o?.value,'europe','markets'),
    autoScout:controlOn(o?.value,source,'sources'),mobile:controlOn(o?.value,sibling,'sources')};
  const baseline=pPtr?.generation===expected.publicGeneration&&pPtr.sha256===expected.publicDigest;
  const internalObserved=iPtr?.generation===expected.observedInternalGeneration&&iPtr.sha256===expected.observedInternalDigest;
  const expiry=l?.value?.lockedUntil;
  const lease=expiry===''?'released':when(expiry)?Date.parse(expiry)>clock()?'active':'expired':'unproven';
  const coordinate=policy?'policy_present_requires_separate_settlement':'policy_absent_runtime_requirement_not_proven';
  const fresh=autosc&&clock()>=Date.parse(autosc.asOf)&&clock()-Date.parse(autosc.asOf)<72*3600000;
  const sourceInputQualified=Boolean(stable&&autosc&&fresh&&flag.revision!==null&&flag.market&&flag.autoScout);
  const blockers=[];
  if(!sourceInputQualified)blockers.push('source_input_not_qualified');
  if(!stable||!baseline||!internalObserved)blockers.push('pointer_changed_from_exact_scope_or_unstable');
  if(!['released','expired'].includes(lease))blockers.push('writer_exclusion_unproved');
  if(!mobile||!publicDescriptor)blockers.push('missing_sibling_or_europe_descriptor');
  // V2 public manifest carries one Europe slot, not an AutoScout/Mobile split.
  // This probe cannot certify the public sibling or native settlement by
  // reading mixed chunk bodies; that is a separate narrow proof prerequisite.
  blockers.push('public_mobile_slice_receipt_and_internal_settlement_required');
  return {at:new Date(start).toISOString(),stable,sourceInputQualified,archive:autosc,archiveFailure,
    baseline:{pinnedPublic:baseline,pinnedPreviouslyObservedInternal:internalObserved,public:pPtr,internal:iPtr,lease,coordinate},
    europe:{publicAggregate:publicDescriptor,internal:{mobile,autoScout:scout},
      protectedOtherMarketDescriptors:protectedOtherMarkets,
      protectedInternalSourcesSha256:i?.value?.sources&&typeof i.value.sources==='object'
        ?digest(Object.entries(i.value.sources).filter(([id])=>id!==source).sort(([a],[b])=>a.localeCompare(b))):null,
      cursor:c?.value?.market==='europe'?{sha256:c.wireSha256,etagSha256:sha(c.etag),generation:gen(c.value.generationId)?c.value.generationId:null}:null,
      controls:flag,publicMobilePreservationProven:false},
    blockers,readyToActivate:false,reads:reader.stats(),storageWrites:0,providerCalls:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { const result=await inspect({reader:boundedReader()}); console.log(JSON.stringify(result));
    if(!result.sourceInputQualified)process.exitCode=2;
  } catch { console.error(JSON.stringify({status:'bounded_read_inconclusive',readyToActivate:false,storageWrites:0,providerCalls:0}));process.exitCode=2; }
}
