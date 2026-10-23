import test from 'node:test';
import assert from 'node:assert/strict';
import {filterGreenCorner,greenCornerPageSelection} from '../apps/web/lib/catalog/green-corner-search';
test('six-card preview prices only visible matches, while budget still examines all matching candidates',async()=>{
 const stock:any[]=Array.from({length:420},(_,i)=>({id:String(i),make:'Honda',model:'Fit',year:2024,fuel:i<42?'electric':'petrol'}));
 let examined=0;const price=async(items:any[])=>{examined+=items.length;return items.map(x=>({...x,japanDeliveredPreview:{totalRub:1500000}}));};
 const preview=await greenCornerPageSelection(stock,{fuel:'electric'},price,true,6);
 assert.equal(preview.items.length,6);assert.equal(preview.total,42);assert.equal(examined,6);
 examined=0;const budget=await greenCornerPageSelection(stock,{fuel:'electric',budget:'2000000'},price,true,6);
 assert.equal(budget.items.length,6);assert.equal(budget.total,42);assert.equal(examined,42);
});
const rows:any[]=Array.from({length:454},(_,i)=>({id:`green-${i}`,market:'japan',make:'Toyota',model:'Yaris',year:2020+i%7,catalogPricingMode:'seller',sourcePrice:100+i}));
const quote=async(items:any[])=>items.map(x=>({...x,japanDeliveredPreview:{totalRub:x.sourcePrice*10000}}));
test('ordinary stock pages price at most 24 cars and preserve full count, order and pagination',async()=>{
 const calls:number[]=[];
 const price=async(items:any[])=>{calls.push(items.length);return quote(items);};
 for(const page of [1,2,19]){
  const result=await greenCornerPageSelection(rows,{page:String(page),city:'Новокузнецк'},price);
  assert.equal(result.total,454);
  assert.deepEqual(result.items.map(x=>x.id),filterGreenCorner(rows,{}).slice((page-1)*24,page*24).map(x=>x.id));
  assert.ok(result.items.every(x=>x.japanDeliveredPreview?.totalRub));
 }
 assert.deepEqual(calls,[24,24,22]);
 assert.equal((await greenCornerPageSelection(rows,{page:'20'},price,false)).items.length,0);
});
test('budget and price sorting still evaluate the full stock before selecting a page',async()=>{
 for(const params of [{budget:'2300000',sort:'totalRubDesc'},{sort:'totalRub'}]){
  let examined=0;
  const result=await greenCornerPageSelection(rows,params,async items=>{examined+=items.length;return quote(items);});
  const expected=filterGreenCorner(await quote(rows),params);
  assert.equal(examined,454);assert.equal(result.total,expected.length);
  assert.deepEqual(result.items,expected.slice(0,24));
 }
});

test('identity filters calculate only the displayed page and budget calculates matching candidates',async()=>{
 const mixed=[...rows,...rows.map(x=>({...x,id:'other-'+x.id,make:'Honda',model:'Fit'}))];
 let examined=0;const price=async(items:any[])=>{examined+=items.length;return quote(items);};
 const result=await greenCornerPageSelection(mixed,{make:'Honda',model:'Fit'},price);
 assert.equal(examined,24);assert.equal(result.total,454);assert.ok(result.items.every(x=>x.make==='Honda'));
 examined=0;await greenCornerPageSelection(mixed,{make:'Honda',budgetTo:'2000000'},price);assert.equal(examined,454);
});
