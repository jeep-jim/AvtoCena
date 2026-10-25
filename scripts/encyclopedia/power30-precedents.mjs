/** Owner-authorized nearest-model references. These are estimates, never certificates. */
const token=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const known=v=>v!==undefined&&v!==null&&v!==''&&v!==0&&token(v)!=='unknown';
const positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
const normal=(f,v)=>{const t=token(v);return f==='drive'?({'4wd':'awd','4x4':'awd',полный:'awd',передний:'fwd',задний:'rwd'}[t]||t):f==='powertrainKind'?({bev:'electric',hev:'otherhybrid',phev:'otherhybrid',reev:'serieshybrid',erev:'serieshybrid'}[t]||t):t;};
const code=v=>token(String(v||'').replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|5AA|6AA|6LA|7BA|ZAA)-/i,''));
const codeFields=['chassisCode','engineCode','generation'];
function physical(c){return {...c,powerKw:positive(c.powerKw)?Number(c.powerKw):positive(c.powerHp)?Number(c.powerHp)*0.73549875:undefined};}
export function selectPower30Precedent(offer,facts){
 if(positive(offer.power30MinKw)||offer.power30MinKwByMotor?.some(positive))return {status:'existing_value_preserved'};
 if(offer.manualEditedAt||/manual|customer_input/i.test(offer.powerDataSource||'')||offer.calculationSnapshot?.modificationScenario)return {status:'manual_parameters_preserved'};
 if(!['electric','hybrid'].includes(offer.fuel))return {status:'not_electrified'};
 const target=physical(offer),ranked=[];
 for(const f of facts){
  const source=f.sources?.power30MinKw,value=Number(f.values?.power30MinKw);
  if(!positive(value)||value>2000||!['official_registry','manufacturer','manual','reported_precedent'].includes(source?.kind)||!/^https:\/\//.test(source.url||''))continue;
  const c=physical(f.constraints||{});
  if(!known(c.fuel)||normal('fuel',c.fuel)!==normal('fuel',offer.fuel))continue;
  // Known incompatible propulsion and generations are not close variants.
  if(['powertrainKind','drive',...codeFields].some(k=>known(target[k])&&known(c[k])&&(k==='chassisCode'?code(target[k])!==code(c[k]):normal(k,target[k])!==normal(k,c[k]))))continue;
  const differences=[],missing=[],matches=[];let distance=0,anchors=0;
  for(const k of ['powertrainKind','drive',...codeFields]){
   if(known(target[k])&&known(c[k])){matches.push(k);anchors+=codeFields.includes(k)?4:1;}
   else if(known(target[k])){missing.push(k);distance+=1;}
  }
  // Never compare a hybrid system output to its combustion or motor output.
  const numeric=['engineCc','icePowerKw','motorPeakKw','batteryKwh',...(offer.fuel==='electric'?['powerKw']:[])];
  let reject=false;
  for(const k of numeric){
   if(!positive(target[k]))continue;
   if(!positive(c[k])){missing.push(k);distance+=2;continue;}
   const relative=Math.abs(Number(target[k])-Number(c[k]))/Math.max(Number(target[k]),Number(c[k]));
   const limit=k==='engineCc'?0.05:0.15;
   if(relative>limit){reject=true;break;}
   anchors++;distance+=relative*10;
   if(relative>0.005)differences.push({field:k,target:Number(target[k]),reference:Number(c[k])});else matches.push(k);
  }
  if(reject)continue;
  if(Number(f.year)>0&&Number(offer.year)>0){const gap=Math.abs(f.year-offer.year);if(gap>3)continue;distance+=gap*0.1;if(gap)differences.push({field:'year',target:offer.year,reference:f.year});else matches.push('year');}
  ranked.push({f,value,distance,anchors,differences,missing,matches});
 }
 if(!ranked.length)return {status:'no_compatible_documented_precedent'};
 ranked.sort((a,b)=>b.anchors-a.anchors||a.distance-b.distance||String(a.f.variantId).localeCompare(String(b.f.variantId)));
 const first=ranked[0],best=ranked.filter(r=>r.anchors===first.anchors&&Math.abs(r.distance-first.distance)<1e-9);
 const values=[...new Set(best.map(r=>r.value))].sort((a,b)=>a-b);
 const refs=best.map(r=>({modelId:r.f.modelId,variantId:r.f.variantId,revision:r.f.revision,year:r.f.year||null,power30MinKw:r.value,constraints:r.f.constraints,source:r.f.sources.power30MinKw,differences:r.differences,missing:r.missing,matches:r.matches}));
 return {status:values.length===1?'estimated':'range_requires_version',requiresConfirmation:true,certified:false,
  method:first.anchors?'nearest_compatible_mechanics':'same_model_only',
  ...(values.length===1?{estimatedPower30MinKw:values[0]}:{}),rangeKw:[values[0],values.at(-1)],candidateCount:best.length,referenceValuesKw:values,
  references:refs};
}

/** Manufacturer-documented regional names; only candidate discovery, never certification. */
export const regionalPrecedentFamilies=[
 {keys:['nio:es6','nio:el6'],url:'https://us.nio.com/news/20250702001',checkedAt:'2026-10-25'},
 {keys:['nio:es8','nio:el8'],url:'https://us.nio.com/news/20250702001',checkedAt:'2026-10-25'},
 {keys:['nio:et5t','nio:et5touring'],url:'https://us.nio.com/news/20250702001',checkedAt:'2026-10-25'},
 {keys:['byd:seagull','byd:dolphinmini','byd:dolphinsurf'],url:'https://www.byd.com/en/news-list/First-BYD-Electric-Vehicle-Rolls-off-the-Line-in-Brazil',checkedAt:'2026-10-25'},
];
export function precedentModelKeys(key){const family=regionalPrecedentFamilies.find(f=>f.keys.includes(key));return {keys:family?.keys||[key],...(family?{regionalNameEvidence:{url:family.url,checkedAt:family.checkedAt}}:{})};}

/** Prefer the existing documented corpus; reports fill only otherwise unresolved inputs. */
export function selectWithReportedPrecedents(offer,facts,reports){
 const documented=selectPower30Precedent(offer,facts);
 if(documented.status!=='no_compatible_documented_precedent')return documented;
 const reported=selectPower30Precedent(offer,reports);
 return reported.references?{...reported,evidenceTier:'reported_precedent',originalCertificateReviewed:false}:reported;
}

/** A literal Plus suffix identifies a different model, not ignorable punctuation. */
export function precedentIdentityKey(key,model){return /\+\s*$/.test(String(model||''))?key+'plus':key;}
