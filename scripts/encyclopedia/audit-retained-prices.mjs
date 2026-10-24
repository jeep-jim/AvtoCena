import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {readCurrentCatalogProjectionSnapshot} from '../../apps/web/lib/catalog/storage.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
const store=getJsonStorage();store.writeJson=async()=>{throw Error('read_only');};
const snapshot=await readCurrentCatalogProjectionSnapshot(),byId=new Map(snapshot.items.map(x=>[x.id,x]));
const report={checkedAt:new Date().toISOString(),generationId:snapshot.generationId,scope:'Retained five-market price snapshots, checksum-verified and joined by offer ID; not all supplier Japan inventory; not a new calculation.',markets:{},storageWrites:0};
function kind(v){const k=String(v.powertrainKind||'').toLowerCase();return k==='electric'?'electric':['series_hybrid','other_hybrid','hev','phev'].includes(k)?'hybrid':k==='combustion'?'combustion':'unknown';}
for(const market of ['china','europe','korea','uae','georgia']){let value=await store.readJson(`catalog/runtime-budget-prices-v2/${market}.json`,null);if(value?.encoding==='gzip-base64')value=JSON.parse(gunzipSync(Buffer.from(value.payload,'base64'),{maxOutputLength:64*1024*1024}));if(!value||value.checksum!==checksum(value.prices))throw Error('snapshot_checksum:'+market);
 const r=report.markets[market]={retainedOffers:snapshot.items.filter(x=>x.market===market).length,snapshotAt:new Date(value.createdAt).toISOString(),snapshotKey:value.key,pricedOffers:0,sellerOnly:0,deliveredTotals:0,unmatchedIds:0,byPowertrain:{combustion:0,hybrid:0,electric:0,unknown:0}};const seen=new Set();
 for(const [id,total,basis,seller] of value.prices){if(seen.has(id))throw Error('duplicate_id');seen.add(id);const v=byId.get(id);if(!v||v.market!==market){r.unmatchedIds++;continue;}if(!(total>0))throw Error('invalid_total');r.pricedOffers++;if(seller){r.sellerOnly++;continue;}r.deliveredTotals++;r.byPowertrain[kind(v)]++;}
}
if((await store.readJson('catalog/manifest.json',null))?.generationId!==snapshot.generationId)throw Error('generation_changed');
await fs.mkdir('reports',{recursive:true});await fs.writeFile('reports/retained-prices.json',JSON.stringify(report,null,2));console.log('RETAINED_PRICES',JSON.stringify(report));
