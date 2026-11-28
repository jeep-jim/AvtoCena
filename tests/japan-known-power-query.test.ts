import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ajesCatalogQuery,ajesLot,ajesQuery,ajesSourceCacheSql,AjesInputError,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';
import {japanKnownPowerPredicate,japanKnownPowerSelection} from '../apps/web/lib/catalog/japan-known-power-query';
import {compileModelFacts,checksum,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {applyAjesLotAdmission,type AjesAdmissionSnapshot} from '../apps/web/lib/catalog/ajes-admission';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {japanUnknownPower} from '../apps/web/lib/catalog/japan-source-power';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesMysqlOracleSql} from './helpers/ajes-mysql-oracle';

type Row=Record<string,any>;
const observedAt=new Date().toISOString();
const editorial={revision:'known-power-test',entries:{}};
const knownPower={editorialIds:[] as string[]};
const selection:AjesQuery={table:'stats',powerTo:160,sort:'totalRubDesc',knownPower};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const stableHash=(sql:string)=>hash(sql.replace(/year<=\d{4}/,'year<=2027'));
const where=(sql:string)=>sql.slice(sql.indexOf(' where ')+7).replace(/ order by .*$/,'');
const encodedLength=(sql:string)=>new URLSearchParams({sql}).toString().length-4;
function raw(id:string,pw:unknown,patch:Row={}):Row {
 return {ID:id,MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',YEAR:2023,GRADE:'1.5 T',AUCTION_TYPE:2,
  STATUS:'Sold',FINISH:100000,TIME:'P',PW:pw,ENG_V:1490,AUCTION_DATE:'2026-11-28',IMAGES:'',...patch};
}
function indexFor(definitions:Array<{make:string;model:string;hp:number}>):CalculationIndex {
 const models:CalculationIndex['models']={};
 for(const [number,{make,model,hp}] of definitions.entries()){
  const record={id:'model-'+number,make,model,revision:'revision-'+number,variants:[{
   id:'variant-'+number,year:2023,trim:'1.5 T',status:'verified',sourceUrl:'https://example.test/factory-spec',engineCc:1490,powerHp:hp,
  }]};
  const facts=compileModelFacts(record);
  assert.equal(facts.length,1);
  models[make.toLowerCase()+':'+model.toLowerCase()]=facts;
 }
 return {version:1,digest:checksum(models),manifestDigest:'a'.repeat(64),createdAt:observedAt,models};
}
function admitted(row:Row,snapshot:AjesAdmissionSnapshot={editorial,calculationIndex:null}) {
 const lot=ajesLot(row,'stats',false);assert(lot);
 const rate={currency:'JPY',sourcePrice:lot.finalPriceJpy,effectiveRate:.6,cbrRate:60,nominal:100,
  rateDate:observedAt.slice(0,10),rateSource:'cbr'} as any;
 const offer=applyAjesLotAdmission(lot,rate,observedAt,snapshot);
 assert(offer);
 return safePublicPricing(offer);
}
function isKnownMatch(row:Row,query:AjesQuery,snapshot:AjesAdmissionSnapshot={editorial,calculationIndex:null}):boolean {
 const offer=admitted(row,snapshot);
 return ajesResultFilter({market:'japan',...query}).matches(offer)&&!japanUnknownPower(offer);
}
/** Execute the real generated WHERE/ORDER/LIMIT. Only the numeric PW operand
 * is adapted for SQLite's differing TEXT affinity; expected membership below
 * comes from the actual admission, safety and local-filter pipeline. */
function selected(rows:Row[],query:AjesQuery,index:CalculationIndex|null=null):Set<string> {
 const db=new DatabaseSync(':memory:');
 try{
  db.function('regexp',(pattern:any,value:any)=>value==null?0:Number(new RegExp(String(pattern),'i').test(String(value))));
  db.exec('create table stats(id text,year integer,auction_type integer,status text,finish real,marka_name text,model_name text,auction_date text,pw text)');
  const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?)');
  for(const row of rows)insert.run(row.ID,row.YEAR,row.AUCTION_TYPE,row.STATUS,row.FINISH,row.MARKA_NAME,row.MODEL_NAME,row.AUCTION_DATE,row.PW==null?null:String(row.PW));
  return new Set(db.prepare(ajesMysqlOracleSql(ajesQuery({...query,pageSize:48},index).sql)).all().map(row=>String(row.id)));
 }finally{db.close();}
}

test('ordinary, unknown-phase and overall-count wire/cache identities remain unchanged',()=>{
 for(const query of [{},{powerTo:160}]){
  const sql=ajesQuery(query).sql;
  assert.equal(stableHash(sql),'7f7b34136741cb10d915f31a7c897911d2cc043923aa38faa40a2af6c8bf7398');
  assert.equal(stableHash(ajesSourceCacheSql(sql)),'5bfd43524f9b1eb82c7537f4d56c4ee0820122836cae0f738ef01a55a6da5b43');
 }
 for(const query of [{sort:'totalRubDesc'},{sort:'totalRubDesc',powerTo:160}])
  assert.equal(stableHash(ajesQuery(query).sql),'ba097561bf0658bcc4dba76838f5643888f272f392c1d5add3fcb843bd01e034');
 for(const query of [{},{powerTo:160},{powerTo:160,sort:'totalRubDesc'},{powerFrom:100}])
  assert.equal(stableHash(ajesQuery({...query,aggregate:'count'}).sql),'c67f816e676d6615764642df8051e222d615555cc8524f2322d7025a11fd88e0');
 const sql=ajesQuery(selection).sql;
 assert.notEqual(stableHash(sql),'ba097561bf0658bcc4dba76838f5643888f272f392c1d5add3fcb843bd01e034');
 assert.match(sql,/pw>0 and pw<=160/);
 assert.doesNotMatch(sql,/\bpw\s*(?:\+|\*|between)|\bcast\s*\(/i);
});

test('K candidates retain actual known normalization cases while ordinary ASCII unknowns stay in U',()=>{
 const powers=['1','150','160','00150',' 150 ','\t150\r\n','１５０','&#49;50','&nbsp;150','\u00a0150\u00a0',
  '',null,'0','000','N/A','160.0','150,300','400','9007199254740992'];
 const rows=powers.map((pw,i)=>raw('pw-'+i,pw));
 const candidates=selected(rows,selection),broad=selected(rows,{table:'stats',powerTo:160,sort:'totalRubDesc'});
 const expected=rows.filter(row=>isKnownMatch(row,selection));
 assert.equal(expected.length,10);
 for(const row of expected)assert(candidates.has(row.ID),'known normalized PW must remain a candidate: '+JSON.stringify(row.PW));
 for(const value of ['',null,'0','000','N/A','400']){
  const row=rows.find(row=>row.PW===value)!;
  assert(!candidates.has(row.ID),'ordinary unmatched PW consumes no K slot');
  assert(broad.has(row.ID),'the unchanged U source query retains the row');
 }
 for(const value of ['160.0','150,300']){
  const row=rows.find(row=>row.PW===value)!;
  assert(candidates.has(row.ID),'numeric-prefix overinclusion is allowed');
  assert.equal(isKnownMatch(row,selection),false,'local strict power parsing still decides K membership');
 }
});

test('eligible local donor cohorts preserve actual overrides and normalized model identities',()=>{
 const index=indexFor([{make:'Audi',model:'A4',hp:150},{make:'Audi',model:'A6',hp:200}]);
 const names=['A4','A 4','A.4','A_4','A/4','A-4','Ａ４','A&#52;','A⁴','A\u00ad4'];
 const rows=names.map((model,i)=>raw('donor-'+i,'400',{MARKA_NAME:'AUDI',MODEL_NAME:model}));
 rows.push(raw('out-of-range-donor','400',{MARKA_NAME:'AUDI',MODEL_NAME:'A6'}));
 rows.push(raw('supplier-matches-local-does-not','150',{MARKA_NAME:'AUDI',MODEL_NAME:'A6'}));
 const snapshot={editorial,calculationIndex:index},candidates=selected(rows,selection,index);
 for(const row of rows.slice(0,names.length)){
  assert.equal(admitted(row,snapshot).powerHp,150);
  assert.equal(isKnownMatch(row,selection,snapshot),true);
  assert(candidates.has(row.ID),'the model cohort must preserve '+row.MODEL_NAME);
 }
 assert(!candidates.has('out-of-range-donor'),'a cohort with only out-of-range hp contributes no exception');
 assert(candidates.has('supplier-matches-local-does-not'));
 assert.equal(isKnownMatch(rows.at(-1)!,selection,snapshot),false,'an out-of-range local override still defeats supplier PW');
});

test('manual IDs use actual editorial lookup identity and preserve legacy power and owner identity changes',()=>{
 const direct=raw('manual-direct','400',{MARKA_NAME:'HONDA',MODEL_NAME:'FIT'});
 const identity=raw('manual-identity','400');
 const entry=(id:string,specifications:Row)=>({id:'ignored-value-id',market:'japan',sourceId:'ajes_japan_feed',
  sourceOfferId:id,status:'visible',specifications});
 const snapshot={editorial:{revision:'legacy-editorial',entries:{
  ['ajes-stats-'+direct.ID]:entry(direct.ID,{powerHp:150,powerDataConfidence:'verified'}),
  ['ajes-stats-'+identity.ID]:entry(identity.ID,{make:'HONDA',model:'STEPWGN'}),
  'ajes-stats-hidden':{...entry('hidden',{}),status:'hidden'},
  'ajes-stats-wrong-source':{...entry('wrong-source',{}),sourceId:'other'},
  'ajes-stats-mismatch':entry('different-id',{}),
  'bad-lookup-key':entry('bad-lookup-key',{}),
 }} as any,calculationIndex:null};
 const manual=japanKnownPowerSelection(snapshot.editorial);
 assert.deepEqual(manual,{editorialIds:['manual-direct','manual-identity']});
 const query={...selection,knownPower:manual!},candidates=selected([direct,identity],query);
 for(const row of [direct,identity]){
  assert.equal(admitted(row,snapshot).powerHp,150);
  assert.equal(isKnownMatch(row,query,snapshot),true);
  assert(candidates.has(row.ID));
 }
 for(const invalid of [null,[],{entries:[]},{entries:{bad:null}}])assert.equal(japanKnownPowerSelection(invalid as any),null);
});

test('owner aliases are retained only when their actual 150 hp can match',()=>{
 const names=['STEPWGN','STEPWAGON','STEP WAGON','STEP\u00a0WGN','ＳＴＥＰＷＧＮ','STEP&#87;GN','степ вагон','ステップワゴン'];
 const rows=names.map((model,i)=>raw('owner-'+i,'400',{MARKA_NAME:'HONDA',MODEL_NAME:model}));
 const candidates=selected(rows,selection);
 for(const row of rows){assert.equal(admitted(row).powerHp,150);assert.equal(isKnownMatch(row,selection),true);assert(candidates.has(row.ID));}
 const impossible={...selection,powerFrom:151,powerTo:160};
 assert(!selected([rows[0]],impossible).has(rows[0].ID));
 assert.equal(isKnownMatch(rows[0],impossible),false);
});

test('raw supplier ID normalization cannot remove a matching manual power override',()=>{
 const normalized='manual-direct';
 const snapshot={editorial:{revision:'normalized-editorial-id',entries:{
  ['ajes-stats-'+normalized]:{id:'irrelevant-entry-id',market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:normalized,status:'visible',
   specifications:{powerHp:150,powerDataConfidence:'verified'}},
 }} as any,calculationIndex:null};
 const descriptor=japanKnownPowerSelection(snapshot.editorial)!;
 assert.deepEqual(descriptor,{editorialIds:[normalized]});
 const query={...selection,knownPower:descriptor};
 const rows=['manual-direct','manual&#45;direct',' manual-direct ','ｍａｎｕａｌ-direct'].map(id=>raw(id,'400'));
 const unrelated=raw('unrelated-canonical','400');
 const candidates=selected([...rows,unrelated],query);
 for(const row of rows){
  assert.equal(admitted(row,snapshot).id,'ajes-stats-'+normalized);
  assert.equal(admitted(row,snapshot).powerHp,150);
  assert.equal(isKnownMatch(row,query,snapshot),true);
  assert(candidates.has(row.ID),'raw spelling must retain the normalized editorial identity: '+row.ID);
 }
 assert.equal(isKnownMatch(unrelated,query,snapshot),false);
 assert(!candidates.has(unrelated.ID),'an unrelated canonical ID with excessive PW stays outside K candidates');
 assert.match(ajesQuery(query).sql,/id regexp '\[\^A-Za-z0-9_-\]'/);
 assert.doesNotMatch(ajesQuery(selection).sql,/id regexp/,'without editorial entries no ID exception is needed');
});

test('optional bounds retain supplier hp above 2500 and positive fractional local hp',()=>{
 const fromOnly:AjesQuery={table:'stats',powerFrom:100,sort:'totalRubDesc',knownPower};
 const high=raw('supplier-5000','5000');
 assert.equal(isKnownMatch(high,fromOnly),true);
 assert(selected([high],fromOnly).has(high.ID));
 assert.doesNotMatch(ajesQuery(fromOnly).sql,/pw<=2500/);
 const index=indexFor([{make:'Audi',model:'A4',hp:.5}]);
 const tiny=raw('fractional-local','400',{MARKA_NAME:'AUDI',MODEL_NAME:'A4'}),snapshot={editorial,calculationIndex:index};
 assert.equal(admitted(tiny,snapshot).powerHp,.5);
 assert.equal(isKnownMatch(tiny,selection,snapshot),true);
 assert(selected([tiny],selection,index).has(tiny.ID));
 const lower={...selection,powerFrom:1};
 assert.equal(isKnownMatch(tiny,lower,snapshot),false);
 assert(!selected([tiny],lower,index).has(tiny.ID));
});

test('malformed donor data and insufficient URI budget fail open without truncating exceptions',()=>{
 const plain={...selection};delete plain.knownPower;
 const badIndexes=[{models:[]},{models:{'audi:a4':null}},{models:{'audi:a4':[null]}},
  {models:{'audi:a4':[{values:null}]}},{models:{'bad:extra:key':[{values:{powerHp:150}}]}}];
 for(const index of badIndexes){
  assert.equal(japanKnownPowerPredicate(selection,index as any,knownPower,10000),null);
  assert.equal(ajesQuery(selection,index as any).sql,ajesQuery(plain).sql);
 }
 assert.equal(japanKnownPowerPredicate(selection,null,knownPower,1),null);
 const large={editorialIds:Array.from({length:100},(_,i)=>'editorial-'+String(i).padStart(3,'0')+'x'.repeat(48))};
 for(const page of [1,2,1_000_000])for(const aggregate of [undefined,'count'] as const){
  const query={...selection,knownPower:large,page,aggregate};
  assert.equal(ajesQuery(query).sql,ajesQuery({...plain,page,aggregate}).sql,'every page and its COUNT must make the same fail-open decision');
 }
});

test('known LIST and its COUNT share one WHERE and a bounded URI at every permitted source offset',()=>{
 const index=indexFor([{make:'Audi',model:'A4',hp:150}]);
 let predicate:string|undefined;
 for(const page of [1,2,1_000_000])for(const pageSize of [24,48]){
  const query={...selection,page,pageSize};
  const list=ajesQuery(query,index).sql,count=ajesQuery({...query,aggregate:'count'},index).sql;
  assert.equal(where(list),where(count));
  predicate??=where(list);assert.equal(where(list),predicate);
  assert(encodedLength(list)<=5600);
  const url=new URL('http://127.0.0.1/api/');
  url.search=new URLSearchParams({ip:'2001:db8:1234:5678:1234:5678:1234:5678',json:'',code:'x'.repeat(128),sql:list}).toString();
  assert(url.toString().length<6000);
  assert.notEqual(ajesSourceCacheSql(count),ajesSourceCacheSql(ajesQuery({...query,knownPower:undefined,aggregate:'count'}).sql));
 }
});

test('URL parsing cannot set known-power selection and the internal descriptor rejects misuse',()=>{
 for(const supplied of [{editorialIds:['override']},'override',true]){
  const parsed=ajesCatalogQuery({market:'japan',powerTo:'160',sort:'totalRubDesc',knownPower:supplied});
  assert.equal(Object.hasOwn(parsed,'knownPower'),false);
  assert.equal(stableHash(ajesQuery(parsed).sql),'ba097561bf0658bcc4dba76838f5643888f272f392c1d5add3fcb843bd01e034');
 }
 for(const descriptor of [null,true,[],{}, {editorialIds:'bad'},{editorialIds:[1]},
  {editorialIds:["x' or 1=1"]},{editorialIds:['x'],extra:true}])
  assert.throws(()=>ajesQuery({...selection,knownPower:descriptor} as any),AjesInputError);
 for(const patch of [{table:'main'},{powerTo:undefined},{sort:undefined},{sort:'updatedAt'},
  {aggregate:'makes'},{aggregate:'models'},{aggregate:'colors'},{aggregate:'census'},{id:'detail'}])
  assert.throws(()=>ajesQuery({...selection,...patch} as any),AjesInputError);
});

test('empty K LIST confirms against its captured K COUNT even if the local index reader changes',async()=>{
 const index=indexFor([{make:'Audi',model:'A4',hp:150}]);
 for(const page of [1,2,1_000_000]){
  let current:CalculationIndex|null=index,indexReads=0;
  const requests:string[]=[];
  const client=createAjesClient({password:()=> 'offline-fixture',assertEnabled:async()=>{},reserve:async()=>{},
   calculationIndex:()=>{indexReads++;return current;},fetcher:async input=>{
    const sql=new URL(String(input)).searchParams.get('sql')!;requests.push(sql);
    if(sql.startsWith('select count(*)'))return new Response(JSON.stringify([{total:'0'}]));
    current=null;return new Response('[]');
   }});
  const result=await client.read({...selection,page},'127.0.0.1');
  assert.equal(requests.length,2);assert.equal(indexReads,1);
  assert.equal(where(requests[0]),where(requests[1]));
  assert.equal(requests[1],ajesQuery({...selection,page,aggregate:'count'},index).sql);
  assert.deepEqual(result.items,[]);assert.equal(result.received,0);assert.equal(result.stale,false);
  assert.equal(result.emptyPageEvidence.countQueryHash,hash(ajesSourceCacheSql(requests[1])));
 }
});

test('an unavailable K confirmation never becomes a zero or exhausted source page',async()=>{
 const requests:string[]=[];
 const client=createAjesClient({password:()=> 'offline-fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async input=>{
  requests.push(new URL(String(input)).searchParams.get('sql')!);return new Response('[]');
 }});
 await assert.rejects(client.read(selection,'127.0.0.1'),error=>error instanceof AjesUnavailable&&error.reason==='invalid_response');
 assert.equal(requests.length,2);assert.equal(where(requests[0]),where(requests[1]));
});
