import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesCountText,exactAjesCount} from '../apps/web/lib/catalog/ajes-count-display';
import {ajesCatalogQuery,ajesQuery,AjesFilterUnavailable} from '../apps/web/lib/catalog/ajes-query';

test('independent counts retain zero, unavailable and stale semantics',()=>{
 const fresh={total:147867,stale:false,observedAt:'2026-10-18T11:00:00Z',upperBound:false};
 assert.equal(ajesCountText(fresh),'147\u00a0867');assert.equal(exactAjesCount(fresh),147867);
 assert.equal(ajesCountText({...fresh,total:0}),'0');
 assert.equal(ajesCountText(null),'Количество уточняется');
 assert.equal(ajesCountText({...fresh,stale:true}),'147\u00a0867 · по последним данным');
 assert.equal(exactAjesCount({...fresh,stale:true}),undefined);
 assert.equal(ajesCountText({...fresh,upperBound:true}),'Количество уточняется');
 assert.equal(exactAjesCount({...fresh,upperBound:true}),undefined);
});
test('stock power selection uses numeric nonempty evidence in lists and aggregates',()=>{
 for(const market of ['china','korea'])for(const aggregate of [undefined,'count','models'] as const){
  const q=ajesCatalogQuery({market,powerFrom:'100',powerTo:'160',pageSize:'48'});
  const sql=ajesQuery({...q,aggregate}).sql;
  assert.doesNotMatch(sql,/regexp|pw\+0/);assert.match(sql,/pw>=100/);assert.match(sql,/pw<=160/);
 }
 for(const p of [{powerTo:'-1'},{powerFrom:'200',powerTo:'100'},{powerTo:'Infinity'}])assert.throws(()=>ajesQuery(ajesCatalogQuery({market:'china',...p})));
 assert.match(ajesQuery(ajesCatalogQuery({market:'japan',powerTo:'160'})).sql,/pw<=160/);
 assert.match(ajesQuery(ajesCatalogQuery({market:'china',sort:'mileage',page:'2',pageSize:'48'})).sql,/order by mileage asc, id asc limit 48,48/);
});

test('delivered budget never accepts seller-only or missing specifications',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({budget:'2000000',bodyType:'suv'});
 const seller={market:'china',bodyType:'suv',catalogPricingMode:'seller',totalRub:1000000};
 assert.equal(filter.matches(seller),false);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),true);
 assert.equal(filter.matches({...seller,deliveredCalculationPreview:{totalRub:2100000}}),false);
 assert.equal(filter.matches({...seller,bodyType:'',deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({budget:2000000,city:'Неизвестный город'}).matches({...seller,deliveredCalculationPreview:{totalRub:1900000}}),false);
 assert.equal(ajesResultFilter({hasPrice:'no'}).matches(seller),true);
 assert.throws(()=>ajesResultFilter({budgetFrom:200,budget:100}));
 assert.throws(()=>ajesResultFilter({budget:'NaN'}));
 assert.doesNotThrow(()=>ajesCatalogQuery({market:'china',budget:2000000,bodyType:'suv'}));
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
 for(const table of ['stats','korea','china'])await assert.rejects(client.read({table},''),/client_ip_missing/);
 assert.equal(touched,0);
});

test('exact Korea/China filters recover only matching saved cards when the source refuses',async()=>{
 const {findSavedAjesStockSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const now=Date.parse('2026-10-18T12:00:00Z'),lot={id:'a5',table:'korea',make:'AUDI',model:'A5 F5',year:2023,sourcePrice:35000000,status:''};
 const saved={items:[lot],observedAt:new Date(now-60000).toISOString()},snapshots={one:saved};
 const q={table:'korea' as const,make:'Audi',model:'A5 F5|A5 B10',yearFrom:2023,yearTo:2023};
 const result=findSavedAjesStockSearch(q,snapshots,now)!;assert.equal(result.items[0].id,'a5');assert.equal(result.partial,true);assert.equal(result.stale,true);assert.equal('total' in result,false);
 for(const extra of [{model:'A50'},{make:'BMW'},{yearFrom:2024,yearTo:2024},{page:2},{powerTo:160},{fuel:'petrol'},{sort:'year' as const}])assert.equal(findSavedAjesStockSearch({...q,...extra},snapshots,now),null);
 assert.equal(findSavedAjesStockSearch({table:'korea'},snapshots,now),null);
 for(const change of [{status:'Sold'},{year:2019},{sourcePrice:null},{table:'china'},{make:'HYUNDAI',model:'UNIVERSE'}])assert.equal(findSavedAjesStockSearch(q,{one:{...saved,items:[{...lot,...change}]}},now),null);
 assert.equal(findSavedAjesStockSearch(q,{one:{...saved,observedAt:'2026-10-01T00:00:00Z'}},now),null);
 const china={...q,table:'china' as const,sourcePriceTo:100000};
 assert.equal(findSavedAjesStockSearch(china,{one:{...saved,items:[{...lot,table:'china',sourcePrice:100001}]}},now),null);
 assert.ok(findSavedAjesStockSearch(china,{one:{...saved,items:[{...lot,table:'china',sourcePrice:100000}]}},now));
});


test('large families keep every source generation and never match A50 or S5',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const selection=resolveAjesModelSelection('A5|S5 F5',Array.from({length:40},(_,i)=>({model:'A5 G'+i})).concat([{model:'S5 F5'},{model:'A50'}]));
 assert.deepEqual(selection,{model:'S5 F5',modelFamilies:'A5'});
 const sql=ajesQuery({table:'korea',...selection}).sql;
 assert.match(sql,/\(model_name='S5 F5' or model_name like 'A5 %'\)/);
 assert.throws(()=>ajesQuery({table:'korea',modelFamilies:"A5%' OR 1=1"}));
 assert.deepEqual(resolveAjesModelSelection('A5',[{model:'A5'},{model:'A5 F5'}]),{model:'A5|A5 F5'});
});

test('power results keep the source 111 hp match and reject empty, malformed and over-limit power',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({powerTo:'160'});
 assert.equal(filter.matches({powerHp:111}),true);assert.equal(filter.matches({powerHp:160}),true);
 for(const powerHp of [undefined,null,'',0,200,'111,200','unknown'])assert.equal(filter.matches({powerHp}),false);
});
test('power filter uses the saved horsepower shown on the card without changing source evidence',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({market:'korea',powerTo:'160'});
 const offer={powerHp:150,savedCalculationPreview:{totalRub:4309204,parameters:{powerHp:186,powerKw:136.8027675}}};
 assert.equal(filter.matches(offer),false);
 assert.equal(offer.powerHp,150);
 assert.equal(filter.matches({...offer,savedCalculationPreview:{totalRub:4309204,parameters:{powerHp:160}}}),true);
 assert.equal(filter.matches({...offer,savedCalculationPreview:{totalRub:0,parameters:{powerHp:186}}}),true);
});
test('power search recovers only matching already received cars without requiring a model',async()=>{
 const {findSavedAjesStockSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const now=Date.now(),observedAt=new Date(now-1000).toISOString();
 const snapshots=Object.fromEntries([['ok','111',100],['too','200',200],['missing','',300],['malformed','111,200',400],['wrong','111',500]].map(([id,power,price])=>[id,{observedAt,items:[{id,table:'china',make:id==='wrong'?'Toyota':'Volkswagen',model:'SANTANA',year:new Date().getUTCFullYear(),sourcePrice:price,sourcePower:power}]}]));
 const result=findSavedAjesStockSearch({table:'china',make:'VOLKSWAGEN',powerTo:160,sort:'totalRub'},snapshots,now);
 assert.deepEqual(result?.items.map(x=>x.id),['ok']);assert.equal(result?.partial,true);assert.equal(result?.stale,true);assert.equal('total' in result!,false);
});

test('Honda selector aliases resolve to actual supplier names without changing other makes',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 const names=[{model:'STEPWGN'},{model:'STEPWGN SPADA'},{model:'N-WGN'}];
 assert.deepEqual(resolveAjesModelSelection('STEP WAGON',names,'HONDA'),{model:'STEPWGN|STEPWGN SPADA'});
 assert.deepEqual(resolveAjesModelSelection('STEP WAGON SPADA',names,'Honda'),{model:'STEPWGN SPADA'});
 assert.deepEqual(resolveAjesModelSelection('STEP WAGON',names,'Other'),{model:'STEP WAGON'});
});

test('exact base Corolla does not hide other Corollas in supplier search',async()=>{
 const {resolveAjesModelSelection}=await import('../apps/web/lib/catalog/ajes-model-resolution');
 assert.deepEqual(resolveAjesModelSelection('Corolla',[{model:'COROLLA'},{model:'COROLLA CROSS'},{model:'COROLLA FIELDER'},{model:'CAMRY'}]),{model:'COROLLA|COROLLA CROSS|COROLLA FIELDER'});
});

 test('Japan power discovery checks every supplier alternative without assigning exact power',async()=>{
 const {ajesResultFilter}=await import('../apps/web/lib/catalog/ajes-result-filter');
 const filter=ajesResultFilter({powerTo:'160'});
 for(const [sourcePower,expected] of [['79,98',true],['160',true],['160,200',false],['200,150',false],['',false],['0,98',false],['79,bad',false],['150,2501',false]] as const){
  const offer={sourceId:'ajes_japan_feed',operational:{raw:{sourcePower}}};
  assert.equal(filter.matches(offer),expected,sourcePower);
  assert.equal('powerHp' in offer,false);
 }
 assert.equal(filter.matches({sourceId:'ajes_korea_feed',operational:{raw:{sourcePower:'150'}}}),false);
 assert.equal(ajesResultFilter({powerFrom:'100',powerTo:'160'}).matches({sourceId:'ajes_japan_feed',operational:{raw:{sourcePower:'79,150'}}}),false);
 });

test('Japan power selection recovers only matching bounded saved results after supplier refusal',async()=>{
 const {findSavedAjesSearch}=await import('../apps/web/lib/catalog/ajes-saved-search');
 const now=Date.now(),observedAt=new Date(now-1000).toISOString();
 const snapshots=Object.fromEntries([['ok','79,98'],['limit','160'],['too','150,200'],['missing',''],['bad','150,bad']].map(([id,sourcePower])=>[id,{observedAt,items:[{id,table:'stats',make:'TOYOTA',model:'TEST',year:2023,status:'Sold',finalPriceJpy:1000000,sourcePower}]}]));
 const result=findSavedAjesSearch({table:'stats',powerTo:160},snapshots,now);
 assert.deepEqual(result?.items.map(x=>x.id),['limit','ok']);
 assert.equal(result?.partial,true);assert.equal(result?.stale,true);assert.equal('total' in result!,false);
 assert.equal(findSavedAjesSearch({table:'stats',powerFrom:100,powerTo:159},snapshots,now),null);
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160,page:2},snapshots,now),null);
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160,fuel:'diesel'},snapshots,now),null);
 assert.equal(findSavedAjesSearch({table:'stats',powerTo:160},snapshots,now+8*86400000),null);
});
