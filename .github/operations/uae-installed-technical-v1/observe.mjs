import fs from 'node:fs';
import {createHash} from 'node:crypto';

export const release='22867cbcfaee27b2e8917b6bf880e44827f67b60';
export const expectedDigest='bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b';
const fixedPath='/app/data/knowledge/encyclopedia/calculation-v1.json';
const fields=['engineCc','powerHp','powerKw','icePowerKw','power30MinKw','fuel','powertrainKind','drive','bodyType','engineCode','transmission','grossVehicleWeightKg'];
const kinds=['manufacturer','official_registry','manual','owner_reference'];
const emptyFields=()=>Object.fromEntries(fields.map(x=>[x,0]));
const tally=()=>Object.fromEntries(kinds.map(x=>[x,0]));
const knownMarket=x=>x==='uae';
const marked=(value)=>Array.isArray(value)&&value.some(knownMarket);
const own=(o,k)=>Object.hasOwn(o??{},k);
const noDetail={installedUaeListingInputsUsed:false,actualListingBindingVerified:false,crossSourceDeliveredAuthorityVerified:false,publicationAllowed:false,sourceRequests:0,storageWrites:0};
function requireCheck(x,why){if(!x)throw Error(why);}
function obj(x){return !!x&&typeof x==='object'&&!Array.isArray(x);}
function reportingDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;}
export function inspectIndex(index,boundRelease,boundDigest=expectedDigest){
 requireCheck(boundRelease===release,'installed_release_mismatch');
 requireCheck(index?.version===1&&obj(index.models)&&index.digest===boundDigest,'installed_index_manifest_mismatch');
 const digest=createHash('sha256').update(JSON.stringify(index.models)).digest('hex');
 requireCheck(digest===boundDigest,'installed_index_content_mismatch');
 let facts=0,annualFacts=0,reservedBuckets=0,malformedAnnualEntries=0,annualWithCompleteCombustionSpec=0,uaeTaggedFacts=0,uaeTaggedModelGroups=0,generalDocumentedMechanicalFacts=0,eligibilityShapeFields=0,annualWithCrossMarketReferenceNotUae=0;
 const uaeFields=emptyFields(),allFields=emptyFields(),sourceKinds=tally(),uaeKinds=tally();
 for(const group of Object.values(index.models)){
  if(!Array.isArray(group)){++reservedBuckets;continue;}
  let uaeGroup=false;
  for(const fact of group){
   ++facts;
   if(!obj(fact)||!Number.isInteger(fact.year)||!obj(fact.values)||!obj(fact.sources)){++malformedAnnualEntries;continue;}
   ++annualFacts;
   let uaeFact=false,nonUaeReference=false,generic=false;
   const present=Object.create(null);
   for(const field of fields){
    const source=fact.sources[field],value=fact.values[field];
    if(!own(fact.values,field)||value==null||value===''||!kinds.includes(source?.kind))continue;
    ++allFields[field];++sourceKinds[source.kind];present[field]=true;
    if(marked(source.markets)){++uaeFields[field];++uaeKinds[source.kind];uaeFact=true;}
    if(source.kind==='owner_reference'&&!marked(source.markets)&&Array.isArray(source.markets)&&source.markets.length)nonUaeReference=true;
    if(['engineCc','powerHp','powerKw','power30MinKw'].includes(field)&&['manufacturer','official_registry','manual'].includes(source.kind))generic=true;
   }
   if(uaeFact){++uaeTaggedFacts;uaeGroup=true;}
   if(nonUaeReference)++annualWithCrossMarketReferenceNotUae;
   if(generic)++generalDocumentedMechanicalFacts;
   if(present.engineCc&&(present.powerHp||present.powerKw)&&present.fuel)++annualWithCompleteCombustionSpec;
   if(['sourceId','sourceOfferId','listingId','offerId','sourceIdentity'].some(k=>own(fact,k)||own(fact.constraints,k)))++eligibilityShapeFields;
  }
  if(uaeGroup)++uaeTaggedModelGroups;
 }
 return {status:'bound_installed_index_structural_availability_only',release,indexDigest:digest,createdAt:reportingDate(index.createdAt),modelGroups:Object.keys(index.models).length,
  annualFacts,facts,reservedBuckets,malformedAnnualEntries,annualWithCompleteCombustionSpec,generalDocumentedMechanicalFacts,uaeTaggedFacts,uaeTaggedModelGroups,
  structuralListingKeyFacts:eligibilityShapeFields,annualWithCrossMarketReferenceNotUae,allFields,uaeFields,sourceKinds,uaeKinds,...noDetail};
}
if(process.argv.includes('--fixed-installed-file')){
 try {
  const boundRelease=process.env.AVTOCENA_RELEASE_SHA;
  requireCheck(boundRelease===release,'installed_release_mismatch');
  const fd=fs.openSync(fixedPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let bytes;
  try{
   const meta=fs.fstatSync(fd);
   requireCheck(meta.isFile()&&meta.size>0&&meta.size<=128*1024*1024,'installed_index_file_budget');
   bytes=fs.readFileSync(fd);
   requireCheck(bytes.length===meta.size,'installed_index_changed_during_read');
  }finally{fs.closeSync(fd);}
  console.log(JSON.stringify(inspectIndex(JSON.parse(bytes.toString('utf8')),boundRelease)));
 }catch(error){
  const s=String(error?.message);
  const allow=new Set(['installed_release_mismatch','installed_index_manifest_mismatch','installed_index_content_mismatch',
   'installed_index_file_budget','installed_index_changed_during_read']);
  console.log(JSON.stringify({status:allow.has(s)?s:'installed_index_unavailable',release,...noDetail}));
  process.exitCode=1;
 }
}
