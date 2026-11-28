import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {AJES_CENSUS_FIELDS,ajesCatalogQuery,ajesQuery,ajesLot,AjesInputError} from '../apps/web/lib/catalog/ajes-query';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {AJES_CENSUS_PREDICATE_VERSION,applyAjesLotAdmission,ajesCensusFields,ajesRequestedCountQueryHash,evaluateAjesCensusGroup,parseAjesCensusGroups,readAjesCensusCount,type AjesCensusGroup} from '../apps/web/lib/catalog/ajes-census';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {japanUnknownPower} from '../apps/web/lib/catalog/japan-source-power';
import {compileModelFacts,checksum,modelKey} from '../apps/web/lib/encyclopedia/calculation-index';

const now=Date.parse('2026-11-28T08:00:00Z'),observedAt=new Date(now-1000).toISOString();
const params={market:'japan',powerTo:'160',city:'Новокузнецк'};
const base={MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,GRADE:'',KUZOV:'',ENG_V:1490,PRIV:'FF',KPP:'AT',TIME:'P',PW:'150',FINISH:935000,STATUS:'Sold',COLOR:'white',BODY_TYPE:'',VEHICLE_CATEGORY:'',FUEL:''};
const rate=async(amount:number)=>({currency:'JPY',sourcePrice:amount,sourcePriceRub:amount*0.6,effectiveRate:0.6,cbrRate:60,nominal:100,rateDate:'2026-11-28',rateSource:'cbr'} as any);
const emptySnapshot=()=>({editorial:{revision:'fixture-1',entries:{}} as any,calculationIndex:null as any});
function groupsFor(rows:any[]):AjesCensusGroup[]{
 const grouped=new Map<string,AjesCensusGroup>();
 for(const row of rows){
  const values=Object.fromEntries(AJES_CENSUS_FIELDS.map(field=>[field,row[field]??null])),key=JSON.stringify(values);
  const group=grouped.get(key)??{values,total:0,validIds:0,validFinishes:0};group.total++;group.validIds+=Number(/^[A-Za-z0-9_-]{1,64}$/.test(row.ID));
  group.validFinishes+=Number(/^[0-9]+([.][0-9]+)?$/.test(String(row.FINISH))&&Number(row.FINISH)>0&&Number(row.FINISH)<=Number.MAX_SAFE_INTEGER);grouped.set(key,group);
 }
 return [...grouped.values()];
}
function fixture(rows:any[],selection:Record<string,unknown>=params,snapshot=emptySnapshot()){
 const groups=groupsFor(rows),queries:any[]=[];
 const options={params:selection,query:{table:'stats' as const,powerTo:160},fields:AJES_CENSUS_FIELDS,snapshot,evidenceEpoch:'e'.repeat(64),
  sourceCount:{total:rows.length,distinctTotal:new Set(rows.map(row=>row.ID)).size,observedAt},rate,assertCurrent:async()=>{},now:()=>now,
  read:async(query:any)=>{queries.push(query);const values=query.correctionId?groupsFor(rows.filter(row=>row.ID===query.correctionId)):groups;
   const page=values.slice((query.page-1)*500,query.page*500);return {groups:page,received:page.length,page:query.page,pageSize:500,observedAt};}};
 return {options,queries,groups,count:()=>readAjesCensusCount(options)};
}
async function realListMembership(rows:any[],selection:Record<string,unknown>,snapshot=emptySnapshot()){
 const filter=ajesResultFilter(selection),items=[];
 for(const row of rows){
  const lot=ajesLot({...row,AUCTION_TYPE:2},'stats',false);if(!lot)continue;
  const offer=applyAjesLotAdmission(lot,await rate(lot.finalPriceJpy!),observedAt,snapshot);if(!offer)continue;
  const safe=filter.powerFilter?safePublicPricing(offer):offer;if(filter.matches(safe))items.push(safe);
 }
 return items;
}
/** Complete immutable test data only. These numeric evaluator results do not
 * establish a provider snapshot and deliberately contain no exact-count proof. */
async function offlineWeightedAdmission(groups:AjesCensusGroup[],selection:Record<string,unknown>=params,snapshot=emptySnapshot()){
 let total=0,knownTotal=0,unknownTotal=0;
 for(const group of groups){
  const value=await evaluateAjesCensusGroup(group,{params:selection,snapshot,observedAt,rate});
  if(value.admitted){total+=group.total;if(value.known)knownTotal+=group.total;else unknownTotal+=group.total;}
 }
 return {total,knownTotal,unknownTotal,groupCount:groups.length};
}

test('mixed GROUP pages with unchanged source cardinality cannot create an exact zero',async()=>{
 const before=Array.from({length:501},(_,i)=>({...base,ID:'row-'+i,GRADE:'G'+String(i).padStart(4,'0'),PW:i===500?'150':'210'}));
 const after=before.map((row,i)=>({...row,PW:i===500?'210':'150'}));
 assert.equal((await realListMembership(before,params)).length,1);
 assert.equal((await realListMembership(after,params)).length,500);
 const source=fixture(before);
 source.options.read=async query=>{
  source.queries.push(query);
  const groups=groupsFor(query.page===1?before.slice(0,500):after.slice(500));
  return {groups,received:groups.length,page:query.page,pageSize:500,observedAt:new Date(now-(query.page===1?2000:1000)).toISOString()};
 };
 await assert.rejects(source.count(),/census_source_snapshot_unavailable/);
 assert.equal(source.queries.length,0,'never start a paged source census without a real snapshot contract');
});

test('editorial corrections from different observations cannot hide the remaining visible car',async()=>{
 const before=[{...base,ID:'x',PW:'150'},{...base,ID:'y',PW:'210'},{...base,ID:'z',PW:'150'}];
 const after=before.map(row=>({...row,PW:row.ID==='x'?'210':'150'}));
 const snapshot=emptySnapshot();
 const hidden=(id:string)=>({id:'ajes-stats-'+id,sourceOfferId:id,sourceId:'ajes_japan_feed',market:'japan',status:'hidden',specifications:{}});
 snapshot.editorial.entries={'ajes-stats-x':hidden('x'),'ajes-stats-y':hidden('y')};
 assert.deepEqual((await realListMembership(before,params,snapshot)).map(row=>row.id),['ajes-stats-z']);
 assert.deepEqual((await realListMembership(after,params,snapshot)).map(row=>row.id),['ajes-stats-z']);
 const source=fixture(before,params,snapshot);
 source.options.read=async query=>{
  source.queries.push(query);
  const rows=query.correctionId?(query.correctionId==='x'?before:after).filter(row=>row.ID===query.correctionId):before;
  const groups=groupsFor(rows);
  return {groups,received:groups.length,page:1,pageSize:500,observedAt:new Date(now-(query.correctionId==='y'?1000:2000)).toISOString()};
 };
 await assert.rejects(source.count(),/census_source_snapshot_unavailable/);
 assert.equal(source.queries.length,0,'neither GROUP nor per-ID corrections may run without the same source snapshot');
});

test('offline weighted evaluator matches the fixed 50 known +23 unknown fixture without claiming a source proof',async()=>{
 const rows=[...Array.from({length:50},(_,i)=>({...base,ID:'known-'+i})),...Array.from({length:23},(_,i)=>({...base,ID:'unknown-'+i,PW:''})),
  ...Array.from({length:19},(_,i)=>({...base,ID:'excluded-'+i,PW:'220'}))];
 const source=fixture(rows),result=await offlineWeightedAdmission(source.groups),reference=await realListMembership(rows,params);
 assert.equal(reference.length,73);assert.equal(result.total,reference.length);assert.equal(result.knownTotal,reference.filter(row=>!japanUnknownPower(row)).length);
 assert.equal(result.unknownTotal,23);assert.equal(result.groupCount,3);assert.equal(source.groups.reduce((sum,group)=>sum+group.total,0),92);
 assert.equal('countProof' in result,false);assert.equal(source.queries.length,0);
 const queryHash=ajesRequestedCountQueryHash(params);
 for(const extra of [{sort:'totalRubDesc',page:2},{sort:'totalRub',after:'cursor',pageSize:48,view:'list'}])
  assert.equal(ajesRequestedCountQueryHash({...params,...extra}),queryHash);
 assert.notEqual(ajesRequestedCountQueryHash({...params,city:'Москва'}),queryHash);
});

test('offline row evaluator applies owner/manual/encyclopedia priority, bus/GVWR admission and combined local filters',async()=>{
 const rows=[{...base,ID:'manual-in',PW:'220'},{...base,ID:'manual-out'},{...base,ID:'hidden'},
  {...base,ID:'owner',MARKA_NAME:'HONDA',MODEL_NAME:'STEPWGN',PW:'240'},
  {...base,ID:'bus',GRADE:'BUS'},{...base,ID:'gross',MODEL_NAME:'HEAVY',GRADE:'1.5 AT'},
  {...base,ID:'known-local',MODEL_NAME:'LOCAL',GRADE:'1.5 AT',PW:'240'},
  {...base,ID:'unknown-list',PW:'150,170'},{...base,ID:'fraction',PW:'150.5'},
  {...base,ID:'blue',COLOR:'blue'},{...base,ID:'wrong-body',BODY_TYPE:'coach'}];
 const snapshot=emptySnapshot();
 const entry=(id:string,specifications:any,status='visible')=>({id:'ajes-stats-'+id,sourceOfferId:id,sourceId:'ajes_japan_feed',market:'japan',status,specifications});
 snapshot.editorial.entries={'ajes-stats-manual-in':entry('manual-in',{powerHp:145,powerDataSource:'manual',powerDataConfidence:'verified'}),
  'ajes-stats-manual-out':entry('manual-out',{powerHp:190,powerDataSource:'manual',powerDataConfidence:'verified'}),'ajes-stats-hidden':entry('hidden',{},'hidden')};
 const models=Object.fromEntries(['HEAVY','LOCAL'].map(model=>[modelKey('TOYOTA',model),compileModelFacts({id:model,make:'TOYOTA',model,revision:'r1',variants:[
  {id:model+'-v1',year:2023,trim:'1.5 AT',status:'observed',markets:['europe'],fuel:'petrol',engineCc:1490,powerHp:150,powertrainKind:'combustion',transmission:'automatic',drive:'fwd',bodyType:'van',grossVehicleWeightKg:model==='HEAVY'?4000:3000},
 ]} as any)]));
 snapshot.calculationIndex={version:1,digest:checksum(models),createdAt:observedAt,manifestDigest:'a'.repeat(64),models};
 for(const selection of [params,{...params,color:'white'},{...params,body:'van',fuel:'petrol',drive:'fwd'}]){
  const evaluated=await Promise.all(rows.map(async row=>({id:'ajes-stats-'+row.ID,...await evaluateAjesCensusGroup(groupsFor([row])[0],
   {params:selection,snapshot,observedAt,rate,identity:row.ID})})));
  const admitted=evaluated.filter(row=>row.admitted),reference=await realListMembership(rows,selection,snapshot);
  assert.deepEqual(admitted.map(row=>row.id),reference.map(row=>row.id));
  assert.equal(admitted.filter(row=>row.known).length,reference.filter(row=>!japanUnknownPower(row)).length);
 }
 const reference=await realListMembership(rows,params,snapshot),ids=reference.map(row=>row.id);
 for(const id of ['manual-in','owner','known-local','unknown-list','fraction'])assert.ok(ids.includes('ajes-stats-'+id),id);
 for(const id of ['manual-out','hidden','bus','gross','wrong-body'])assert.ok(!ids.includes('ajes-stats-'+id),id);
});

test('positive counts refuse both single-page and multiple-page census before reading any groups',async()=>{
 for(const length of [1,73,1003]){
  const rows=Array.from({length},(_,i)=>({...base,ID:'row-'+i,GRADE:'G'+i,PW:i%2?'230':'150'}));
  const source=fixture(rows);
  await assert.rejects(source.count(),/census_source_snapshot_unavailable/);
  assert.equal(source.queries.length,0);
 }
});

test('positive production refusal precedes schema, pricing and correction callbacks',async()=>{
 for(const selection of [params,{...params,budgetTo:'2000000'}]){
  const source=fixture([{...base,ID:'positive'}],selection);
  const calls={read:0,rate:0,context:0,run:0,price:0,pricingContext:0};
  await assert.rejects(readAjesCensusCount({...source.options,fields:[],
   read:async()=>{calls.read++;throw Error('source read forbidden');},rate:async()=>{calls.rate++;return rate(1);},
   assertCurrent:async()=>{calls.context++;},pricing:{digest:'fixture',correctionIds:['ajes-stats-positive'],
    run:async work=>{calls.run++;return work();},price:async rows=>{calls.price++;return rows;},assertCurrent:async()=>{calls.pricingContext++;}},
  }),/census_source_snapshot_unavailable/);
  assert.deepEqual(calls,{read:0,rate:0,context:0,run:0,price:0,pricingContext:0});
 }
});

test('pure representatives reject noncanonical identities and incomplete schema evidence stays unavailable',async()=>{
 const source=fixture([{...base,ID:'bad id'},{...base,ID:'&#65;'}]);
 await assert.rejects(offlineWeightedAdmission(source.groups),/identity_unproven/);
 assert.throws(()=>ajesCensusFields(['ID',...AJES_CENSUS_FIELDS.filter(field=>field!=='BODY_TYPE')]),/schema_unavailable/);
 assert.deepEqual(ajesCensusFields(['ID',...AJES_CENSUS_FIELDS]),AJES_CENSUS_FIELDS);
 const missing=fixture([{...base,ID:'valid'}]);
 await assert.rejects(readAjesCensusCount({...missing.options,fields:AJES_CENSUS_FIELDS.filter(field=>field!=='BODY_TYPE')}),/census_source_snapshot_unavailable/);
 assert.equal(missing.queries.length,0);
});

test('fresh authoritative zero proves zero without metadata traversal; malformed or stale COUNT cannot',async()=>{
 const source=fixture([]),result=await readAjesCensusCount({...source.options,fields:[],sourceCount:{total:0,observedAt}});
 assert.equal(result.total,0);assert.equal(result.countProof.pages,0);assert.equal(source.queries.length,0);
 assert.equal(result.observedAt,observedAt);assert.equal(result.countProof.sourceObservedAt,observedAt);assert.equal(result.countProof.sourceCompletedAt,new Date(now).toISOString());
 assert.equal(result.countProof.predicateVersion,AJES_CENSUS_PREDICATE_VERSION);assert.notEqual(AJES_CENSUS_PREDICATE_VERSION,'japan-admitted-census-v1');
 assert.equal(result.countProof.requestedQueryHash,ajesRequestedCountQueryHash(params));
 const sourceSql=ajesQuery({...source.options.query,aggregate:'count'}).sql;
 assert.doesNotMatch(sourceSql,/distinct|binary/i);
 assert.equal(result.countProof.sourceQueryHash,createHash('sha256').update(sourceSql).digest('hex'));
 for(const key of ['sourceTotal','sourceDistinctTotal','groupedTotal','groupCount','baseAdmittedTotal','correctionCount','correctionDelta','admittedTotal','knownTotal','unknownTotal'] as const)
  assert.equal(result.countProof[key],0,key);
 for(const count of [{total:NaN,observedAt},{total:-1,observedAt},{total:0.5,observedAt},{total:0,observedAt,stale:true},
  {total:0,observedAt,partial:true},{total:0,observedAt,upperBound:true},{total:0,observedAt:'invalid'},
  {total:0,observedAt:new Date(now+1).toISOString()},{total:0,observedAt:new Date(now-30*60_000).toISOString()}])
  await assert.rejects(readAjesCensusCount({...source.options,sourceCount:{...count,distinctTotal:0}}),/source_count_unavailable/);
 assert.equal(source.queries.length,0);
});

test('real source predicates can count zero before admitted editorial or factory values match the requested filter',async()=>{
 const ordinary={...base,ID:'counterexample',MARKA_NAME:'AUDI',MODEL_NAME:'A4',AUCTION_TYPE:2,GRADE:'1.5 AT'};
 const cases=[
  {name:'color',row:ordinary,selection:{color:'red'},specifications:{color:'red'},field:'color',expected:'red'},
  {name:'drive',row:ordinary,selection:{drive:'awd'},specifications:{drive:'awd'},field:'drive',expected:'awd'},
  {name:'pickup',row:ordinary,selection:{body:'pickup'},specifications:{bodyType:'pickup'},field:'bodyType',expected:'pickup'},
  {name:'fuel',row:{...ordinary,MARKA_NAME:'VOLKSWAGEN',MODEL_NAME:'PASSAT',KUZOV:'3CDFH',ENG_V:1968,TIME:''},selection:{fuel:'diesel'},field:'fuel',expected:'diesel'},
  // Transmission and engine currently lack final-value postchecks. Their UI
  // criteria cannot claim completeness while the displayed value can change.
  {name:'transmission',row:{...ordinary,KPP:'MT'},selection:{transmission:'automatic'},specifications:{transmission:'automatic'},field:'transmission',expected:'automatic'},
  {name:'engine',row:{...ordinary,ENG_V:0},selection:{engineFrom:'1400',engineTo:'1600'},field:'engineCc',expected:1490},
 ];
 for(const entry of cases){
  const snapshot=emptySnapshot(),selection={market:'japan',make:entry.row.MARKA_NAME,model:entry.row.MODEL_NAME,...entry.selection};
  if(entry.specifications)snapshot.editorial.entries={'ajes-stats-counterexample':{id:'ajes-stats-counterexample',sourceOfferId:'counterexample',sourceId:'ajes_japan_feed',market:'japan',status:'visible',specifications:entry.specifications}};
  if(entry.name==='engine'){
   const models={[modelKey('AUDI','A4')]:compileModelFacts({id:'A4',make:'AUDI',model:'A4',revision:'fixture',variants:[
    {id:'a4-v1',year:2023,trim:'1.5 AT',status:'observed',markets:['europe'],fuel:'petrol',engineCc:1490,drive:'fwd',transmission:'automatic',bodyType:'sedan'},
   ]} as any)};
   snapshot.calculationIndex={version:1,digest:checksum(models),createdAt:observedAt,manifestDigest:'a'.repeat(64),models};
  }
  const query=ajesCatalogQuery(selection),sql=ajesQuery({...query,aggregate:'count'}).sql;
  const script="import json,sqlite3,sys,re\nx=json.load(sys.stdin);db=sqlite3.connect(':memory:');db.create_function('regexp',2,lambda p,v:0 if v is None else bool(re.search(p,str(v),re.I)));db.execute('create table stats ('+','.join(k+' '+('integer' if isinstance(v,(int,float)) else 'text') for k,v in x['row'].items())+')');db.execute('insert into stats values ('+','.join('?' for _ in x['row'])+')',list(x['row'].values()));print(db.execute(x['sql']).fetchone()[0])";
  const executed=spawnSync('python3',['-c',script],{input:JSON.stringify({sql,row:entry.row}),encoding:'utf8'});
  assert.equal(executed.status,0,executed.stderr);assert.equal(Number(executed.stdout),0,entry.name);
  const admitted=await realListMembership([entry.row],selection,snapshot);
  assert.equal(admitted.length,1,entry.name);assert.equal(admitted[0][entry.field],entry.expected,entry.name);
  const source=fixture([],selection,snapshot);
  await assert.rejects(readAjesCensusCount({...source.options,query,sourceCount:{total:0,observedAt}}),/census_source_scope_unproven/,entry.name);
  assert.equal(source.queries.length,0);
 }
});

test('plain, make/model, power-only and post-only budget selections retain a proven ordinary zero',async()=>{
 for(const extra of [{},{make:'AUDI',model:'A4'},{powerTo:'160'},{budgetTo:'2000000'},{body:'sedan'},{hasPrice:'yes'}]){
  const selection={market:'japan',...extra},source=fixture([],selection);
  const result=await readAjesCensusCount({...source.options,query:ajesCatalogQuery(selection),sourceCount:{total:0,observedAt}});
  assert.equal(result.total,0);assert.equal(result.countProof.sourceTotal,0);assert.equal(result.countProof.sourceDistinctTotal,0);assert.equal(source.queries.length,0);
 }
});

test('verified zero still rejects a changed local context or expiry while it is checked',async()=>{
 const source=fixture([]);
 await assert.rejects(readAjesCensusCount({...source.options,assertCurrent:async()=>{throw Error('local context changed');}}),/local context changed/);
 let clock=now;
 await assert.rejects(readAjesCensusCount({...source.options,now:()=>clock,assertCurrent:async()=>{clock+=30*60_000;}}),/census_expired/);
 assert.equal(source.queries.length,0);
});

test('duplicate raw identities within or across technical groups cannot become an exact vehicle total',async()=>{
 for(const patch of [{},{PW:''},{GRADE:'OTHER'}]){
  const source=fixture([{...base,ID:'duplicate'},{...base,...patch,ID:'duplicate'}]);
  await assert.rejects(source.count(),/identity_uniqueness_unproven/);assert.equal(source.queries.length,0);
 }
 const sql=ajesQuery({aggregate:'count',countIdentity:true}).sql;assert.match(sql,/count\(distinct binary id\)/);
});

test('SQL census is a fixed counter projection, source-filter bound and never a caller-selected row mirror',()=>{
 const query=ajesQuery({aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS],make:'AUDI',model:'A4',yearFrom:2015,engineTo:2000});
 assert.match(query.sql,/count\(\*\) as census_count/);assert.match(query.sql,/group by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15 order by 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15/);assert.match(query.sql,/marka_name='AUDI'/);
 assert.doesNotMatch(query.sql,/select \*|images|auction_date,|lot,/i);assert.match(query.sql,/sum\(case when id regexp/);
 assert.throws(()=>ajesQuery({aggregate:'census',censusFields:['ID'] as any}),AjesInputError);
 assert.throws(()=>ajesQuery({aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS],correctionId:"x' or1"}),AjesInputError);
});

test('actual client decodes a controlled aggregate response and rejects malformed numeric/omitted dimensions',async()=>{
 const groups=groupsFor([{...base,ID:'one'},{...base,ID:'two'}]),wire=groups.map(g=>({...g.values,census_count:g.total,census_valid_ids:g.validIds,census_valid_finishes:g.validFinishes}));
 assert.deepEqual(parseAjesCensusGroups(wire,AJES_CENSUS_FIELDS),groups);
 let attempts=0;const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{
  attempts++;return new Response(JSON.stringify(wire),{headers:{'content-type':'application/json'}});
 }});
 const result=await client.read({aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]},'127.0.0.1');assert.equal(result.groups[0].total,2);assert.equal(attempts,1);
 for(const patch of [{census_count:'2junk'},{census_valid_ids:3},{PW:undefined}])assert.throws(()=>parseAjesCensusGroups([{...wire[0],...patch}],AJES_CENSUS_FIELDS));
});

test('offline non-price grouping omits source prices and the evaluator refuses price-based membership',async()=>{
 const rows=Array.from({length:1000},(_,i)=>({...base,ID:'price-'+i,FINISH:10000+i*7919}));
 const source=fixture(rows),result=await offlineWeightedAdmission(source.groups);assert.equal(result.total,1000);assert.equal(result.groupCount,1);
 assert.equal(result.total,(await realListMembership(rows,params)).length);
 const sql=ajesQuery({aggregate:'census',censusFields:[...AJES_CENSUS_FIELDS]}).sql;
 assert.doesNotMatch(sql.split(' group by ')[1],/finish/i);assert.match(sql,/as census_valid_finishes/);
 await assert.rejects(offlineWeightedAdmission(source.groups,{...params,budgetTo:'2000000'}),/price_count_unavailable/);
 const unproved=fixture([{...base,ID:'unsafe',FINISH:'1e6'}]);await assert.rejects(offlineWeightedAdmission(unproved.groups),/finish_unproven/);
 assert.equal(source.queries.length,0);assert.equal(unproved.queries.length,0);
});
