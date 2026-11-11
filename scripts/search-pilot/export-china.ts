// Owner-requested isolated pilot: existing China selector only, no supplier API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../../apps/web/lib/data';
import {readCompressedSelector} from '../../apps/web/lib/catalog/budget-selector-publication';
import {priceCardForCity} from '../../apps/web/lib/catalog/card-city-delivery';
import {calculatedCatalogPrice} from '../../apps/web/lib/catalog/calculated-price';
import {modelSearchName} from '../../apps/web/lib/catalog/model-search-name';
async function main(){
const output='/tmp/avtocena-search-pilot';
const storage=getJsonStorage();
storage.writeJson=async()=>{throw Error('pilot_production_write_forbidden');};
const manifest:any=await storage.readJson('catalog/manifest.json',null);
assert.ok(/^[a-zA-Z0-9_.-]+$/.test(manifest?.generationId||''));
const root='catalog/generations/'+manifest.generationId+'/indexes/budget-markets-v3/';
let objects=1;
const directory:any=await storage.readJson(root+'ready.json',null);objects++;
assert.equal(directory?.generationId,manifest.generationId);
const index=await readCompressedSelector(directory,'china',async name=>{objects++;return storage.readJson(root+name+'.json',null);});
assert.ok(index&&index.sourceRows>0&&index.sourceRows<=1000000,'complete bounded China selector required');
const source=[...index.rows,...(index.otherRows||[])];
assert.equal(new Set(source.map(row=>row[5].id)).size,source.length);
const rows:any[]=[];
for(const row of source){
 assert.equal(row[0],'china');const metadata=row[5];
 for(const city of ['Москва','Новокузнецк']){
  const offer={market:'china',totalRub:row[1],catalogPricingMode:row[4]?'seller':undefined,calculationSnapshot:{deliveryPricingBasis:row[2]}};
  const priced=priceCardForCity(offer,city),total=priced.included?calculatedCatalogPrice(priced.offer):0;
  const power=Number(metadata.powerHp),year=Number(metadata.year);
  rows.push({generation:index.generationId,city,id:metadata.id,make:String(metadata.make||'').toUpperCase(),model:modelSearchName(metadata.make,metadata.model).toUpperCase(),year:Number.isSafeInteger(year)?year:null,power:Number.isFinite(power)&&power>0?power:null,price:total>0?total:null});
 }
}
const compare=(a:any,b:any)=>a.price-b.price||(a.id<b.id?-1:a.id>b.id?1:0);
const cases=[
 {name:'budget_1_5m_moscow',city:'Москва',budget:1500000,offset:0,descending:false},
 {name:'budget_1_5m_novokuznetsk',city:'Новокузнецк',budget:1500000,offset:0,descending:false},
 {name:'bmw_under160',city:'Москва',make:'BMW',power:160,offset:0,descending:false},
 {name:'price_page9',city:'Москва',offset:192,descending:false},
 {name:'price_descending',city:'Москва',offset:0,descending:true}
];
const expected=cases.map((q:any)=>{
 const matching=rows.filter(r=>r.city===q.city&&r.price!==null&&(!q.budget||r.price<=q.budget)&&(!q.make||r.make===q.make)&&(!q.power||r.power!==null&&r.power<=q.power)).sort(compare);
 assert.ok(matching.length>=q.offset+24,'pilot requires populated pages: '+q.name);
 if(q.descending)matching.reverse();
 return {...q,total:matching.length,ids:matching.slice(q.offset,q.offset+24).map(r=>r.id)};
});
const csv=(v:unknown)=>v===null?'':'"'+String(v).replaceAll('"','""')+'"';
await fs.mkdir(output,{recursive:true});
await fs.writeFile(output+'/china.csv',rows.map(r=>[r.generation,r.city,r.id,r.make,r.model,r.year,r.power,r.price].map(csv).join(',')).join('\n')+'\n');
await fs.writeFile(output+'/expected.json',JSON.stringify(expected));
await fs.writeFile(output+'/source.json',JSON.stringify({checkedAt:new Date().toISOString(),generationId:index.generationId,sourceRows:source.length,cityRows:rows.length,storageObjectsRead:objects,sourceChecksum:createHash('sha256').update(JSON.stringify(source.map(r=>r[5].id))).digest('hex'),source:'existing validated immutable China selector; frozen snapshot prices, not fresh live acceptance',productionWrites:0,supplierRequests:0}));
console.log('SEARCH_PILOT_EXPORT',JSON.stringify({rows:source.length,cityRows:rows.length,objects}));

}
main().catch(error=>{console.error('SEARCH_PILOT_EXPORT_FAILED',error instanceof Error?error.name:'unknown');process.exitCode=1;});
