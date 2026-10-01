import {offerParameterDraft} from './offer-parameter-draft';
import {sharedOfferScenario} from './shared-offer-scenario';
import {encodeShareDraft} from './offer-share';
import type {Metadata} from 'next';
import {getOfferDetailRecord} from './offer-page-data';
import {getSavedOfferCalculation} from './saved-offer-calculation';
import {directOfferScenario} from './yandex-direct-scenario';
import {resolveOfferDisplay} from './offer-display-data';
import {offerPath,offerRouteId} from './offer-url';
import {offerShareTitle,offerShareUrl} from './offer-share';
import {presentCatalogOffer} from './presentation';
import {rankedCatalogImageUrls} from './image-quality';
import {protectedPhotoUrl} from './photo-proxy-policy';
import {absoluteAvtocenaUrl} from '../ai-discovery';
import {parseSpecialId,specialTitle,calculateSpecial} from '../dealers/showcase-model';
import {getSpecialOffer} from '../dealers/public-showcase';

type Query={calculation?:string;direct?:string;powerHp?:string;modificationId?:string;preview?:string;estimate?:string;share?:string;dealer?:string};
function metadata(title:string,description:string,url:string,images:string[],index=true):Metadata {
 return {title,description,alternates:{canonical:url},openGraph:{type:'website',title,description,url,images:images.map(url=>({url,alt:title}))},twitter:{card:'summary_large_image',title,description,images},robots:{index,follow:index,'max-image-preview':'large'}};
}
export async function generateOfferMetadata({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<Query>}):Promise<Metadata>{
 const route=(await params).id;let id=offerRouteId(route);try{id=offerRouteId(decodeURIComponent(route));}catch{}
 const q=await searchParams || {};
 if(parseSpecialId(id)){
  const found=await getSpecialOffer(id);
  if(!found)return {title:'Автомобиль — АвтоЦена',robots:{index:false,follow:false}};
  const {showcase,offer}=found;const calculation=calculateSpecial(showcase,offer);
  const title=offerShareTitle({title:specialTitle(offer),year:offer.year,engineCc:offer.engineCc,fuel:offer.fuel,totalRub:calculation.totalRub});
  return metadata(q.share==='3'?title.replace(/ — (?:[\d ]+ ₽|Цена уточняется)$/,''):title,'Фотографии, комплектация и условия покупки — в карточке автомобиля.',absoluteAvtocenaUrl(`/cars/offer/${id}`),offer.photos.slice(0,3).map(p=>absoluteAvtocenaUrl(p.url)),!q.preview);
 }
 const stored=await getOfferDetailRecord(id);
 if(!stored)return {title:'Автомобиль — АвтоЦена',robots:{index:false,follow:true}};
 const power=Number(q.powerHp||0);const safePower=Number.isFinite(power)&&power>=20&&power<=2500?Math.round(power):0;
 const [display,saved,client]=await Promise.all([resolveOfferDisplay(stored,safePower,q.modificationId||''),getSavedOfferCalculation(stored),q.calculation?getSavedOfferCalculation(stored,q.calculation):Promise.resolve(null)]);
 const direct=client || (q.direct==='novokuznetsk'?await directOfferScenario(stored):null);
 const explicit=q.estimate?await sharedOfferScenario(stored,q.estimate):null;
 const automatic=!direct&&!saved&&display.sellerPricing&&!display.selectionRequired ? await sharedOfferScenario(stored,encodeShareDraft(offerParameterDraft(display.offer,display.raw))) : null;
 const scenario=explicit||direct||saved||automatic;
 const {offer,raw,pricedOffer,visibleRub,sellerPricing,selectionRequired}=display;
 const presented=presentCatalogOffer(raw);
 const totalRub=scenario?.calculation.totalRub || (sellerPricing?null:visibleRub);
 const title=offerShareTitle({title:presented.title,year:scenario?.draft.year||offer.year,engineCc:scenario?.draft.engineCc||offer.engineCc,fuel:scenario?.draft.fuel||offer.fuel,totalRub});
 const description=`${scenario?.draft.deliveryCity?`Доставка: ${scenario.draft.deliveryCity}. `:''}Фотографии, характеристики и состав стоимости — в карточке автомобиля.`;
 const query=new URLSearchParams();for(const key of ['calculation','direct','powerHp','modificationId','estimate','share','dealer'] as const)if(q[key])query.set(key,q[key]!);
 const url=offerShareUrl(absoluteAvtocenaUrl(offerPath(stored))+(query.size?'?'+query:''),offerPath(stored));
 // The share message already contains the calculated price; avoid repeating it in its preview.
 const previewTitle=q.share==='3'?title.replace(/ — (?:[\d ]+ ₽|Цена уточняется)$/,''):title;
 const images=rankedCatalogImageUrls(pricedOffer).slice(0,3).map(u=>absoluteAvtocenaUrl(protectedPhotoUrl(u,offer.market)));
 return metadata(previewTitle,description,url,images,Boolean(scenario||visibleRub||selectionRequired||sellerPricing));
}
