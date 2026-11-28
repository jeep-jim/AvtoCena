import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ajesLot,ajesQuery,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';
import {applyAjesLotAdmission} from '../apps/web/lib/catalog/ajes-admission';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {readPowerOrderedAjesPage,ajesPowerEvidenceEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {japanLocalPowerHp,japanSupplierPower,japanUnknownPower} from '../apps/web/lib/catalog/japan-source-power';
import {buildJapanPowerCandidatePlan,resolveJapanSourceSelection} from '../apps/web/lib/catalog/japan-source-selection';
import {buildJapanBodyCandidatePlan} from '../apps/web/lib/catalog/japan-body-selection';
import {checksum,modelKey,type CalculationFact,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from '../apps/web/lib/catalog/editorial';

const observedAt='2026-11-28T17:00:00.000Z';
const emptyEditorial:CatalogEditorialIndex={revision:'completeness-empty',entries:{}};
const raw=(id:string,patch:Record<string,unknown>={})=>({ID:id,YEAR:2023,AUCTION_TYPE:2,STATUS:'Sold',FINISH:950000,
 MARKA_NAME:'TOYOTA',MODEL_NAME:'SOURCE ONLY',AUCTION_DATE:'2026-11-28',PW:'400',TIME:'P',FUEL:'',
 ENG_V:2000,GRADE:'2.0 G',KUZOV:'',PRIV:'FF',KPP:'AT',BODY_TYPE:'',IMAGES:'',...patch});
type WireRow=ReturnType<typeof raw>;
type Bounds=Pick<AjesQuery,'powerFrom'|'powerTo'>;
function knowledge(powerHp:number):CalculationIndex {
 const fact:CalculationFact={make:'Audi',model:'A4',modelId:'Audi/A4',variantId:'A4-2.0-g',revision:'r1',year:2023,trims:['20g'],
  constraints:{engineCc:2000,fuel:'petrol',powerHp},values:{engineCc:2000,fuel:'petrol',powerHp},
  sources:{powerHp:{kind:'manufacturer',url:'https://example.com/offline-completeness-fixture'}}};
 const models={[modelKey(fact.make,fact.model)]:[fact]};
 return {version:1,digest:checksum(models),manifestDigest:'offline-completeness',createdAt:observedAt,models};
}
function editorialFor(id:string,specifications:Record<string,unknown>,entryId='ajes-stats-'+id):CatalogEditorialIndex {
 // A test can vary the persisted value's id independently of the dictionary
 // key and source identity actually used by admission.
 return {revision:'completeness-editorial',entries:{['ajes-stats-'+id]:{
  id:entryId,market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:id,status:'visible',specifications,
 }}} as unknown as CatalogEditorialIndex;
}

/** Execute production SQL over a finite table, then use actual admission,
 * public safety and result filtering. Adapt only SQLite's numeric affinity and
 * absent POSIX whitespace class; this is not a supplier compatibility test. */
function oracle(rows:WireRow[],index:CalculationIndex|null=null,editorial=emptyEditorial,regexFlags:'i'|'iu'='i'){
 const db=new DatabaseSync(':memory:');
 db.function('regexp',(pattern:any,value:any)=>value==null?null:Number(new RegExp(String(pattern).replaceAll('[[:space:]]','\\s'),regexFlags).test(String(value))));
 db.exec('create table stats(ID text,YEAR integer,AUCTION_TYPE integer,STATUS text,FINISH real,MARKA_NAME text collate nocase,MODEL_NAME text collate nocase,AUCTION_DATE text,PW text,TIME text,FUEL text,ENG_V integer,GRADE text,KUZOV text,PRIV text,KPP text,BODY_TYPE text,IMAGES text)');
 const columns=Object.keys(raw('schema'));
 const insert=db.prepare(`insert into stats (${columns.join(',')}) values (${columns.map(()=>'?').join(',')})`);
 for(const row of rows)insert.run(...columns.map(key=>(row as any)[key]??null));
 const admit=(row:Record<string,unknown>)=>{
  const lot=ajesLot(row,'stats',false);if(!lot)return null;
  const sourcePrice=Number(row.FINISH),effectiveRate=.6;
  const rate={currency:'JPY',sourcePrice,effectiveRate,cbrRate:60,nominal:100,rateDate:'2026-11-28',rateSource:'cbr',sourcePriceRub:Math.round(sourcePrice*effectiveRate)} as const;
  const offer=applyAjesLotAdmission(lot,rate,observedAt,{calculationIndex:index,editorial});
  return offer?safePublicPricing(offer):null;
 };
 // Match the existing model-directory parser in ajes-client: it trims wire
 // names. A directory entry therefore cannot prove the untrimmed LIST spelling.
 const sourceModels=[...new Map(rows.map(row=>{
  const make=String(row.MARKA_NAME).trim(),model=String(row.MODEL_NAME).trim();
  return [JSON.stringify([make,model]),{make,model,total:1}] as const;
 })).values()];
 const select=(query:AjesQuery)=>{
  const sql=ajesQuery(query,index).sql.replace(/\bpw\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)/g,'cast(pw as real)$1$2');
  return db.prepare(sql).all();
 };
 return {admit,sourceModels,select,close:()=>db.close(),
  known(query:AjesQuery){
   const filter=ajesResultFilter({market:'japan',powerFrom:query.powerFrom,powerTo:query.powerTo});
   return select(query).map(admit).filter(offer=>offer&&filter.matches(offer)&&!japanUnknownPower(offer));
  },
  powerQuery(bounds:Bounds){
   const power=buildJapanPowerCandidatePlan({...bounds,index,editorial});
   const resolved=resolveJapanSourceSelection({power,sourceModels,directoryComplete:true});
   assert.equal(resolved.complete,true,JSON.stringify(resolved.unresolved));
   assert(resolved.selection);
   return {table:'stats',...bounds,sourceSelection:resolved.selection,sourcePhase:'k'} as AjesQuery;
  },
 };
}

test('a legacy editorial identity change retains owner power without a direct horsepower edit',t=>{
 const row=raw('owner-from-editorial'),unrelated=raw('unrelated-canonical');
 const editorial=editorialFor(row.ID,{make:'HONDA',model:'STEPWGN'},'legacy-value-id');
 const source=oracle([row,unrelated],null,editorial);t.after(source.close);
 const offer=source.admit(row);assert(offer);
 assert.equal(japanLocalPowerHp(offer),150);
 assert.equal(japanUnknownPower(offer),false);
 assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(offer),true);
 const query=source.powerQuery({powerTo:160});
 assert.deepEqual(source.known(query).map(offer=>offer!.id),['ajes-stats-owner-from-editorial']);
 assert(!source.select(query).some(value=>value.ID===unrelated.ID),'an unrelated canonical ID must not bypass the source power bound');
 const unrelatedOffer=source.admit(unrelated);assert(unrelatedOffer);
 assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(unrelatedOffer),false,'the broad candidate scope cannot make an unrelated high-PW row visible');
});

for(const regexFlags of ['i','iu'] as const)test(`normalized supplier IDs retain actual editorial power with exact IN and regexp/${regexFlags}`,t=>{
 const spellings=[['manual-direct','manual-direct'],['manual-direct','manual&#45;direct'],
  ['manual-direct',' manual-direct '],['manual-direct','ｍａｎｕａｌ-direct'],
  ['manual-K','manual-K'],['manual-s','manual-ſ']];
 const editorial={revision:'normalized-manual',entries:Object.assign({},...spellings.map(([id])=>
  editorialFor(id,{powerHp:150,powerDataConfidence:'verified'}).entries))};
 const rows=spellings.map(([,value])=>raw(value)),unrelated=raw('unrelated-canonical');
 const source=oracle([...rows,unrelated],null,editorial,regexFlags);t.after(source.close);
 const query=source.powerQuery({powerTo:160}),selected=new Set(source.select(query).map(row=>row.ID));
 for(const [position,row] of rows.entries()){
  const offer=source.admit(row);assert(offer);
  assert.equal(offer.id,'ajes-stats-'+spellings[position][0]);assert.equal(japanLocalPowerHp(offer),150);
  assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(offer),true);
  assert(selected.has(row.ID),'retain raw spelling '+JSON.stringify(row.ID));
 }
 assert.equal(source.known(query).length,rows.length);
 assert(!selected.has(unrelated.ID),'the normalization exception must not retain every canonical ID');
});

test('trimmed directory names cannot discard a matching normalized make or model',t=>{
 const rows=[raw('leading-model',{MARKA_NAME:'AUDI',MODEL_NAME:' A4'}),
  raw('leading-make',{MARKA_NAME:' AUDI',MODEL_NAME:'A4'}),
  raw('trailing-model',{MARKA_NAME:'AUDI',MODEL_NAME:'A4 '})];
 const source=oracle(rows,knowledge(150));t.after(source.close);
 assert.deepEqual(source.sourceModels,[{make:'AUDI',model:'A4',total:1}]);
 for(const row of rows){
  const offer=source.admit(row);assert(offer);assert.equal(japanLocalPowerHp(offer),150);
  assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(offer),true);
 }
 const actual=source.known(source.powerQuery({powerTo:160})).map(offer=>offer!.id).sort();
 assert.deepEqual(actual,rows.map(row=>'ajes-stats-'+row.ID).sort());
});

test('an absent upper bound preserves supplier horsepower above the UI input maximum',t=>{
 const row=raw('supplier-5000',{PW:'5000'}),source=oracle([row]);t.after(source.close);
 const offer=source.admit(row);assert(offer);assert.equal(japanSupplierPower(offer)?.hp,5000);
 assert.equal(ajesResultFilter({market:'japan',powerFrom:100}).matches(offer),true);
 assert.deepEqual(source.known(source.powerQuery({powerFrom:100})).map(offer=>offer!.id),['ajes-stats-supplier-5000']);
 assert.equal(ajesResultFilter({market:'japan',powerFrom:100,powerTo:2500}).matches(offer),false);
 assert.equal(source.select(source.powerQuery({powerFrom:100,powerTo:2500})).length,0);
});

test('an absent lower bound preserves a positive fractional local horsepower fact',t=>{
 const row=raw('fractional-local',{MARKA_NAME:'AUDI',MODEL_NAME:'A4'}),source=oracle([row],knowledge(.5));t.after(source.close);
 const offer=source.admit(row);assert(offer);assert.equal(japanLocalPowerHp(offer),.5);
 assert.equal(ajesResultFilter({market:'japan',powerTo:160}).matches(offer),true);
 assert.deepEqual(source.known(source.powerQuery({powerTo:160})).map(offer=>offer!.id),['ajes-stats-fractional-local']);
 assert.equal(ajesResultFilter({market:'japan',powerFrom:1,powerTo:160}).matches(offer),false);
 assert.equal(source.select(source.powerQuery({powerFrom:1,powerTo:160})).length,0);
});

for(const withPower of [false,true])test(`normalized manual body IDs survive ${withPower?'combined body/power':'body-only'} selection`,t=>{
 const id='manual-body',editorial=editorialFor(id,{bodyType:'suv'});
 const rows=[' manual-body ','manual&#45;body','ｍａｎｕａｌ-body'].map(value=>raw(value,{PW:'150'}));
 const source=oracle(rows,null,editorial);t.after(source.close);
 const body=buildJapanBodyCandidatePlan({selection:'suv',index:null,editorial,observedSourceFields:[]});
 const power=withPower?buildJapanPowerCandidatePlan({powerTo:160,index:null,editorial}):undefined;
 const resolved=resolveJapanSourceSelection({body,power,sourceModels:source.sourceModels,directoryComplete:true});
 assert(resolved.selection,'missing source body schema must still retain the known manual branch');
 assert.equal(resolved.complete,false,'the test does not certify unknown source body coverage');
 const query:AjesQuery={table:'stats',sourceSelection:resolved.selection,...(withPower?{powerTo:160,sourcePhase:'k' as const}:{})};
 const selected=new Set(source.select(query).map(row=>row.ID));
 const filter=ajesResultFilter({market:'japan',bodyType:'suv',...(withPower?{powerTo:160}:{})});
 for(const row of rows){
  const offer=source.admit(row);assert(offer);assert.equal(offer.bodyType,'suv');
  assert.equal(filter.matches(offer),true);assert(selected.has(row.ID),'retain edited body at raw ID '+JSON.stringify(row.ID));
 }
});

test('manual IDs preserve selective raw K while actual filtering preserves every unknown row in U',t=>{
 const values=['',null,'0','000','N/A','150,200','160.0','０','9007199254740992'];
 const unknown=values.map((PW,i)=>raw('unknown-'+i,{PW}));
 const over=raw('ordinary-over-limit'),known=raw('ordinary-in-range',{PW:'150'});
 const editorial=editorialFor('different-manual-id',{powerHp:150,powerDataConfidence:'verified'});
 const source=oracle([...unknown,over,known],null,editorial);t.after(source.close);
 const query=source.powerQuery({powerTo:160}),filter=ajesResultFilter({market:'japan',powerTo:160});
 assert(!source.select(query).some(row=>row.ID===over.ID),'an unrelated manual edit must not admit a canonical over-limit row');
 assert.deepEqual(source.known(query).map(offer=>offer!.id),['ajes-stats-ordinary-in-range']);
 const u=source.select({...query,sourcePhase:'u'}),selected=new Set(u.map(row=>row.ID));
 for(const row of unknown){
  const offer=source.admit(row);assert(offer);
  assert.equal(japanUnknownPower(offer),true,'fixture must be actually unknown: '+String(row.PW));
  assert.equal(filter.matches(offer),true);assert(selected.has(row.ID),'U must preserve '+String(row.PW));
 }
 const admittedUnknown=u.map(source.admit).filter(offer=>offer&&filter.matches(offer)&&japanUnknownPower(offer));
 assert.deepEqual(admittedUnknown.map(offer=>offer!.id).sort(),unknown.map(row=>'ajes-stats-'+row.ID).sort());
});

test('selective manual IDs skip 240 expensive non-matches and fill DESC 24→48 before the unknown lane',async t=>{
 const manualIds=['manual-after-prefix','manual-entity','manual-trim','manual-wide'];
 const manualRawIds=[manualIds[0],'manual&#45;entity',' manual-trim ','ｍａｎｕａｌ-wide'];
 const editorial={revision:'selective-manual',entries:Object.assign({},...manualIds.map(id=>
  editorialFor(id,{powerHp:150,powerDataConfidence:'verified'},'legacy-editorial-value-id').entries))};
 const prefix=Array.from({length:240},(_,i)=>raw('manual-fallback-over-'+i,{FINISH:30000000-i*1000}));
 const ordinary=[...manualRawIds.map((id,i)=>raw(id,{FINISH:1000000-i*1000})),
  ...Array.from({length:44},(_,i)=>raw('manual-fallback-visible-'+String(i).padStart(2,'0'),{PW:'150',FINISH:996000-i*1000}))];
 const unknown=Array.from({length:6},(_,i)=>raw('manual-fallback-unknown-'+i,{PW:'',FINISH:20000000-i*1000}));
 const excluded=[raw('outside-make',{MARKA_NAME:'HONDA',PW:'150',FINISH:60000000}),
  raw('outside-year',{YEAR:2022,PW:'150',FINISH:50000000}),
  raw('excluded-exact-heavy',{MODEL_NAME:'DYNA',PW:'150',FINISH:40000000})];
 const source=oracle([...excluded,...prefix,...ordinary,...unknown],null,editorial);t.after(source.close);
 const query={...source.powerQuery({powerTo:160}),make:'TOYOTA',yearFrom:2023,yearTo:2023,sort:'totalRubDesc'} as AjesQuery;
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const expectedKnown=ordinary.map(source.admit),expectedUnknown=unknown.map(source.admit);
 const expected=[...expectedKnown,...expectedUnknown];
 assert(expectedKnown.every(offer=>offer&&filter.matches(offer)&&!japanUnknownPower(offer)));
 assert(expectedUnknown.every(offer=>offer&&filter.matches(offer)&&japanUnknownPower(offer)));
 for(const offer of expectedKnown.slice(0,manualIds.length))assert.equal(japanLocalPowerHp(offer!),150,'every raw ID spelling must use the actual manual lookup');
 assert(prefix.every(row=>{const offer=source.admit(row);return offer&&!filter.matches(offer);}));
 let clock=0,after:string|undefined,finished=false;
 const calls:Array<{page:number;phase:string;rawIds:string[];known:number}>=[];
 const actual:NonNullable<ReturnType<typeof source.admit>>[]=[];
 const epoch=ajesPowerEvidenceEpoch({runtimeSha:'b'.repeat(40),editorialRevision:editorial.revision,calculationDigest:null});
 for(let page=1;page<=Math.ceil((prefix.length+ordinary.length+unknown.length)/24)*2+4;page++){
  const before=calls.length,previous=after;
  const result=await readPowerOrderedAjesPage({page,pageSize:24,after,evidenceEpoch:epoch,cursorKey:JSON.stringify(query),
   sourceSelection:query.sourceSelection,minimumReads:2,now:()=>clock,
   itemKey:offer=>offer.id,known:offer=>!japanUnknownPower(offer),
   read:async(sourcePage,phase)=>{
    clock+=9000;
    const rows=source.select({...query,page:sourcePage,pageSize:24,sourcePhase:phase});
    const items=rows.map(source.admit).filter((offer):offer is NonNullable<typeof offer>=>Boolean(offer)&&filter.matches(offer));
    calls.push({page:sourcePage,phase,rawIds:rows.map(row=>String(row.ID)),known:items.filter(offer=>!japanUnknownPower(offer)).length});
    return {items,received:rows.length,observedAt,stale:false,partial:false};
   }});
  assert(calls.length-before<=8,'manual identity exceptions never expand the per-request source read budget');
  assert.equal(result.partial,false);assert.equal(result.stale,false);assert.equal(Object.hasOwn(result,'total'),false);
  if(page<=2){
   assert.equal(result.items.length,24);assert.equal(result.reads,1);assert.equal(result.scanLimited,false);assert.equal(result.hasMore,true);
   assert.match(result.nextCursor!,new RegExp('^j2\\.k\\.'+(page+1)+'\\.0\\.'+(page+1)+'\\.'),'the emitted cursor follows the two full known pages');
   assert(calls.every(call=>call.phase==='k'&&call.rawIds.length===24&&call.known===24));
  }
  actual.push(...result.items);after=result.nextCursor??undefined;
  if(page<=2)assert.equal(actual.length,page*24,'the first ordinary append is actual 24→48');
  if(!result.hasMore){finished=true;break;}
  assert(after&&after!==previous,'a bounded incomplete request must return a progressing continuation');
 }
 assert(finished,'the finite K/U source eventually reaches actual exhaustion');
 assert.deepEqual(actual.map(offer=>offer.id),expected.map(offer=>offer!.id));
 assert.equal(actual.length,54);assert.equal(new Set(actual.map(offer=>offer.id)).size,54);
 for(const id of manualIds)assert.equal(actual.filter(offer=>offer.id==='ajes-stats-'+id).length,1);
 for(let i=1;i<actual.length;i++){
  const previousUnknown=japanUnknownPower(actual[i-1]),currentUnknown=japanUnknownPower(actual[i]);
  assert(!previousUnknown||currentUnknown,'known rows cannot follow the unknown lane');
  if(previousUnknown===currentUnknown)assert(Number(actual[i-1].operational?.raw?.finalPriceJpy)>=Number(actual[i].operational?.raw?.finalPriceJpy),'source JPY remains DESC within each lane across appends');
 }
 const knownRawIds=new Set(calls.filter(call=>call.phase==='k').flatMap(call=>call.rawIds));
 assert(prefix.every(row=>!knownRawIds.has(row.ID)),'unrelated canonical over-limit rows are excluded before LIMIT');
 const rawIds=new Set(calls.flatMap(call=>call.rawIds));
 for(const row of excluded)assert(!rawIds.has(row.ID),'manual identity exceptions must preserve outer make/year and heavy exclusions: '+row.ID);
 assert(calls.some(call=>call.phase==='u'),'exhaustion must inspect the broad unknown phase');
});

test('candidate heavy-family SQL preserves prior eligible rows while local admission rejects suffix variants',t=>{
 const ordinary=[raw('ordinary-corolla',{MODEL_NAME:'COROLLA',PW:'150'}),
  raw('ordinary-prefix',{MODEL_NAME:'DYNASTY',PW:'150'}),
  raw('ordinary-other-make',{MARKA_NAME:'HONDA',MODEL_NAME:'DYNA',PW:'150'})];
 const exact=[raw('exact-dyna',{MODEL_NAME:'DYNA',PW:'150'}),
  raw('exact-canter',{MARKA_NAME:'MITSUBISHI FUSO',MODEL_NAME:'CANTER',PW:'150'}),
  raw('exact-elf',{MARKA_NAME:'ISUZU',MODEL_NAME:'ELF',PW:'150'})];
 const suffixes=[raw('suffix-space',{MODEL_NAME:'DYNA 2.0 G',PW:'150'}),
  raw('suffix-hyphen',{MARKA_NAME:'MITSUBISHI FUSO',MODEL_NAME:'CANTER-CAB',PW:'150'}),
  raw('suffix-slash',{MARKA_NAME:'ISUZU',MODEL_NAME:'ELF/CREW',PW:'150'})];
 const source=oracle([...ordinary,...exact,...suffixes]);t.after(source.close);
 const query={...source.powerQuery({powerTo:160}),pageSize:48};
 // Every fixture has matching supplier hp, so removing the candidate descriptor
 // isolates the established full heavy-family predicate, without a power delta.
 const baseline=source.select({...query,sourceSelection:undefined,sourcePhase:undefined});
 const candidates=source.select(query),ids=new Set(candidates.map(row=>row.ID));
 assert.deepEqual(baseline.map(row=>row.ID).sort(),ordinary.map(row=>row.ID).sort());
 for(const row of baseline)assert(ids.has(row.ID),'preserve an eligible row from the original source query');
 for(const row of exact)assert(!ids.has(row.ID),'exclude the exact heavy family at source: '+row.MODEL_NAME);
 for(const row of suffixes){
  assert(ids.has(row.ID),'retain a suffix candidate for actual local admission: '+row.MODEL_NAME);
  assert.equal(source.admit(row),null,'the real admission path must reject '+row.MODEL_NAME);
 }
 assert.deepEqual(source.known(query).map(offer=>offer!.id).sort(),ordinary.map(row=>'ajes-stats-'+row.ID).sort());
});

test('36 heavy suffix candidates before 48 ordinary matches still fill 24 to 48 within the read budget',async t=>{
 const suffixes=Array.from({length:36},(_,i)=>raw('heavy-prefix-'+i,{MODEL_NAME:'DYNA CAB '+i,PW:'150',FINISH:30000000-i*1000}));
 const ordinary=Array.from({length:48},(_,i)=>raw('visible-'+String(i).padStart(2,'0'),{PW:'150',FINISH:1000000-i*1000}));
 const exact=raw('exact-before-all',{MODEL_NAME:'DYNA',PW:'150',FINISH:40000000});
 const source=oracle([exact,...suffixes,...ordinary]);t.after(source.close);
 const query={...source.powerQuery({powerTo:160}),sort:'totalRubDesc'} as AjesQuery;
 const filter=ajesResultFilter({market:'japan',powerTo:160});
 const expected=ordinary.map(row=>source.admit(row));
 assert(expected.every(offer=>offer&&filter.matches(offer)&&!japanUnknownPower(offer)));
 assert(suffixes.every(row=>source.admit(row)===null));
 let clock=0;
 const calls:Array<{page:number;phase:string;received:number;admitted:number;ids:string[]}>=[];
 const epoch=ajesPowerEvidenceEpoch({runtimeSha:'a'.repeat(40),editorialRevision:emptyEditorial.revision,calculationDigest:null});
 const options={pageSize:24,evidenceEpoch:epoch,cursorKey:JSON.stringify(query),sourceSelection:query.sourceSelection,
  minimumReads:2 as const,now:()=>clock,itemKey:(offer:NonNullable<ReturnType<typeof source.admit>>)=>offer.id,
  known:(offer:NonNullable<ReturnType<typeof source.admit>>)=>!japanUnknownPower(offer),
  read:async(page:number,phase:'k'|'u')=>{
   clock+=9000;
   const rows=source.select({...query,page,pageSize:24,sourcePhase:phase});
   const items=rows.map(source.admit).filter((offer):offer is NonNullable<typeof offer>=>Boolean(offer)&&filter.matches(offer)&&japanUnknownPower(offer)===(phase==='u'));
   calls.push({page,phase,received:rows.length,admitted:items.length,ids:rows.map(row=>String(row.ID))});
   return {items,received:rows.length,observedAt,stale:false,partial:false};
  }};
 const first=await readPowerOrderedAjesPage({...options,page:1});
 const firstReads=calls.length;
 assert.equal(first.items.length,24);assert.equal(first.scanLimited,false);assert.equal(first.partial,false);assert.equal(first.stale,false);
 assert(firstReads<=8);assert(firstReads>=3,'a fully rejected first source page cannot count as a visible page');
 assert.equal(calls[0].received,24);assert.equal(calls[0].admitted,0);
 assert(calls[0].ids.every(id=>id.startsWith('heavy-prefix-')),'the production query must expose the intended suffix-heavy prefix');
 assert(first.nextCursor);
 const second=await readPowerOrderedAjesPage({...options,page:2,after:first.nextCursor});
 assert.equal(second.items.length,24);assert.equal(second.scanLimited,false);assert.equal(second.partial,false);assert.equal(second.stale,false);
 assert(calls.length-firstReads<=8);
 const ids=[...first.items,...second.items].map(offer=>offer.id);
 assert.equal(new Set(ids).size,48);assert.deepEqual(ids,expected.map(offer=>offer!.id));
 assert(calls.every(call=>call.phase==='k'),'the first two visible pages consume known candidates only');
 assert.equal(second.hasMore,true,'48 known rows do not prove exhaustion of the unread unknown phase');
 assert.equal(Object.hasOwn(first,'total'),false);assert.equal(Object.hasOwn(second,'total'),false);
});
