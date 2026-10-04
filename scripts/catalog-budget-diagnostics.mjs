import {getJsonStorage,readDataJson} from '../apps/web/lib/data.ts';
import {applyActiveBusinessPricingBatch} from '../apps/web/lib/catalog/live-business-pricing.ts';
import {includedDepositCost} from '../apps/web/lib/catalog/deposit-cost-projection.ts';
const storage=getJsonStorage();
storage.writeJson=async()=>{throw Error('diagnostic_read_only');};
storage.putBinary=async()=>{throw Error('diagnostic_read_only');};
const manifest=await readDataJson('catalog/manifest.json',{});
const projection=await readDataJson('catalog/public/projection/korea.json',{items:[]});
const index=await readDataJson(`catalog/generations/${manifest.generationId}/indexes/budget-count-v2.json`,{rows:[]});
const id='7e915e3af5196989891846b6';
const source=projection.items.find(row=>row.id===id);
if(!source)throw Error('diagnostic_offer_missing');
const [current]=await applyActiveBusinessPricingBatch([source]);
const summary=row=>({totalRub:row.totalRub,publicVisibleRub:row.publicVisibleRub,sourcePrice:row.sourcePrice,sourceCurrency:row.sourceCurrency,year:row.year,productionDate:row.productionDate,status:row.calculationStatus,deposit:includedDepositCost(row.calculationSnapshot),rate:row.calculationSnapshot?.currencyRate,customs:row.calculationSnapshot?.customs,customsInput:row.calculationSnapshot?.customsInput,deliveryBasis:row.calculationSnapshot?.deliveryPricingBasis});
console.log(JSON.stringify({id,generation:manifest.generationId,projectionGeneration:projection.generationId,index:index.rows.find(row=>row[5].id===id)?.slice(0,3),stored:summary(source),current:summary(current)}));

const {searchOffers,countCatalogOffers}=await import('../apps/web/lib/catalog/storage.ts');
console.log(JSON.stringify({indexBytes:Buffer.byteLength(JSON.stringify(index)),priced:index.rows.length,other:index.otherRows?.length}));
for(const market of ['korea','any']){
 const start=performance.now();const result=await searchOffers({market,budgetTo:2000000,pageSize:24});const price=await applyActiveBusinessPricingBatch(result.items);const invalid=price.filter(row=>Number(row.totalRub)>2000000).map(row=>({id:row.id,total:row.totalRub}));console.log(JSON.stringify({market,total:result.total,ms:Math.round(performance.now()-start),rssMb:Math.round(process.memoryUsage().rss/1024/1024),invalid}));if(invalid.length)throw Error('budget_contains_expensive_card');
 const warm=performance.now();const count=await countCatalogOffers({market,budgetTo:2000000});console.log(JSON.stringify({market,count:count.total,warmMs:Math.round(performance.now()-warm)}));if(count.total!==result.total)throw Error('count_mismatch');
}
