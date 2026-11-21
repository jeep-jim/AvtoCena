/** Immutable bounded report-only proof; no credentials, writes, LIST, or network of its own. */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex'),wire=v=>Buffer.from(JSON.stringify(v));
const H=/^[a-f0-9]{64}$/,SOURCE='autohome_used_china_open',ID=/^[a-f0-9]{24}$/,M=1024**2;
const need=(v,k)=>{if(!v)throw Error('china_exact_removal:'+k);};
const json=b=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b));
export const exactRemoval=Object.freeze({
 archiveRoot:'catalog/nonjp-intake/v1/china/44866682279/1',
 archiveManifestSha256:'c438e8f3476783d0e0d0b567199f635e40c3089eff8806ca2f2d6c54c482cb46',
 reportSha256:'4bd587f31c60d8f31c3a8a32b6df4f4eaf51a04e26896e1682271571509601bc',
 reportBytes:4629047,continuedSourceTerminalSha256:'3eb0b346ce24d3f3503ebfdd0cd95968ebb8375b3bc44ec13683cc692c9a9d79',
 observations:286546,rows:25707,sourceObservedAt:'2026-11-21T04:04:35.417Z',oldCursor:13123821,newCursor:13196544,
 readySha256:'c66a7f5e6b0ee3373e8d850195bfe34409adec641f86457d0e2485bc7a07494e',
 contentManifest:'aad60963901acb3019ab9bfab856a702c9ed586b81e9e83b21270e40c542c5f3',
 activeControlSha256:'9e3f73d6282465019f43dcd0370bf9c71688445a0e361dccf641bd45acc5be62',
 currentGeneration:'gen_1795166586455_china44710087159',newGeneration:'gen_1795239842026_china44871616387',
 fordId:'f011736e0fada0af4e0a7491',
});
const stable=inner=>sha(SOURCE+':'+inner).slice(0,24);
function readBody(b,cap){need(Buffer.isBuffer(b)&&b.length>0&&b.length<=cap,'binary_bounds');return b;}
export async function verifyReportFile(read,cap=exactRemoval){
 const rk=cap.archiveRoot;
 const mb=readBody(await read(rk+'/complete.json',2*M),2*M);
 need(sha(mb)===cap.archiveManifestSha256,'manifest_hash');
 const manifest=json(mb);
 need(manifest?.kind==='nonjp-intake'&&manifest.version===1&&manifest.market==='china'&&manifest.owner?.runId==='44866682279'&&
  manifest.owner?.attempt==='1'&&manifest.owner?.revision==='8e4edcd606b0ee70b9a9f90d30f795f84ef43950'&&
  manifest.collection?.complete===true&&manifest.reportDigest===cap.reportSha256&&Array.isArray(manifest.files),'manifest_scope');
 const files=manifest.files.filter(x=>x?.name==='report.json');
 need(files.length===1&&files[0].sha256===cap.reportSha256&&files[0].bytes===cap.reportBytes&&
  Array.isArray(files[0].parts)&&files[0].parts.length===3&&Math.ceil(cap.reportBytes/(2*M))===3,'report_descriptor');
 const b=await Promise.all(files[0].parts.map(async(p,i)=>{
  need(p?.bytes===Math.min(2*M,cap.reportBytes-i*2*M)&&H.test(p.sha256??'')&&p.key===rk+'/files/report.json/'+i+'-'+p.sha256+'.json','report_part_descriptor');
  const env=json(readBody(await read(p.key,4*M),4*M));
  need(env?.version===1&&env.encoding==='gzip-base64'&&env.bytes===p.bytes&&env.sha256===p.sha256&&
   typeof env.payload==='string'&&env.payload.length<=(2*M+65536)*2,'report_part_wire');
  const gz=Buffer.from(env.payload,'base64');need(gz.toString('base64')===env.payload,'report_part_base64');
  const z=gunzipSync(gz,{maxOutputLength:2*M});need(z.length===p.bytes&&sha(z)===p.sha256,'report_part_hash');return z;
 }));
 const full=Buffer.concat(b);need(full.length===cap.reportBytes&&sha(full)===cap.reportSha256,'report_hash');
 const report=json(full),ts=Date.parse(cap.sourceObservedAt),src=report?.sources?.[0];
 need(report?.version===1&&report.market==='china'&&report.provider==='auto_api_che168'&&report.completed===true&&report.productionWrites===false&&
  Date.parse(report.completedAt)===ts&&report.sources?.length===1&&src?.sourceId===SOURCE&&src.completeInventory===true&&
  src.stopReason==='source_finished'&&src.initialCursor===cap.oldCursor&&src.cursor===cap.newCursor&&src.observations===cap.observations&&
  report.sourceMaterialization?.terminalWitnessSha256===cap.continuedSourceTerminalSha256&&
  Array.isArray(report.confirmedWithdrawals)&&report.confirmedWithdrawals.length===cap.rows,'complete_terminal_report');
 const ids=new Set(),events=[];
 for(const row of report.confirmedWithdrawals){
  need(row?.market==='china'&&row.sourceId===SOURCE&&/^\d{1,150}$/.test(row.sourceOfferId??'')&&stable(row.sourceOfferId)===row.id&&
   row.status==='removed'&&Number.isFinite(Date.parse(row.observedAt))&&Date.parse(row.observedAt)<=ts&&!ids.has(row.id),'explicit_removed_identity');
  ids.add(row.id);events.push(row);
 }
 return events;
}
const canonical=/^\/cars\/offer\/([a-f0-9]{24})\/([a-z0-9-]{1,160})$/;
function canonicalPath(uri,id,generation){
 const u=new URL(uri,'https://avtocena.com');
 need(typeof uri==='string'&&uri.startsWith('/cars/offer/')&&u.origin==='https://avtocena.com'&&!u.hash&&canonical.exec(u.pathname)?.[1]===id&&
  [...u.searchParams].length===2&&u.searchParams.get('market')==='china'&&u.searchParams.get('preparedCut')===generation,'native_card_path');
 return u.pathname;
}
export async function runExactRemovalPreview({read,assertLive,readOld,readNew,assertPublic,cap=exactRemoval,maxTargets=8}){
 need([read,assertLive,readOld,readNew,assertPublic].every(f=>typeof f==='function')&&Number.isSafeInteger(maxTargets)&&maxTargets>=1&&maxTargets<=8,'preview_scope');
 await assertLive();const all=await verifyReportFile(read,cap);await assertLive();
 const ford=all.find(r=>r.id===cap.fordId);
 const shortlist=[...(ford?[ford]:[]),...all.filter(r=>r.id!==cap.fordId).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||a.id.localeCompare(b.id))].slice(0,maxTargets);
 let checks=0;
 for(const e of shortlist){
  checks++;
  const old=await readOld(e.id); // accepted 22867 read with native previous legal horizon and exact rev5 control
  need(old?.generationId===cap.currentGeneration&&typeof old.present==='boolean','native_current_evidence');
  if(!old.present)continue;
  need(old.offerId===e.id&&old.sourceOfferId===e.sourceOfferId&&old.sourceId===SOURCE&&Number.isFinite(Date.parse(old.sourceObservedAt)),'native_current_identity');
  if(Date.parse(old.sourceObservedAt)>=Date.parse(e.observedAt))continue; // cannot remove newer known live row
  const oldPath=canonicalPath(old.canonicalUri,e.id,cap.currentGeneration);await assertPublic(old.canonicalUri,e.id);
  const next=await readNew(e.id); // native snapshot .locate; no HTTP fallback and no body import
  need(next?.generationId===cap.newGeneration&&next.readySha256===cap.readySha256&&next.manifestSha256===cap.contentManifest&&
   typeof next.located==='boolean','native_candidate_evidence');
  if(next.located)continue;
  await assertLive();
  const safe={version:1,kind:'china-authenticated-explicit-terminal-withdrawal-v1',market:'china',source:'che168',oldGeneration:cap.currentGeneration,newGeneration:cap.newGeneration,readySha256:cap.readySha256,
   currentControlSha256:cap.activeControlSha256,reportSha256:cap.reportSha256,archiveManifestSha256:cap.archiveManifestSha256,terminalWitnessSha256:cap.continuedSourceTerminalSha256,
   matchesUserFord:e.id===cap.fordId,stableOfferId:e.id,
   knownRemovedCanonicalPath:oldPath+'?'+new URLSearchParams({market:'china',preparedCut:cap.newGeneration}),
   observedAt:e.observedAt,eventDigest:sha(wire(e)),nativeCurrentMember:true,explicitRemoved:true,presentAtTerminal:false,sourceAuthenticated:true,nativeCandidateLocatorAbsent:true,checks,
   noPurchase:true,providerRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanceAuthorized:false};
  need(ID.test(safe.stableOfferId),'native_known_id');return Object.freeze(safe);
 }
 await assertLive();return Object.freeze({kind:'china-exact-removal-held',reason:'no_previously_public_explicit_removal_proved_in_scope',checkedTargets:checks,
  fordExplicitlyInExactReport:Boolean(ford),providerRequests:0,storageWrites:0,publicationAuthorized:false,cursorAdvanceAuthorized:false});
}
