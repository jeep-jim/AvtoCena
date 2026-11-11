import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {convertToRub} from '../apps/web/lib/catalog/rates';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {enrichOfferWithKnowledgeCore} from '../apps/web/lib/catalog/knowledge-core';
import {offerParameterDraft} from '../apps/web/lib/catalog/offer-parameter-draft';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const storage=getJsonStorage();
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t}_feed`),reserve:t=>reserveAjesRequest(storage,t)});
 const poweredPage=await client.read({table:'korea',powerFrom:1,pageSize:3},ip);
 console.log('KOREA_POWERED_SAMPLE',JSON.stringify(poweredPage.items.map(x=>({id:x.id,make:x.make,model:x.model,power:x.sourcePower,engineCc:x.engineCc,fuel:x.sourceFuel}))));
 for(const item of poweredPage.items){
  const rate=await convertToRub(item.sourcePrice,'KRW');if(!rate)throw Error('rate_unavailable');
  const offer=normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(ajesOffer(item,rate,poweredPage.observedAt)));
  try{const parameters=validateCustomerParameters(offerParameterDraft(offer));const calculated=await calculateOfferWithCustomerParametersDetailed(offer,parameters);
   console.log('KOREA_PAID_CALCULATION',JSON.stringify({id:item.id,sourcePower:item.sourcePower,powerHp:offer.powerHp,engineCc:offer.engineCc,ok:calculated.ok,totalRub:calculated.ok?calculated.calculation.totalRub:null,missing:!calculated.ok?calculated.missing:[]}));
  }catch{console.log('KOREA_PAID_CALCULATION',JSON.stringify({id:item.id,sourcePower:item.sourcePower,powerHp:offer.powerHp,engineCc:offer.engineCc,ok:false,reason:'parameters_incomplete'}));}
 }

}
main().catch(e=>{const reason=String(e?.reason||e?.message||'local_failure');console.log('KOREA_FULL_CHECK_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
