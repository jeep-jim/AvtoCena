import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ajesCountText,exactAjesCount,ajesVisibleCount,latestAjesCountSummary} from '../apps/web/lib/catalog/ajes-count-display';
import {ajesCatalogQuery,ajesQuery,type AjesQuery} from '../apps/web/lib/catalog/ajes-query';

function assertModelSqlRows(make:string,selection:Pick<AjesQuery,'model'|'modelFamilies'|'resolvedModels'>,models:readonly string[],expected:readonly string[]){
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,auction_date text)');
  const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?)');
  for(const [index,model] of models.entries()){
   insert.run('selected-'+index,2021,2,'Sold',100000,make,model,'2026-11-28');
   insert.run('foreign-'+index,2021,2,'Sold',100000,make==='TOYOTA'?'HONDA':'TOYOTA',model,'2026-11-28');
  }
  const query={table:'stats' as const,make,...selection,pageSize:48};
  const rows=db.prepare(ajesQuery(query).sql).all();
  assert.deepEqual(rows.map(row=>row.model_name).sort(),[...expected].sort(),'actual LIST SQL preserves selected source models and excludes sibling/prefix matches');
  assert.ok(rows.every(row=>row.marka_name===make),'matching model names from another make stay excluded');
  assert.equal(db.prepare(ajesQuery({...query,aggregate:'count'}).sql).get()!['count(*)'],expected.length,'COUNT uses the same complete candidate predicate as LIST');
 }finally{db.close();}
}

test('independent counts retain zero, unavailable and stale semantics',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-18T11:15:00Z'));
 const fresh={total:147867,stale:false,observedAt:'2026-10-18T11:00:00Z',upperBound:false};
 assert.equal(ajesCountText(fresh),'147\u00a0867');assert.equal(exactAjesCount(fresh),147867);
 assert.equal(ajesCountText({...fresh,total:0}),'0');
 assert.equal(ajesCountText(null),'Количество уточняется');
 assert.equal(ajesCountText({...fresh,stale:true}),'147\u00a0867 · данные на 18 октября 2026 г.');
 assert.equal(ajesCountText({...fresh,stale:true,observedAt:'2026-10-17T18:00:00Z'}),'147\u00a0867 · данные на 18 октября 2026 г.');
 assert.equal(ajesCountText({...fresh,stale:true,observedAt:''}),'Количество уточняется');
 assert.equal(exactAjesCount({...fresh,stale:true}),undefined);
 assert.equal(ajesCountText({...fresh,upperBound:true}),'Количество уточняется');
 assert.equal(exactAjesCount({...fresh,upperBound:true}),undefined);
});
test('visible Japan count never substitutes loaded cards for the whole matching inventory',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T00:15:00Z'));
 const observedAt='2026-11-28T00:00:00Z';
 const source={total:147867,stale:false,observedAt,upperBound:true};
 const partial=ajesVisibleCount(source,24);
 assert.deepEqual(partial,{text:'Количество уточняется',total:undefined,loadedCount:24,status:'partial'});
 assert.equal(ajesVisibleCount(source,48).text,'Количество уточняется');
 assert.equal(ajesVisibleCount({...source,total:0},24).text,partial.text,'the power-count sentinel is not zero inventory');
 assert.equal(ajesVisibleCount(null,24).text,partial.text,'ready cards are not a whole-query count before the aggregate resolves');
 for(const loaded of [undefined,0,-1,NaN,Infinity,2.5]){
  const count=ajesVisibleCount(null,loaded);
  assert.equal(count.text,'Количество уточняется');assert.equal(count.total,undefined);
 }
 const exact={...source,upperBound:false,total:24};
 assert.deepEqual(ajesVisibleCount(exact,24),{text:'24',total:24,loadedCount:24,status:'exact'});
 assert.equal(ajesVisibleCount({...exact,total:0},0).text,'0','only fresh proven exhaustion may display zero');
 assert.equal(ajesVisibleCount({...exact,total:0},24).total,undefined,'a late contradictory aggregate cannot erase visible cars');
 assert.equal(ajesVisibleCount({...exact,stale:true},24).total,undefined);
 assert.equal(ajesVisibleCount({...exact,stale:true},24).status,'stale');
 assert.equal(ajesVisibleCount({...exact,stale:true},48).text,'24 · данные на 28 ноября 2026 г.','old exact counts stay visibly historical even when the current loaded membership has changed');
 for(const loaded of [24,48,72,73])assert.deepEqual(ajesVisibleCount({...exact,total:73},loaded),{text:'73',total:73,loadedCount:loaded,status:'exact'});
});

test('census count proof must agree with the admitted total and cover the same source rows',t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-28T00:15:00Z'));
 const summary={total:73,stale:false,upperBound:false,observedAt:'2026-11-28T00:00:00Z',countProof:{version:1,kind:'japan-admitted-census',complete:true,admittedTotal:73,sourceTotal:100,sourceDistinctTotal:100,groupedTotal:100,knownTotal:51,unknownTotal:22}} as any;
 assert.equal(exactAjesCount(summary),73);
 for(const patch of [{complete:false},{admittedTotal:24},{groupedTotal:99},{sourceDistinctTotal:99},{sourceDistinctTotal:undefined},{knownTotal:72},{unknownTotal:-1},{version:2},{kind:'source-count'}]){
  const invalid={...summary,countProof:{...summary.countProof,...patch}};
  assert.equal(exactAjesCount(invalid),undefined);assert.equal(ajesVisibleCount(invalid,24).text,'Количество уточняется');
 }
 assert.equal(latestAjesCountSummary(summary,null),summary);
 assert.equal(latestAjesCountSummary(summary,{...summary,total:0,upperBound:true}),summary);
 assert.equal(latestAjesCountSummary(summary,{...summary,observedAt:'2026-11-27T00:00:00Z'}),summary);
 const newer={...summary,observedAt:'2026-11-28T00:10:00Z'};
 assert.equal(latestAjesCountSummary(summary,newer),newer);
});

test('real Japan count badge renders exact and partial values without false inventory metadata',async t=>{
 let now=Date.parse('2026-11-28T00:15:00Z');t.mock.method(Date,'now',()=>now);
 const {build}=await import('esbuild');
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const built=await build({entryPoints:['apps/web/components/catalog/JapanCatalogCount.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',packages:'external',tsconfig:'apps/web/tsconfig.json'});
 const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
 const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const render=(summary:any,initialCount?:number)=>renderToStaticMarkup(createElement(mod.exports.JapanCatalogCount,{queryKey:'current-power-sort-query',summary,initialCount}));
 const upper={total:147867,stale:false,observedAt:'2026-11-28T00:00:00Z',upperBound:true};
 const partial=render(upper,24);
 assert.match(partial,/data-japan-loaded-count="24"/);assert.match(partial,/data-japan-count-status="partial"/);
 assert.match(partial,/Количество уточняется/);assert.doesNotMatch(partial,/data-catalog-market-count=|147867|Загружено/);
 assert.match(render(null,48),/Количество уточняется/);
 const unknown=render(null);
 assert.match(unknown,/Количество уточняется/);assert.doesNotMatch(unknown,/data-japan-loaded-count=|data-catalog-market-count=|Загружено 0/);
 const exact=render({...upper,total:24,upperBound:false},24);
 assert.match(exact,/data-japan-count-status="exact"/);assert.match(exact,/data-catalog-market-count="24"/);
 const stale=render({...upper,total:24,upperBound:false,stale:true},24);
 assert.match(stale,/data-japan-count-status="stale"/);assert.doesNotMatch(stale,/data-catalog-market-count=/);
 assert.match(stale,/24 · данные на 28 ноября 2026 г./);assert.match(stale,/data-japan-count-observed-at="2026-11-28T00:00:00Z"/);
 const proof={version:1,kind:'japan-admitted-census',complete:true,admittedTotal:73,sourceTotal:73,sourceDistinctTotal:73,groupedTotal:73,knownTotal:51,unknownTotal:22,requestedQueryHash:'a'.repeat(64)};
 for(const loaded of [24,48,72,73]){
  const full=render({...upper,total:73,upperBound:false,countProof:proof},loaded);
  assert.match(full,/data-catalog-market-count="73"/);assert.match(full,new RegExp(`data-japan-loaded-count="${loaded}"`));
  assert.match(full,/data-japan-count-proof="japan-admitted-census"/);assert.match(full,new RegExp(`data-japan-count-query-hash="${'a'.repeat(64)}"`));
 }
 now=Date.parse('2026-11-28T00:30:01Z');
 const agedSummary={...upper,total:73,upperBound:false,countProof:proof} as any;
 const retained=latestAjesCountSummary(agedSummary,null);
 assert.equal(retained?.stale,true,'an append/count refusal cannot extend the original observation deadline');
 assert.equal(retained?.observedAt,agedSummary.observedAt);assert.equal(retained?.total,73);
 assert.equal(exactAjesCount(retained),undefined);
 assert.deepEqual(ajesVisibleCount(retained,48),{text:'73 · данные на 28 ноября 2026 г.',total:undefined,loadedCount:48,status:'stale'});
 const expired=render(retained,48);
 assert.match(expired,/data-japan-count-status="stale"/);assert.match(expired,/73 · данные на 28 ноября 2026 г./);
 assert.doesNotMatch(expired,/data-catalog-market-count=|data-japan-count-status="exact"/);
});
test('power selection narrows the global source candidates before every aggregate and list',()=>{
 for(const market of ['japan'] as const)for(const aggregate of [undefined,'count','models'] as const){
  const q=ajesCatalogQuery({market,powerFrom:'100',powerTo:'160',pageSize:'48'});
  const sql=ajesQuery({...q,aggregate}).sql;
  assert.match(sql,/trim\(pw\) regexp '\^\[0-9\]\+\$'/i);
  assert.match(sql,/\(pw\+0\)>=100 and \(pw\+0\)<=160/i);
  assert.match(sql,/pw is null or not /i,'unknown source power stays included');
 }
 for(const p of [{powerTo:'-1'},{powerFrom:'200',powerTo:'100'},{powerTo:'Infinity'}])assert.throws(()=>ajesQuery(ajesCatalogQuery({market:'japan',...p})));
 assert.match(ajesQuery(ajesCatalogQuery({market:'japan',powerTo:'160'})).sql,/\(pw\+0\)<=160/i);
 assert.match(ajesQuery(ajesCatalogQuery({market:'japan',sort:'mileage',page:'2',pageSize:'48'})).sql,/order by mileage asc, id asc limit 48,48/);
});

test('delivered budget never accepts seller-only or missing specifications',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({budget:'2000000',bodyType:'suv'});
 const seller={market:'japan',bodyType:'suv',catalogPricingMode:'seller',totalRub:1000000};
 assert.equal(filter.matches(seller),false);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),true);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:2100000}}),false);
 assert.equal(filter.matches({...seller,bodyType:'',deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({budget:2000000,city:'Неизвестный город'}).matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({hasPrice:'no'}).matches(seller),true);
 assert.throws(()=>ajesResultFilter({budgetFrom:200,budget:100}));
 assert.throws(()=>ajesResultFilter({budget:'NaN'}));
 assert.doesNotThrow(()=>ajesCatalogQuery({market:'japan',budget:2000000,bodyType:'suv'}));
});

test('display family resolves source generation names without losing exact selections',async()=>{
 const {resolveAjesModelNames}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const models=['A5 F5','A5 B10','A50','S5 F5','A3','A3 8Y'].map(model=>({model}));
 assert.equal(resolveAjesModelNames('A5',models),'A5 F5|A5 B10');
 assert.equal(resolveAjesModelNames('A5 F5',models),'A5 F5');
 assert.equal(resolveAjesModelNames('A3',models),'A3|A3 8Y');
 assert.equal(resolveAjesModelNames('UNKNOWN',models),'UNKNOWN');
 assert.equal(resolveAjesModelNames('A5|S5 F5',models),'A5 F5|A5 B10|S5 F5');
});

test('release probe distinguishes missing visitor IP from every other failure without leaking details',async()=>{
 const {ajesErrorResponse}=await import('../apps/web/lib/catalog/ajes-error-response');
 const {AjesUnavailable}=await import('../apps/web/lib/catalog/ajes-client');
 const response=ajesErrorResponse(new AjesUnavailable('client_ip_missing'));
 assert.equal(response.status,503);assert.equal(response.body.reason,'client_ip_missing');assert.equal('total' in response.body,false);
 for(const error of [new Error('PRIVATE_TOKEN https://private.example'),new AjesUnavailable('visitor_restricted'),new AjesUnavailable('PRIVATE_TOKEN')]){
  const result=ajesErrorResponse(error);assert.notEqual(result.body.reason,'client_ip_missing');assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN'));
 }
});

test('loopback release probes never reach supplier or credentials without visitor IP',async()=>{
 const {createAjesClient}=await import('../apps/web/lib/catalog/ajes-client');
 let touched=0;const forbidden=async()=>{touched++;throw Error('unexpected dependency call');};
 const client=createAjesClient({password:forbidden,assertEnabled:forbidden,reserve:forbidden,fetcher:forbidden});
 for(const table of ['stats','main'])await assert.rejects(client.read({table},''),/client_ip_missing/);
 for(const table of ['china','korea'])await assert.rejects(client.read({table},''),/market_not_supported/);
 assert.equal(touched,0);
});


test('large families keep every source generation and never match A50 or S5',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const generations=Array.from({length:40},(_,i)=>'A5 G'+i);
 const selection=resolveAjesModelSelection('A5|S5 F5',[...generations,'S5 F5','A50'].map(model=>({model})));
 const expected=['A5',...generations,'S5 F5','S5 F5 SPORT'];
 assertModelSqlRows('AUDI',selection,[...expected,'A50','A500','A5L','OTHER A5','S5','S5 G0','S5 F50','S5 F5X','S50'],expected);
 assert.throws(()=>ajesQuery({table:'stats',modelFamilies:"A5%' OR 1=1"}));
 assertModelSqlRows('AUDI',resolveAjesModelSelection('A5',[{model:'A5'},{model:'A5 F5'}]),
  ['A5','A5 F5','A5 NEW','A50','A5L','S5','OTHER A5'],['A5','A5 F5','A5 NEW']);
});

test('power results keep the source 111 hp match and reject empty, malformed and over-limit power',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({powerTo:'160'});
 assert.equal(filter.matches({powerHp:111}),true);assert.equal(filter.matches({powerHp:160}),true);
 for(const powerHp of [undefined,null,'',0,200,'111,200','unknown'])assert.equal(filter.matches({powerHp}),false);
});
test('power filter uses only local encyclopedia horsepower, not saved calculation scenarios',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({market:'japan',powerTo:'160'});
 const offer={powerHp:150,savedCalculationPreview:{totalRub:4309204,parameters:{powerHp:186,powerKw:136.8027675}}};
 assert.equal(filter.matches(offer),true);
 assert.equal(offer.powerHp,150);
 assert.equal(filter.matches({...offer,powerHp:undefined,savedCalculationPreview:{totalRub:4309204,parameters:{powerHp:160}}}),false);
 assert.equal(filter.matches({...offer,powerHp:160,savedCalculationPreview:{totalRub:0,parameters:{powerHp:186}}}),true);
});


test('Honda selector aliases resolve to actual supplier names without changing other makes',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const names=[{model:'STEPWGN'},{model:'STEPWGN SPADA'},{model:'N-WGN'}];
 const literal=['STEP WAGON','STEP WAGON SPADA','STEP WAGON SPADA RP3','STEP WAGON SPADAX'];
 const source=[...literal,'STEPWGN','STEPWGN SPADA','N-WGN','STEP WAGONX','STEPWGNX','OTHER STEP WAGON','STEPWGN SPADA RP3'];
 assertModelSqlRows('HONDA',resolveAjesModelSelection('STEP WAGON',names,'HONDA'),source,[...literal,'STEPWGN','STEPWGN SPADA']);
 assertModelSqlRows('HONDA',resolveAjesModelSelection('STEP WAGON SPADA',names,'Honda'),source,['STEP WAGON SPADA','STEP WAGON SPADA RP3','STEPWGN SPADA']);
 assertModelSqlRows('OTHER',resolveAjesModelSelection('STEP WAGON',names,'Other'),source,literal);
});

test('exact base Corolla does not hide other Corollas in supplier search',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const names=['COROLLA','COROLLA CROSS','COROLLA FIELDER','CAMRY'].map(model=>({model}));
 const source=['COROLLA','COROLLA CROSS','COROLLA FIELDER','COROLLA SPORT','CAMRY','COROLLAX','COROLLA2','COROLLA-CROSS','OTHER COROLLA'];
 assertModelSqlRows('TOYOTA',resolveAjesModelSelection('Corolla',names),source,['COROLLA','COROLLA CROSS','COROLLA FIELDER','COROLLA SPORT']);
 assertModelSqlRows('TOYOTA',resolveAjesModelSelection('COROLLA CROSS',names),source,['COROLLA CROSS']);
});

 test('Japan power discovery accepts scalar hp and keeps malformed alternatives visibly unknown',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({market:'japan',powerTo:'160'});
 for(const sourcePower of ['79,98','160','160,200','200,150','','0,98','79,bad','150,2501']){
  const offer={id:'ajes-stats-fixture',market:'japan',sourceId:'ajes_japan_feed',operational:{raw:{sourcePower}}};
  assert.equal(filter.matches(offer),true,sourcePower);
  assert.equal('powerHp' in offer,false);
 }
 const ownerStepwgn={id:'ajes-stats-owner',market:'japan',make:'HONDA',model:'STEPWGN',fuel:'petrol',powertrainKind:'combustion',operational:{chassisCode:'RP3',raw:{sourceFuel:'P',sourcePower:''}}};
 assert.equal(filter.matches(ownerStepwgn),true);
 assert.equal(ajesResultFilter({market:'japan',powerFrom:'100',powerTo:'160'}).matches({id:'ajes-stats-fixture',market:'japan',sourceId:'ajes_japan_feed',operational:{raw:{sourcePower:'79,150'}}}),true);
});

test('Japan saved fallback returns bounded candidates; source PW cannot qualify them',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const now=Date.now(),observedAt=new Date(now-1000).toISOString();
 const snapshots=Object.fromEntries([['ok','79,98'],['limit','160'],['too','150,200'],['missing',''],['bad','150,bad']].map(([id,sourcePower])=>[id,{observedAt,items:[{id,table:'stats',make:'TOYOTA',model:'TEST',year:2023,status:'Sold',finalPriceJpy:1000000,sourcePower}]}]));
 const result=findSavedAjesSearch({table:'stats',powerTo:160},snapshots,now);
 assert.deepEqual(result?.items.map(x=>x.id),['bad','limit','missing','ok','too']);
 assert.equal(result?.partial,true);assert.equal(result?.stale,true);assert.equal('total' in result!,false);
 assert.ok(result!.items.every(item=>ajesResultFilter({market:'japan',powerTo:160}).matches(item)===false));
 assert.ok(findSavedAjesSearch({table:'stats',powerFrom:100,powerTo:159},snapshots,now));
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160,page:2},snapshots,now),null);
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160,fuel:'diesel'},snapshots,now),null);
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160},snapshots,now+8*86400000),null);
});


