import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {convertToRub} from '../apps/web/lib/catalog/rates';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
async function main(){
 let stage='owner_switch';
 try{
  await assertCollectionEnabled('ajes_japan_feed');console.log('AJES_CHECK switches_enabled');
  stage='configuration';const password=await ajesPassword();console.log('AJES_CHECK configured',Boolean(password));if(!password)return;
  const client=createAjesClient({password:async()=>password,assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),reserve:table=>reserveAjesRequest(getJsonStorage(),table)});
  stage='supplier_list';const result=await client.read({table:'stats',pageSize:24},'8.1.1.1');console.log('AJES_CHECK list',JSON.stringify({received:result.received,accepted:result.items.length,rejected:result.rejected}));
  stage='currency';const lot=result.items[0];if(!lot)return;
  const rate=await convertToRub(lot.finalPriceJpy,'JPY');console.log('AJES_CHECK currency',JSON.stringify({available:Boolean(rate),source:rate?.rateSource,date:rate?.rateDate,bound:rate?.sourcePrice===lot.finalPriceJpy}));
  stage='offer';if(rate){const offer=ajesOffer(lot,rate,result.observedAt);console.log('AJES_CHECK offer',JSON.stringify({priced:Boolean(offer.sellerPriceRub),images:offer.images.length}));}
 }catch(error){console.log('AJES_CHECK failed',JSON.stringify({stage,reason:error instanceof AjesUnavailable?error.reason:'operation_failed'}));process.exitCode=1;}
}
void main();
