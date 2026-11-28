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

for(const sort of ['totalRubDesc','totalRub'] as const)test(`source ${sort} skips a long unrelated window and fills 24→48 before the unknown lane`,async t=>{
 const manual=fact('Toyota','MANUAL',120);manual.sources.powerHp={kind:'manual',url:'https://example.com/offline-manual-fixture'};
 const index=knowledge([fact('Toyota','LOCAL',150),fact('Toyota','STRONG',180),manual]);
 const editorial=emptyEditorial;
 const rows=[
  ...Array.from({length:240},(_,i)=>raw('expensive-unknown-'+i,{PW:'',FINISH:30000000-i*1000})),
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
 for(let page=1;page<=Math.ceil(expected.length/24)+2;page++){
  const before=source.calls.length;
  const result=await readPowerOrderedAjesPage({page,pageSize:24,after,evidenceEpoch:epoch,cursorKey:JSON.stringify({sort,selection:resolved.selection}),
   itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),sourceSelection:resolved.selection!,minimumReads:2,now:()=>clock,
   read:async(sourcePage,phase)=>{
    clock+=9000;const selected=source.read({table:'stats',sort,powerTo:160,page:sourcePage,pageSize:24,sourceSelection:resolved.selection!,sourcePhase:phase});
    return {...selected,items:selected.items.filter(offer=>filter.matches(offer)&&japanUnknownPower(offer)===(phase==='u'))};
   }});
  assert(source.calls.length-before<=8,'the ordinary per-request source admission budget remains bounded');
  assert.equal(result.partial,false);assert.equal(result.stale,false);assert.equal(result.scanLimited,false);
  assert.equal(result.items.length,Math.min(24,expected.length-actual.length),'fill the requested page despite a slow previous source read');
  pages.push(result);actual.push(...result.items);after=result.nextCursor??undefined;if(!result.hasMore)break;
 }
 assert.equal(pages[0].items.length,24);assert.equal(pages[1].items.length,24);
 assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row.id));assert.equal(new Set(actual.map(row=>row.id)).size,actual.length);
 assert.equal(actual.filter(row=>row.id.includes('expensive-over')||row.id.includes('local-over-')).length,0);
 const firstUnknown=actual.findIndex(japanUnknownPower);assert(firstUnknown>=48);assert(actual.slice(firstUnknown).every(japanUnknownPower));
 assert.equal(actual.filter(row=>row.id==='ajes-stats-local-override').length,1);
 assert(source.calls.filter(call=>call.phase==='k').every(call=>!call.rawIds.some(id=>id.startsWith('expensive-unknown-')||id.startsWith('expensive-over-'))));
 if(sort==='totalRubDesc')assert(pages[0].reads>=3,'slow locally rejected candidate pages are refilled before returning visible page one');
 assert(source.calls.some(call=>call.phase==='u'));
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
