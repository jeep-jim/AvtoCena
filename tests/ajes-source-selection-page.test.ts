import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ajesQuery,ajesLot,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';
import {applyAjesLotAdmission} from '../apps/web/lib/catalog/ajes-admission';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {readPowerOrderedAjesPage,readFilteredAjesPage,ajesPowerEvidenceEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection,type AjesSourceSelection} from '../apps/web/lib/catalog/japan-source-selection';
import {buildJapanBodyCandidatePlan} from '../apps/web/lib/catalog/japan-body-selection';
import {japanUnknownPower,japanLocalPowerHp,japanSupplierPower} from '../apps/web/lib/catalog/japan-source-power';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {checksum,modelKey,type CalculationIndex,type CalculationFact} from '../apps/web/lib/encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from '../apps/web/lib/catalog/editorial';

const observedAt='2026-11-28T17:00:00.000Z';
const raw=(id:string,patch:Record<string,unknown>={})=>({ID:id,YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:950000,
 MARKA_NAME:'TOYOTA',MODEL_NAME:'SOURCE ONLY',AUCTION_DATE:'2026-11-28',PW:'150',TIME:'P',FUEL:'',
 ENG_V:2000,GRADE:'2.0 G',KUZOV:'',PRIV:'FF',KPP:'AT',BODY_TYPE:'',IMAGES:'',...patch});
type WireRow=ReturnType<typeof raw>;
function fact(make:string,model:string,powerHp:number,bodyType='suv'):CalculationFact {
 return {make,model,modelId:make+'/'+model,variantId:model+'-2.0-g',revision:'r1',year:2023,trims:['20g'],
  constraints:{engineCc:2000,fuel:'petrol',powerHp,bodyType},values:{engineCc:2000,fuel:'petrol',powerHp,bodyType},
  sources:{powerHp:{kind:'manufacturer',url:'https://example.com/offline-fixture'},bodyType:{kind:'manufacturer',url:'https://example.com/offline-fixture'}}};
}
function knowledge(facts:CalculationFact[]):CalculationIndex {
 const models:CalculationIndex['models']={};
 for(const value of facts)(models[modelKey(value.make,value.model)]||=[]).push(value);
 return {version:1,digest:checksum(models),manifestDigest:'offline-fixture',createdAt:observedAt,models};
}
const emptyEditorial:CatalogEditorialIndex={revision:'e1',entries:{}};
const rate=(price:number)=>({currency:'JPY',sourcePrice:price,effectiveRate:.6,cbrRate:60,nominal:100,
 rateDate:'2026-11-28',rateSource:'cbr',sourcePriceRub:Math.round(price*.6)} as const);

/** This finite offline table executes the production WHERE/ORDER/LIMIT.
 * SQLite has different varchar/numeric affinity and lacks POSIX classes: adapt
 * only PW numeric comparisons and [[:space:]] in this test oracle. This is not
 * evidence that AJ accepts a newly generated SQL expression on its server. */
function oracle(rows:WireRow[],index:CalculationIndex|null,editorial=emptyEditorial){
 const db=new DatabaseSync(':memory:');
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern).replaceAll('[[:space:]]','\\s'),'i').test(String(value))));
 db.exec('create table stats(ID text,YEAR integer,AUCTION_TYPE integer,STATUS text,FINISH real,MARKA_NAME text collate nocase,MODEL_NAME text collate nocase,AUCTION_DATE text,PW text,TIME text,FUEL text,ENG_V integer,GRADE text,KUZOV text,PRIV text,KPP text,BODY_TYPE text,IMAGES text)');
 const columns=Object.keys(rows[0]??raw('schema')),insert=db.prepare(`insert into stats (${columns.join(',')}) values (${columns.map(()=>'?').join(',')})`);
 for(const row of rows)insert.run(...columns.map(key=>(row as any)[key]??null));
 const admit=(row:Record<string,unknown>)=>{
  const lot=ajesLot(row,'stats',false);if(!lot)return null;
  const admitted=applyAjesLotAdmission(lot,rate(Number(row.FINISH)),observedAt,{calculationIndex:index,editorial});
  return admitted?safePublicPricing(admitted):null;
 };
 const calls:Array<{page:number;phase?:string;rawIds:string[];sql:string}>=[];
 return {calls,admit,close:()=>db.close(),sourceModels:[...new Map(rows.map(row=>[JSON.stringify([row.MARKA_NAME,row.MODEL_NAME]),{make:String(row.MARKA_NAME),model:String(row.MODEL_NAME),total:1}])).values()],
  read(query:AjesQuery){
   const sql=ajesQuery(query,index).sql;
   const sqlite=sql.replace(/\bpw\s*(>=|<=)\s*(\d+)/g,'cast(pw as real)$1$2');
   const selected=db.prepare(sqlite).all();calls.push({page:query.page||1,phase:query.sourcePhase,rawIds:selected.map(row=>String(row.ID)),sql});
   return {items:selected.map(admit).filter((value):value is NonNullable<ReturnType<typeof admit>>=>Boolean(value)),received:selected.length,observedAt,stale:false,partial:false};
  }};
}
const price=(offer:any)=>Number(offer.operational.raw.finalPriceJpy);
const order=(sort:'totalRub'|'totalRubDesc')=>(a:any,b:any)=>(sort==='totalRub'?price(a)-price(b):price(b)-price(a))||a.id.localeCompare(b.id);

async function drainPowerPages(source:ReturnType<typeof oracle>,rows:WireRow[],query:AjesQuery,selection:AjesSourceSelection,
 filter:ReturnType<typeof ajesResultFilter>,index:CalculationIndex){
 const epoch=ajesPowerEvidenceEpoch({runtimeSha:'f'.repeat(40),editorialRevision:emptyEditorial.revision,calculationDigest:index.digest});
 let after:string|undefined,finished=false;const actual:any[]=[],pages:any[]=[];
 for(let page=1;page<=Math.ceil(rows.length/24)*2+4;page++){
  const previous=after,before=source.calls.length;
  const result=await readPowerOrderedAjesPage({page,pageSize:24,after,evidenceEpoch:epoch,cursorKey:JSON.stringify({query,selection}),
   itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),sourceSelection:selection,
   read:async(sourcePage,phase)=>{
    const value=source.read({...query,page:sourcePage,pageSize:24,sourceSelection:selection,sourcePhase:phase});
    return {...value,items:value.items.filter(offer=>filter.matches(offer)&&japanUnknownPower(offer)===(phase==='u'))};
   }});
  assert(source.calls.length-before<=8);assert.equal(result.stale,false);assert.equal(result.partial,false);
  pages.push(result);actual.push(...result.items);after=result.nextCursor??undefined;
  if(!result.hasMore){finished=true;break;}
  assert(after&&after!==previous,'a bounded broad unknown scan keeps a progressing continuation');
 }
 assert(finished,'the finite K/U source must eventually exhaust without dropping unknown rows');
 return {actual,pages};
}

for(const sort of ['totalRubDesc','totalRub'] as const)test(`source ${sort} skips a long unrelated window and fills 24→48 before the unknown lane`,async t=>{
 const manual=fact('Toyota','MANUAL',120);manual.sources.powerHp={kind:'manual',url:'https://example.com/offline-manual-fixture'};
 const index=knowledge([fact('Toyota','LOCAL',150),fact('Toyota','STRONG',180),manual]);
 const editorial=emptyEditorial;
 const rows=[
  ...Array.from({length:240},(_,i)=>raw('expensive-unknown-'+i,{PW:'',FINISH:30000000-i*1000})),
  ...Array.from({length:240},(_,i)=>raw('expensive-zero-'+i,{PW:'0',FINISH:29000000-i*1000})),
  ...Array.from({length:240},(_,i)=>raw('expensive-composite-'+i,{PW:'133,136',FINISH:28000000-i*1000})),
  ...Array.from({length:240},(_,i)=>raw('expensive-over-'+i,{PW:'280',FINISH:20000000-i*1000})),
  // These PW matches are rejected by the higher-priority local 180 hp fact.
  ...Array.from({length:27},(_,i)=>raw('local-over-'+i,{MODEL_NAME:'STRONG',FINISH:14000000-i*1000})),
  // This annual model is a candidate, but conflicting volume prevents a local
  // hp assertion. Its rows must eventually remain in the unknown lane.
  ...Array.from({length:30},(_,i)=>raw('local-unmatched-'+i,{MODEL_NAME:'L O C A L',PW:'',ENG_V:1000,FINISH:10000000-i*1000})),
  ...Array.from({length:68},(_,i)=>raw('known-'+i,{FINISH:1000000-i*1000})),
  raw('local-override',{MODEL_NAME:'ＬＯＣＡＬ',PW:'350',FINISH:12000000}),
  raw('manual-hp',{MODEL_NAME:'MANUAL',PW:'400',FINISH:13000000}),
  raw('owner-override',{MARKA_NAME:'HONDA',MODEL_NAME:'STEP WGN',PW:'200',FINISH:11000000}),
  raw('fullwidth-power',{PW:'１５０',FINISH:2000000}),
  raw('entity-power',{PW:'&#49;50',FINISH:2001000}),
  raw('space-power',{PW:'\t150\t',FINISH:2002000}),
  raw('malformed-power',{PW:'150,200',FINISH:900000}),
 ];
 const source=oracle(rows,index,editorial);t.after(source.close);
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial});
 const resolved=resolveJapanSourceSelection({power,sourceModels:source.sourceModels,directoryComplete:true});
 assert.equal(resolved.complete,true);assert(resolved.selection);
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const all=rows.map(source.admit).filter((offer):offer is NonNullable<ReturnType<typeof source.admit>>=>Boolean(offer)&&filter.matches(offer));
 const expected=[...all.filter(offer=>!japanUnknownPower(offer)).sort(order(sort)),...all.filter(japanUnknownPower).sort(order(sort))];
 assert.equal(japanLocalPowerHp(all.find(row=>row.id==='ajes-stats-local-override')),150);
 assert.equal(japanLocalPowerHp(all.find(row=>row.id==='ajes-stats-manual-hp')),120);
 for(const id of ['fullwidth-power','entity-power','space-power'])assert.equal(japanSupplierPower(all.find(row=>row.id==='ajes-stats-'+id))?.hp,150);
 let clock=0,after:string|undefined;const actual:any[]=[],pages:any[]=[];
 const epoch=ajesPowerEvidenceEpoch({runtimeSha:'f'.repeat(40),editorialRevision:editorial.revision,calculationDigest:index.digest});
 for(let page=1;page<=Math.ceil(rows.length/24)*2+4;page++){
  const before=source.calls.length;
  const result=await readPowerOrderedAjesPage({page,pageSize:24,after,evidenceEpoch:epoch,cursorKey:JSON.stringify({sort,selection:resolved.selection}),
   itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),sourceSelection:resolved.selection!,minimumReads:2,now:()=>clock,
   read:async(sourcePage,phase)=>{
    clock+=9000;const selected=source.read({table:'stats',sort,powerTo:160,page:sourcePage,pageSize:24,sourceSelection:resolved.selection!,sourcePhase:phase});
    return {...selected,items:selected.items.filter(offer=>filter.matches(offer)&&japanUnknownPower(offer)===(phase==='u'))};
   }});
  assert(source.calls.length-before<=8,'the ordinary per-request source admission budget remains bounded');
  assert.equal(result.partial,false);assert.equal(result.stale,false);
  if(page<=2){assert.equal(result.scanLimited,false);assert.equal(result.items.length,24,'fill the known page despite a slow previous source read');}
  // U intentionally retains the broad source. A long run of rejected known
  // values may consume one bounded request, but cannot imply exhaustion.
  if(result.scanLimited){assert.equal(result.hasMore,true);assert(result.nextCursor);}
  pages.push(result);actual.push(...result.items);after=result.nextCursor??undefined;if(!result.hasMore)break;
 }
 assert.equal(pages[0].items.length,24);assert.equal(pages[1].items.length,24);
 assert.equal(pages.at(-1).hasMore,false,'the complete finite unknown lane reaches real exhaustion');
 assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row.id));assert.equal(new Set(actual.map(row=>row.id)).size,actual.length);
 assert.equal(actual.filter(row=>row.id.includes('expensive-over')||row.id.includes('local-over-')).length,0);
 const firstUnknown=actual.findIndex(japanUnknownPower);assert(firstUnknown>=48);assert(actual.slice(firstUnknown).every(japanUnknownPower));
 assert.equal(actual.filter(row=>row.id==='ajes-stats-local-override').length,1);
 assert(source.calls.filter(call=>call.phase==='k').every(call=>!call.rawIds.some(id=>['expensive-unknown-','expensive-zero-','expensive-composite-','expensive-over-'].some(prefix=>id.startsWith(prefix)))));
 for(const prefix of ['expensive-unknown-','expensive-zero-','expensive-composite-'])assert.equal(actual.filter(row=>row.id.startsWith('ajes-stats-'+prefix)).length,240);
 if(sort==='totalRubDesc')assert(pages[0].reads>=3,'slow locally rejected candidate pages are refilled before returning visible page one');
 assert(source.calls.some(call=>call.phase==='u'));
});

for(const sort of ['totalRubDesc','totalRub'] as const)test(`source ${sort} preserves normalized hp below the numeric prefix bound and all later unknown forms`,async t=>{
 const index=knowledge([]);
 const normalized=[['fullwidth','１５０'],['entity','&#49;50'],['mixed-width','1５０'],['circled','①⑤⓪'],
  ['superscript','¹⁵⁰'],['math-digits','𝟙𝟝𝟘'],['unicode-space','\u00a0\u2003150\u3000'],['zero-prefix','0１５０'],
  ['mixed-entity','1&#53;0'],['ascii-space','\t150\n'],['ascii-zero','000150']];
 const unknown=[['positive-prefix','150PS'],['internal-space','150 180'],['exponent','1e2'],['decimal','150.0'],
  ['composite','133,136'],['large-composite','250,150'],['large-prefix','250hp'],['unavailable','N/A'],['zero','0'],['blank','']];
 const rows=[...Array.from({length:52},(_,i)=>raw('range-known-'+i,{FINISH:1000000-i*1000})),
  ...normalized.map(([id,PW],i)=>raw(id,{PW,FINISH:2000000+i*1000})),
  ...unknown.map(([id,PW],i)=>raw(id,{PW,FINISH:4000000+i*1000})),
  raw('below',{PW:'99',FINISH:5000000}),raw('above',{PW:'161',FINISH:5001000}),
  raw('normalized-below',{PW:'０９９',FINISH:5002000}),raw('normalized-above',{PW:'１７０',FINISH:5003000})];
 const source=oracle(rows,index);t.after(source.close);
 const power=buildJapanPowerCandidatePlan({powerFrom:100,powerTo:160,index,editorial:emptyEditorial});
 const resolved=resolveJapanSourceSelection({power,sourceModels:source.sourceModels,directoryComplete:true});assert(resolved.selection);assert(resolved.complete);
 const query:AjesQuery={table:'stats',sort,powerFrom:100,powerTo:160},filter=ajesResultFilter({market:'japan',powerFrom:100,powerTo:160});
 const expectedKnown=rows.filter(row=>row.ID.startsWith('range-known-')||normalized.some(([id])=>id===row.ID)).map(row=>source.admit(row)!);
 const expectedUnknown=unknown.map(([id])=>source.admit(rows.find(row=>row.ID===id)!)!);
 for(const offer of expectedKnown)assert.equal(japanSupplierPower(offer)?.hp,150);
 for(const offer of expectedUnknown)assert.equal(japanUnknownPower(offer),true);
 const {actual,pages}=await drainPowerPages(source,rows,query,resolved.selection,filter,index);
 assert.equal(pages[0].items.length,24);assert.equal(pages[1].items.length,24);
 const expected=[...expectedKnown.sort(order(sort)),...expectedUnknown.sort(order(sort))];
 assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row.id));assert.equal(new Set(actual.map(row=>row.id)).size,actual.length);
 const kIds=new Set(source.calls.filter(call=>call.phase==='k').flatMap(call=>call.rawIds));
 for(const [id] of normalized)assert(kIds.has(id),'normalization must not lose a real 150 hp row before local filtering');
 assert(!kIds.has('composite'));assert(!kIds.has('large-composite'));
 const uIds=new Set(source.calls.filter(call=>call.phase==='u').flatMap(call=>call.rawIds));
 for(const [id] of unknown)assert(uIds.has(id),'unknown PW remains reachable even with a positive or out-of-range numeric prefix');
 assert(actual.slice(expectedKnown.length).every(japanUnknownPower));
});

test('coarse heavy-family SQL preserves passenger pages while exact and suffix trucks and buses are rejected',async t=>{
 const index=knowledge([]);
 const families=[['TOYOTA','COASTER'],['TOYOTA','DYNA'],['TOYOTA','TOYOACE'],['ISUZU','ELF'],['ISUZU','FORWARD'],
  ['MITSUBISHI','CANTER'],['MITSUBISHI','ROSA'],['MITSUBISHI FUSO','SUPER GREAT'],['FUSO','AERO QUEEN'],
  ['UD','QUON'],['UD TRUCKS','CONDOR'],['NISSAN DIESEL','CONDOR']];
 const exact=families.flatMap(([MARKA_NAME,MODEL_NAME],i)=>Array.from({length:16},(_,j)=>raw(`heavy-exact-${i}-${j}`,{MARKA_NAME,MODEL_NAME,FINISH:30000000-i*100-j})));
 const suffix=families.flatMap(([MARKA_NAME,model],i)=>[' WORK','-WORK','/WORK'].map((ending,j)=>raw(`heavy-suffix-${i}-${j}`,{MARKA_NAME,MODEL_NAME:model+ending,FINISH:20000000-i*100-j})));
 const otherExcluded=[raw('hino-bus',{MARKA_NAME:'HINO',MODEL_NAME:'SELEGA WORK',FINISH:19000000}),
  raw('explicit-bus',{MODEL_NAME:'GENERIC',BODY_TYPE:'bus',FINISH:19000001}),raw('explicit-coach',{MODEL_NAME:'GENERIC',BODY_TYPE:'coach',FINISH:19000002})];
 const passengers=[raw('passenger-ranger',{MARKA_NAME:'FORD',MODEL_NAME:'RANGER',FINISH:2000000}),
  raw('passenger-suv',{MARKA_NAME:'ISUZU',MODEL_NAME:'MU-X',FINISH:2000001}),
  raw('passenger-minivan',{MARKA_NAME:'MITSUBISHI',MODEL_NAME:'DELICA',FINISH:2000002}),
  raw('passenger-van',{MODEL_NAME:'HIACE',FINISH:2000003}),
  ...Array.from({length:56},(_,i)=>raw('passenger-'+i,{FINISH:1000000-i*1000}))];
 const rows=[...exact,...suffix,...otherExcluded,...passengers],source=oracle(rows,index);t.after(source.close);
 for(const row of [...exact,...suffix,...otherExcluded])assert.equal(source.admit(row),null,'the unchanged local admission rejects the protected vehicle');
 const expected=passengers.map(row=>source.admit(row));assert(expected.every(Boolean));
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial:emptyEditorial});
 const resolved=resolveJapanSourceSelection({power,sourceModels:source.sourceModels,directoryComplete:true});assert(resolved.selection);
 const query:AjesQuery={table:'stats',sort:'totalRubDesc',powerTo:160},filter=ajesResultFilter({market:'japan',powerTo:160});
 const {actual,pages}=await drainPowerPages(source,rows,query,resolved.selection,filter,index);
 assert.equal(pages[0].items.length,24);assert.equal(pages[1].items.length,24);assert(pages[0].reads>=3,'local suffix rejection must refill the passenger page');
 assert.deepEqual(actual.map(row=>row.id),expected.sort(order('totalRubDesc')).map(row=>row!.id));
 assert.equal(new Set(actual.map(row=>row.id)).size,60);
 const rawIds=new Set(source.calls.flatMap(call=>call.rawIds));
 assert(exact.every(row=>!rawIds.has(row.ID)),'exact protected families are removed before LIMIT');
 assert(suffix.every(row=>rawIds.has(row.ID)),'the finite source fixture exercises conservative suffix candidates');
 assert(rawIds.has('explicit-bus')&&rawIds.has('explicit-coach'));
});

test('an old SUV fact cannot disable the modern power/body scope before ordinary 24→48 pages',async t=>{
 const old={...fact('Toyota','SUV COHORT',150),year:1999};
 const modern={...fact('Toyota','SUV COHORT',150),year:2020};
 const index=knowledge([old,modern]);
 const id=(prefix:string,i:number)=>prefix+String(i).padStart(3,'0');
 const nonSuv=Array.from({length:240},(_,i)=>raw(id('sedan-',i),{
  YEAR:2020,MODEL_NAME:'SEDAN ONLY',BODY_TYPE:'sedan',PW:'150',AUCTION_DATE:'2026-11-28',FINISH:30000000-i}));
 // A matching source model/year is only a candidate: its conflicting engine
 // volume cannot certify the body or hp of this different modification.
 const unmatched=Array.from({length:8},(_,i)=>raw(id('unmatched-',i),{
  YEAR:2020,MODEL_NAME:'SUV COHORT',ENG_V:1000,PW:'150',AUCTION_DATE:'2026-11-27',FINISH:20000000-i}));
 const known=Array.from({length:60},(_,i)=>raw(id('suv-known-',i),{
  YEAR:2020,MODEL_NAME:'SUV COHORT',PW:'280',AUCTION_DATE:'2026-11-25',FINISH:1000000-i}));
 // These newer rows have an explicit source body but no matching local hp
 // donor. They must remain reachable in U after every known modern SUV.
 const unknown=Array.from({length:12},(_,i)=>raw(id('suv-unknown-',i),{
  YEAR:2020,MODEL_NAME:'SUV COHORT',BODY_TYPE:'suv',ENG_V:1000,PW:'',AUCTION_DATE:'2026-11-26',FINISH:2000000-i}));
 const rows=[...nonSuv,...unmatched,...known,...unknown,raw('old-suv',{YEAR:1999,MODEL_NAME:'SUV COHORT'})];
 const source=oracle(rows,index);t.after(source.close);
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial:emptyEditorial});
 const body=buildJapanBodyCandidatePlan({selection:'suv',index,editorial:emptyEditorial,observedSourceFields:[]});
 const resolved=resolveJapanSourceSelection({power,body,sourceModels:source.sourceModels,directoryComplete:true});
 assert(resolved.selection,'an inadmissible old annual fact must not turn the whole combined selection into broad fallback');
 assert.equal(resolved.complete,false,'unobserved source body coverage remains explicitly incomplete');
 assert.deepEqual(resolved.unresolved,['body_source_schema_unobserved']);
 assert.deepEqual(resolved.selection.body?.models,[{make:'TOYOTA',model:'SUV COHORT',years:[2020]}]);
 const filter=ajesResultFilter({market:'japan',bodyType:'suv',powerTo:160});
 for(const row of [...nonSuv,...unmatched]){
  const admitted=source.admit(row);assert(admitted);assert.equal(filter.matches(admitted),false);
 }
 assert.equal(source.admit(rows.at(-1)!),null);
 for(const row of known){const admitted=source.admit(row)!;assert.equal(admitted.bodyType,'suv');assert.equal(japanLocalPowerHp(admitted),150);}
 for(const row of unknown){const admitted=source.admit(row)!;assert.equal(admitted.bodyType,'suv');assert(japanUnknownPower(admitted));}
 const query:AjesQuery={table:'stats',powerTo:160};
 const {actual,pages}=await drainPowerPages(source,rows,query,resolved.selection,filter,index);
 for(const page of pages.slice(0,2)){assert.equal(page.items.length,24);assert.equal(page.scanLimited,false);}
 assert.deepEqual(pages[0].items.map((offer:any)=>offer.id),known.slice(0,24).map(row=>'ajes-stats-'+row.ID));
 assert.deepEqual(pages[1].items.map((offer:any)=>offer.id),known.slice(24,48).map(row=>'ajes-stats-'+row.ID));
 assert.deepEqual(actual.map(offer=>offer.id),[...known,...unknown].map(row=>'ajes-stats-'+row.ID));
 assert.equal(new Set(actual.map(offer=>offer.id)).size,72);
 assert(actual.slice(0,known.length).every(offer=>!japanUnknownPower(offer)));
 assert(actual.slice(known.length).every(japanUnknownPower));
 const sourceIds=new Set(source.calls.flatMap(call=>call.rawIds));
 assert(nonSuv.every(row=>!sourceIds.has(row.ID)),'the long unrelated 150 hp prefix is removed before LIMIT');
 assert(unmatched.every(row=>sourceIds.has(row.ID)),'the fixture exercises final local body admission, not just source cohort membership');
 assert(source.calls.some(call=>call.phase==='u'));
 assert(source.calls.every(call=>call.sql.includes('order by auction_date desc, id asc')));
});

test('unknown body schema retains exact encyclopedia/editorial candidates and an incomplete scope',async t=>{
 const index=knowledge([fact('Toyota','LOCAL',150)]);
 const editorial={revision:'body-e1',entries:{'ajes-stats-manual-body':{id:'ajes-stats-manual-body',market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'manual-body',status:'visible',specifications:{bodyType:'suv'}}}} as unknown as CatalogEditorialIndex;
 const rows=[...Array.from({length:240},(_,i)=>raw('body-unknown-'+i,{PW:'',FINISH:10000000-i})),
  ...Array.from({length:50},(_,i)=>raw('body-local-'+i,{MODEL_NAME:i%2?'ＬＯＣＡＬ':'L O C A L',FINISH:1000000-i})),raw('manual-body')];
 const source=oracle(rows,index,editorial);t.after(source.close);
 const body=buildJapanBodyCandidatePlan({selection:'suv',index,editorial,observedSourceFields:['ID','MODEL_NAME','PW']});
 const resolved=resolveJapanSourceSelection({body,sourceModels:source.sourceModels,directoryComplete:true});
 assert.equal(resolved.complete,false);assert(resolved.selection);assert(resolved.unresolved.includes('body_source_schema_unobserved'));
 const filter=ajesResultFilter({market:'japan',bodyType:'suv'});const expected=rows.map(source.admit).filter(offer=>offer&&filter.matches(offer)).sort(order('totalRubDesc'));
 let after:string|undefined;const actual:any[]=[];
 for(let page=1;page<=3;page++){
  const result=await readFilteredAjesPage({page,pageSize:24,after,cursorKey:JSON.stringify(resolved.selection),itemKey:offer=>offer.id,sourceSelection:resolved.selection!,
   read:async sourcePage=>{const value=source.read({table:'stats',sort:'totalRubDesc',page:sourcePage,pageSize:24,sourceSelection:resolved.selection!});return {...value,items:value.items.filter(filter.matches)};}});
  actual.push(...result.items);after=result.nextCursor??undefined;if(!result.hasMore)break;
 }
 assert.equal(actual.length,51);assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row!.id));
 assert(source.calls.every(call=>!call.rawIds.some(id=>id.startsWith('body-unknown-'))));
});

test('observed raw body candidates preserve fullwidth and repeated-space labels before final filtering',t=>{
 const index=knowledge([]),rows=[raw('suv-width',{BODY_TYPE:'ＣＲＯＳＳＯＶＥＲ'}),raw('wagon-space',{BODY_TYPE:'station  wagon'}),raw('sedan',{BODY_TYPE:'sedan'}),raw('body-empty')];
 const source=oracle(rows,index);t.after(source.close);
 for(const [selection,id] of [['suv','suv-width'],['wagon','wagon-space']]){
  const body=buildJapanBodyCandidatePlan({selection,index,editorial:emptyEditorial,observedSourceFields:['BODY_TYPE']});
  const result=resolveJapanSourceSelection({body,sourceModels:source.sourceModels,directoryComplete:true});assert(result.selection);assert(result.complete);
  const filter=ajesResultFilter({market:'japan',bodyType:selection});
  const read=source.read({table:'stats',sourceSelection:result.selection as AjesSourceSelection});
  assert.deepEqual(read.items.filter(filter.matches).map(row=>row.id),['ajes-stats-'+id]);
 }
});

test('a manual body ID retains a local horsepower override outside every body donor cohort',async t=>{
 const powerFact=fact('Toyota','POWER ONLY',120);delete powerFact.values.bodyType;delete powerFact.constraints.bodyType;delete powerFact.sources.bodyType;
 const index=knowledge([powerFact]),editorial={revision:'body-manual',entries:{'ajes-stats-body-edited':{
  id:'ajes-stats-body-edited',market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'body-edited',status:'visible',specifications:{bodyType:'suv'},
 }}} as unknown as CatalogEditorialIndex;
 const rows=[raw('body-edited',{MODEL_NAME:'POWER ONLY',PW:'400'}),raw('unedited-same-model',{MODEL_NAME:'POWER ONLY',PW:'400'}),raw('supplier-only')];
 const source=oracle(rows,index,editorial);t.after(source.close);
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial}),body=buildJapanBodyCandidatePlan({selection:'suv',index,editorial,observedSourceFields:[]});
 assert.equal(body.models.length,0);assert.deepEqual(body.ids,['body-edited']);
 const resolved=resolveJapanSourceSelection({power,body,sourceModels:source.sourceModels,directoryComplete:true});assert(resolved.selection);
 const filter=ajesResultFilter({market:'japan',bodyType:'suv',powerTo:160});
 const result=source.read({table:'stats',powerTo:160,sourceSelection:resolved.selection!,sourcePhase:'k'});
 const accepted=result.items.filter(filter.matches);assert.deepEqual(accepted.map(row=>row.id),['ajes-stats-body-edited']);
 assert.equal(japanLocalPowerHp(accepted[0]),120);assert.equal(resolved.complete,false);
 assert(source.calls[0].sql.includes("id='body-edited'"));
});

for(const count of [25,50,100])test(`${count} mixed-make annual cohorts stay complete after source SQL compression`,async t=>{
 const makes=['TOYOTA','HONDA','NISSAN','SUZUKI','MAZDA','SUBARU','MITSUBISHI','DAIHATSU','AUDI','BMW'];
 const facts=Array.from({length:count},(_,i)=>({...fact(makes[i%makes.length],'MODEL '+Math.floor(i/makes.length),150),year:2008+i%19}));
 const index=knowledge(facts),rows=facts.flatMap((entry,i)=>[
  raw('cohort-'+i,{MARKA_NAME:entry.make,MODEL_NAME:entry.model,YEAR:entry.year,PW:'350',FINISH:1000000-i}),
  // A second make with the same raw model/year may enter the shorter source
  // superset. Its lack of matching local evidence must still reject PW350.
  raw('foreign-'+i,{MARKA_NAME:'LEXUS',MODEL_NAME:entry.model,YEAR:entry.year,PW:'350',FINISH:2000000-i}),
 ]);
 const source=oracle(rows,index);t.after(source.close);
 const power=buildJapanPowerCandidatePlan({powerTo:160,index,editorial:emptyEditorial});
 const resolved=resolveJapanSourceSelection({power,sourceModels:source.sourceModels,directoryComplete:true});assert(resolved.selection);assert(resolved.complete);
 const candidates:any[]=[];for(let page=1;;page++){
  const result=source.read({table:'stats',sort:'totalRubDesc',page,pageSize:48,powerTo:160,sourceSelection:resolved.selection!,sourcePhase:'k'});
  candidates.push(...result.items);if(result.received<48)break;
 }
 const candidateIds=new Set(candidates.map(row=>row.id));
 for(let i=0;i<count;i++)assert(candidateIds.has('ajes-stats-cohort-'+i),'compression must retain every original exact make/model/year candidate');
 assert(candidateIds.has('ajes-stats-foreign-0'),'the fixture exercises a real conservative source expansion');
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const actual=candidates.filter(filter.matches),expected=rows.map(source.admit).filter((row):row is NonNullable<ReturnType<typeof source.admit>>=>Boolean(row)&&filter.matches(row)).sort(order('totalRubDesc'));
 assert.equal(actual.length,count);assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row.id));
 const selectedMake=source.read({table:'stats',make:'TOYOTA',pageSize:48,powerTo:160,sourceSelection:resolved.selection!,sourcePhase:'k'});
 assert(selectedMake.items.every(row=>row.make==='TOYOTA'),'the explicit outer make filter is preserved');
 assert(source.calls[source.calls.length-1].sql.includes("marka_name='TOYOTA'"));
});
