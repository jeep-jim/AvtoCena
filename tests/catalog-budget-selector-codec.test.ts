import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBudgetCountIndex,splitBudgetReplayIndex,matchingBudgetIndex} from '../apps/web/lib/catalog/budget-count-index';
import {packBudgetSelector,unpackBudgetSelector,splitPackedBudgetSelectors,verifiedPackedBudgetSelector} from '../apps/web/lib/catalog/budget-selector-codec';
const json=(v:any)=>JSON.parse(JSON.stringify(v));
test('compact wire format preserves every field, missing/null value, market, order and budget result',()=>{
 const offers=['china','korea','japan','uae','georgia','europe'].flatMap(market=>Array.from({length:40},(_,i)=>({id:`${market}-${i}`,market,make:'Toyota',model:'Camry',year:2020+i%6,mileageKm:i%3?10000:undefined,totalRub:i%4?1000000+i*10000:null,powerHp:i%2?150:undefined,fuel:'Бензин',drive:'Передний',bodyType:'Седан',transmission:'Автомат',sourceGroup:'used',updatedAt:'2026-10-10T00:00:00Z',inventorySourceDate:i%3?{year:2023,month:1}:undefined,vehicleCategory:null,publicSpecificationVerified:false})));
 const source=splitBudgetReplayIndex(buildBudgetCountIndex('gen_fixture',offers as any[],new Map(),3)).index;
 const packed=json(packBudgetSelector(source)),restored=unpackBudgetSelector(packed);
 assert.deepEqual(json(restored),json(source));
 for(const market of ['china','korea','japan','uae','georgia','europe'])for(const budgetTo of [1000000,1200000,3000000])assert.deepEqual(json(matchingBudgetIndex(restored,{market,budgetTo})),json(matchingBudgetIndex(source,{market,budgetTo})));
 const oldBytes=Buffer.byteLength(JSON.stringify(source)),newBytes=Buffer.byteLength(JSON.stringify(packed));
 assert.ok(newBytes<oldBytes*0.75,`${newBytes}/${oldBytes}`);
 console.log(JSON.stringify({selectorFixture:{rows:offers.length,oldBytes,newBytes,savedPercent:Math.round(100*(1-newBytes/oldBytes))}}));
});
test('readiness rejects truncated, mixed-generation, wrong-market and corrupt packed selectors',()=>{
 const source=buildBudgetCountIndex('gen_fixture',[{id:'a',market:'china',make:'X',model:'Y',totalRub:1}] as any[],new Map(),3);
 const {directory,parts}=splitPackedBudgetSelectors(source),part=json(parts.get('china'));
 assert.ok(verifiedPackedBudgetSelector(json(directory),'china',part));
 assert.equal(verifiedPackedBudgetSelector({...directory,generationId:'gen_other'},'china',part),null);
 assert.equal(verifiedPackedBudgetSelector(directory,'korea',part),null);
 part.rows[0][1]=2;assert.equal(verifiedPackedBudgetSelector(directory,'china',part),null);
 assert.throws(()=>unpackBudgetSelector({...part,columns:['__proto__']}));
 assert.throws(()=>unpackBudgetSelector({...part,rows:[[null,null,null,null,null,[-1]]]}));
});

test('compressed selectors preserve every market and reject corrupt or mismatched objects',async()=>{
 const {compressedBudgetSelectors,verifiedCompressedBudgetSelector,compressBudgetSelector,decompressBudgetSelector}=await import('../apps/web/lib/catalog/budget-selector-codec');
 const source=buildBudgetCountIndex('gen_compressed',['china','korea','japan','uae','europe','georgia'].flatMap(market=>Array.from({length:50},(_,i)=>({id:`${market}-${i}`,market,make:'Toyota',model:'Camry',bodyType:'sedan',year:2023,totalRub:i%4?2000000+i:null}))) as any[],new Map(),3);
 const packed=splitPackedBudgetSelectors(source),compressed=compressedBudgetSelectors(packed);
 for(const [market,value] of compressed.parts){
  const restored=verifiedCompressedBudgetSelector(compressed.directory,market,json(value));
  assert.deepEqual(json(restored),json(verifiedPackedBudgetSelector(packed.directory,market,json(packed.parts.get(market)))));
  assert.ok(JSON.stringify(value).length<JSON.stringify(packed.parts.get(market)).length/2);
  assert.equal(verifiedCompressedBudgetSelector({...compressed.directory,generationId:'other'},market,value),null);
  assert.equal(verifiedCompressedBudgetSelector(compressed.directory,market,{...value,payload:value.payload.slice(0,-4)}),null);
  assert.equal(verifiedCompressedBudgetSelector(compressed.directory,'unknown',value),null);
 }
 const part=packed.parts.get('china')!;
 assert.deepEqual(decompressBudgetSelector(compressBudgetSelector(part)),json(part));
 assert.throws(()=>decompressBudgetSelector({encoding:'gzip-base64',payload:'invalid!'}));
 assert.throws(()=>decompressBudgetSelector({encoding:'gzip-base64',payload:Buffer.from('not gzip').toString('base64')}));
});
