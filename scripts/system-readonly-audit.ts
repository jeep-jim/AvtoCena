import {readDataJson} from '../apps/web/lib/data';
import {getEffectiveMarketsWithDefaults} from '../apps/web/lib/effective-market-settings';
import {readCollectionControls} from '../apps/web/lib/catalog/collection-controls';

async function main(){
 const markets=await getEffectiveMarketsWithDefaults();
 for(const market of markets){
  const v:any=market.effectiveVersion;
  const fields=['currency','exchangeRateReservePercent','logisticsUsd','logisticsRub','logisticsUsdRateRub','logisticsRateDate','logisticsRateStatus','securityDepositRub','topAvtoCommissionRub','rfDeliveryRub','provisional'];
  console.log('AUDIT_MARKET',JSON.stringify({market:market.id,...Object.fromEntries(fields.map(k=>[k,v[k]]))}));
 }
 const controls=await readCollectionControls();
 for(const scope of ['markets','sources'] as const)console.log('AUDIT_SWITCHES',JSON.stringify({scope,values:Object.fromEntries(Object.entries(controls[scope]).map(([k,v])=>[k,v.enabled]))}));
 const rates:any=await readDataJson('fees/exchange-rates.json',{});
 console.log('AUDIT_STORED_RATES',JSON.stringify({updatedAt:rates.updatedAt}));
 const manifest:any=await readDataJson('catalog/manifest.json',{});
 console.log('AUDIT_MANIFEST',JSON.stringify({generationId:manifest.generationId,updatedAt:manifest.updatedAt,generatedAt:manifest.generatedAt,total:manifest.total,markets:Object.entries(manifest.markets||{}).map(([market,v]:[string,any])=>({market,count:v.count,total:v.total,updatedAt:v.updatedAt,generatedAt:v.generatedAt}))}));
}
main().catch(()=>{console.error('AUDIT_FAILED');process.exitCode=1;});
