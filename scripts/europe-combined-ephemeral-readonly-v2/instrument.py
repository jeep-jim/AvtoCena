from pathlib import Path
import hashlib
p=Path('scripts/catalog-publish-market.mjs')
b=p.read_bytes()
needle=b'const canonicalTargetPreview = await previewCanonicalPublicCatalogOffers(selectedMarketOffers, retainedTargetPublicRows, currentPublicIds, retainedPowerMixMinimumByMarket);'
assert b.count(needle)==1
assert hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest()==__import__('sys').argv[1]
extension=b'''\nif (!dryRun || !sellerInventory || market!=="europe" || process.env.JSON_STORAGE_DRIVER!=="local" || currentMarketRows.length!==0) throw Error("unsafe_replay_context");
const {searchProjectionFromOffer}=await import('../apps/web/lib/catalog/storage.ts');
const {catalogOfferVisibleRub}=await import('../apps/web/lib/catalog/public-priority.ts');
const approved='autoscout_europe_open';
if(canonicalTargetPreview.offers.some(row=>row.market!=='europe'||row.sourceId!==approved))throw Error('foreign_replay_row');
const nativeCanonical=canonicalTargetPreview.offers;
const sold=nativeCanonical.filter(row=>row.catalogPricingMode==='seller'&&row.totalRub===null&&(row.publicVisibleRub??0)===0&&catalogOfferVisibleRub(row)===0);
const priced=nativeCanonical.filter(row=>catalogOfferVisibleRub(row)>0);
const archiveWire=await fs.readFile('archived-observations.json');
const shaString=x=>crypto.createHash('sha256').update(x).digest('hex');
if(shaString(archiveWire)!=='41a52e3e229c42db2f7f16a7c27d7444de6cff66b865acbc631218b4629277da')throw Error('archived_membership_wire_mismatch');
const archive=JSON.parse(archiveWire);
const original=new Map(archive.map(([id,nativeId,sourcePrice,seenAt],i)=>[id,{nativeId,sourcePrice,seenAt,i}]));
const archivedIssues={missing:0,nativeId:0,sourcePrice:0,currency:0,timeString:0,timeInstant:0,sellerPriceRub:0};
for(const x of sold){
 const a=original.get(x.id), seenAt=x.operational?.lastSeenAt??x.lastSeenAt??x.updatedAt;
 if(!a){archivedIssues.missing++;continue;}
 if(x.sourceOfferId!==a.nativeId)archivedIssues.nativeId++;
 if(x.sourcePrice!==a.sourcePrice)archivedIssues.sourcePrice++;
 if(x.sourceCurrency!=='EUR')archivedIssues.currency++;
 if(seenAt!==a.seenAt)archivedIssues.timeString++;
 if(Date.parse(seenAt)!==Date.parse(a.seenAt))archivedIssues.timeInstant++;
 if(x.sellerPriceRub!==Math.round(x.sourcePrice*89.8597))archivedIssues.sellerPriceRub++;
}
const exact=Object.entries(archivedIssues).every(([k,v])=>k==='timeString'||v===0)&&new Set(sold.map(row=>row.id)).size===sold.length;
const expected='6928e078b4acbcb660735918ce1b5b3d98070e310519e2c168e9c2824d5b98b4';
const orderings=[
 ['publisher_native',sold],
 ['archive_observation',[...sold].sort((a,b)=>original.get(a.id).i-original.get(b.id).i)],
 ['canonical_id',[...sold].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)],
];
const orderHashes=Object.fromEntries(orderings.map(([name,rows])=>[name,shaString(JSON.stringify(rows.map(row=>row.id)))]));
const matching=orderings.find(([name])=>orderHashes[name]===expected);
const [ordering,bound]=matching??orderings[0];
const admittedIds=bound.map(row=>row.id);
const orderedIdsSha=orderHashes[ordering];
const net=globalThis.readNetworkProof();
const summary={inputCount:generatedCandidateCount,canonicalCount:nativeCanonical.length,sellerOnlyCount:sold.length,nonSellerCanonicalCount:nativeCanonical.length-sold.length,runtimeVisiblePriceCount:priced.length,rejectionReasons,canonicalQualityRejected:canonicalTargetPreview.qualityRejected.length,canonicalIdentityRejected:canonicalTargetPreview.identityRejected.length,orderedIdsSha,orderHashes,matchingOriginalOrder:matching?.[0]??null,expected,sameExactAdmittedOrder:orderedIdsSha===expected,allRowsBindArchivePriceAndTimestamp:exact,archivedIssues,network:net,productionWrites:0};
await fs.writeFile('evidence/replay-summary.json',JSON.stringify(summary,null,2)+'\\n',{flag:'wx',mode:0o600});
if(!exact||net.outgoingNetworkAttempts!==0||net.officialLocalSubstitutions!==1||sold.length!==1510) throw Error('exact_admitted_replay_mismatch');
const compact=bound.map(searchProjectionFromOffer);
const projectionRowsSha=crypto.createHash('sha256');
for(const row of compact)projectionRowsSha.update(JSON.stringify(row)+'\\n');
const witness={installed:'22867cbcfaee27b2e8917b6bf880e44827f67b60',calc:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90',fxSha:'2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6',fxSha256:'2adeb25ad182398684c4c646e110ded5449f7174e4a4442f8bff6b7d1d32aec6',fxDate:'2026-11-20',source:approved,archiveManifestSha:'2294967a5d0b1593d9587137bdb8cb2959e335d1ff7f6b442ba283544ab7f62d',admittedIdsSha:orderedIdsSha,admittedRowsSha:crypto.createHash('sha256').update(JSON.stringify(bound)).digest('hex'),admittedProjectionRowsSha:projectionRowsSha.digest('hex'),count:sold.length,ordering,sameAsPreviousExactOrder:!!matching,eligibleForExistingGate:!!matching,deliveredPricesApproved:0,network:net,privateOnly:true,publicationAuthorized:false};
for(const [name,value] of [['native-admitted.json',bound],['native-compact-admitted.json',compact],['native-admitted-ids.json',admittedIds],['admission-witness.json',witness]]) await fs.writeFile('evidence/'+name,JSON.stringify(value),{flag:'wx',mode:0o600});
console.log(JSON.stringify(witness));
process.exit(0);
'''
p.with_name('catalog-publish-local-europe-evidence.mjs').write_bytes(b.replace(needle,needle+extension))
