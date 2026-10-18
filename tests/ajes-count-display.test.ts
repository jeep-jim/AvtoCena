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
 assert.equal(ajesCountText({...fresh,upperBound:true}),'до 147\u00a0867');
 assert.equal(exactAjesCount({...fresh,upperBound:true}),undefined);
});
test('stock power selection uses numeric nonempty evidence in lists and aggregates',()=>{
 for(const market of ['china','korea'])for(const aggregate of [undefined,'count','models'] as const){
  const q=ajesCatalogQuery({market,powerFrom:'100',powerTo:'160',pageSize:'48'});
  const sql=ajesQuery({...q,aggregate}).sql;
  assert.match(sql,/pw regexp/);assert.match(sql,/pw\+0>=100/);assert.match(sql,/pw\+0<=160/);
 }
 for(const p of [{powerTo:'-1'},{powerFrom:'200',powerTo:'100'},{powerTo:'Infinity'}])assert.throws(()=>ajesQuery(ajesCatalogQuery({market:'china',...p})));
 assert.throws(()=>ajesCatalogQuery({market:'japan',powerTo:'160'}),AjesFilterUnavailable);
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
 assert.equal(resolveAjesModelNames('A3',models),'A3');
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
