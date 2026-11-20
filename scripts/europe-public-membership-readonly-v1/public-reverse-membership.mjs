import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { catalogProjectionBatches } from './native-catalog-projection-parts-22867.ts';
const pins=Object.freeze({livePublic:'gen_1794878284419_a611dfcf',livePublicCount:38964});

const PUBLIC_DIGEST='4c34c20d9784b571414390cab450ceeeaee60b00c168476100419ec5c05cb038';
const PUBLIC_ETAG_DIGEST='426ac1af32eb10b21d3beb5e2d167c81b09e3c6bc35946f2eb5706818d045142';
const NATIVE_BYTES_SHA='639467183320cee484129ae36253d48d7b29db862670e747564ac3ef5d380391';
const sha=b=>createHash('sha256').update(b).digest('hex');
const wireRootLimit=1024*1024;
const partLimit=4*1024**2;
const maxParts=64;
const maxBytes=maxParts*partLimit+wireRootLimit;
const immutableId=gen=>'catalog/generations/'+gen+'/indexes/projection/europe.json';
const currentId='catalog/public/projection/europe.json';
const src=x=>typeof x==='string'&&/^[a-z0-9_-]{1,72}$/.test(x);
const streamHash=()=>createHash('sha256');
const update=(h,value)=>h.update(JSON.stringify(value)+'\n');

export function publicEvidence(input) {
  return verify(input,{generation:pins.livePublic,count:pins.livePublicCount,manifestSha:PUBLIC_DIGEST,etagSha:PUBLIC_ETAG_DIGEST});
}
export function rehearsePublicOnly(input,fixturePins) { return verify(input, fixturePins); }
async function verify({ capture, rootBytes, getPart }, cut) {
  assert.ok(capture?.generation===cut.generation&&capture?.publicManifestBeforeSha===cut.manifestSha&&
    capture?.publicManifestAfterSha===cut.manifestSha&&capture?.publicEtagBeforeSha===cut.etagSha&&
    capture?.publicEtagAfterSha===cut.etagSha,'manifest_capture_not_current');
  assert.ok(capture?.projectionKey===immutableId(cut.generation)||capture?.projectionKey===currentId,'unexpected_projection_key');
  const key=capture.projectionKey;
  assert.ok(Buffer.isBuffer(rootBytes)&&rootBytes.length>0&&rootBytes.length<=wireRootLimit&&
    sha(rootBytes)===capture.projectionRootBeforeSha&&sha(rootBytes)===capture.projectionRootAfterSha,
    'projection_root_unverified');
  const root=JSON.parse(rootBytes);
  // Large legacy inline roots are not read by this proof; do not silently
  // expand the budget or substitute a different market/brand fallback.
  assert.ok(root.storageFormat==='catalog-projection-parts-v1'&&root.generationId===cut.generation&&
    root.count===cut.count&&Array.isArray(root.parts)&&root.parts.length>0&&root.parts.length<=maxParts,'scoped_directory_missing_or_out_of_bound');
  const allowed=new Set(root.parts.map(x=>x.path));
  const seenParts=new Set(), ids=new Set(), groups=new Map();
  let bytes=rootBytes.length;
  const storage={
    async readJson(itemKey){
      assert.ok(allowed.has(itemKey)&&!seenParts.has(itemKey),'projection_part_scope');
      seenParts.add(itemKey);
      const b=await getPart(itemKey);
      assert.ok(Buffer.isBuffer(b)&&b.length<=partLimit&&b.length>0,'part_wire_bound');
      bytes+=b.length;assert.ok(bytes<=maxBytes,'projection_total_bound');
      return JSON.parse(b);
    },
  };
  for await(const batch of catalogProjectionBatches(storage,key,root)){
    assert.equal(batch.generationId,cut.generation);
    for(const row of batch.items){
      assert.ok(row?.market==='europe'&&src(row.sourceGroup)&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=128&&!ids.has(row.id),
        'duplicate_row_or_missing_native_source_group');
      ids.add(row.id);
      assert.ok(ids.size<=cut.count,'projection_count_overflow');
      if(!groups.has(row.sourceGroup)){
        assert.ok(groups.size<32,'projection_source_bound');
        groups.set(row.sourceGroup,{ids:streamHash(),fields:streamHash(),count:0});
      }
      const part=groups.get(row.sourceGroup);part.count++;
      update(part.ids,row.id); update(part.fields,row);
    }
  }
  assert.ok(ids.size===cut.count&&seenParts.size===root.parts.length,'incomplete_projection');
  assert.ok(groups.get('mobile_de_open')?.count>0&&groups.get('autoscout_europe_open')?.count>0,'missing_paired_source');
  return {generation:cut.generation,scope:'europe_native_compact_source_group',projectionKey:key,total:ids.size,
    groups:Object.fromEntries([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([id,v])=>[id,{
      count:v.count,orderedIdsSha:v.ids.digest('hex'),orderedProjectionRowsSha:v.fields.digest('hex'),
    }])),
    projectionParts:seenParts.size, bytes, rawOfferChunksRead:0, fullPublicCardPayloadPreservationProven:false,
    publicationAuthorized:false, cloudWrites:0, providerCalls:0};
}

// Compare two separately verified compact projections. Foreign groups must
// remain identical even if AutoScout changes; do not claim card payload parity.
export function compareProtectedPublicMembership(before,after) {
  assert.ok(before?.scope==='europe_native_compact_source_group'&&after?.scope===before.scope,'unexpected_membership_scope');
  function protectedGroups(x) {
    assert.ok(x.groups?.mobile_de_open?.count>0,'missing_mobile_membership');
    return Object.entries(x.groups).filter(([sourceId])=>sourceId!=='autoscout_europe_open').sort(([a],[b])=>a.localeCompare(b));
  }
  assert.deepEqual(protectedGroups(before),protectedGroups(after),'protected_public_membership_changed');
  return {source:'autoscout_europe_open',mobileCompactMembershipPreserved:true,
    otherCompactMembershipPreserved:true,fullCardPayloadReconciliation:false,publicationAuthorized:false};
}

const local=async (f,cap)=>{
  const st=await fs.lstat(f);assert.ok(st.isFile()&&st.size>0&&st.size<=cap,'local_bound');
  const b=await fs.readFile(f);assert.equal(b.length,st.size,'local_changed');return b;
};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{
    const [dir]=process.argv.slice(2);
    assert.ok(dir,'need local input');
    assert.equal(sha(await local(new URL('./native-catalog-projection-parts-22867.ts',import.meta.url),65536)),NATIVE_BYTES_SHA);
    const capture=JSON.parse(await local(path.join(dir,'public-projection-capture.json'),32768));
    const output=await publicEvidence({capture,rootBytes:await local(path.join(dir,'projection-root.json'),wireRootLimit),
      getPart:key=>local(path.join(dir,'projection-parts',path.basename(key)),partLimit)});
    console.log(JSON.stringify(output));
  } catch(e){console.error(JSON.stringify({status:'native_projection_unproven',errorCode:e.code,
    safeReason:typeof e.message==='string'&&/^[a-z_]{1,100}$/.test(e.message)?e.message:undefined,cloudWrites:0}));process.exitCode=2;}
}
