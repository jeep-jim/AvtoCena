import { randomUUID } from 'node:crypto';
import type { VehicleOffer } from '../catalog/types';
import { validateCustomerParameters } from '../catalog/customer-parameters';
import { sourceUrl } from './source';
export function autocalcScenario(body:any) {
  if(!['japan','china','korea','uae','europe','georgia'].includes(body?.market))throw Error('Выберите страну покупки');
  if(!['JPY','CNY','KRW','USD','EUR','AED','GEL'].includes(body?.currency))throw Error('Выберите валюту цены');
  const price=Number(body.price);if(!Number.isFinite(price)||price<=0||price>1e12)throw Error('Укажите цену автомобиля');
  const title=String(body.title||'').trim().slice(0,180);if(!title)throw Error('Укажите название автомобиля');
  const draft={...body.draft,deliveryCity:String(body.city||'').trim()};if(!draft.deliveryCity)throw Error('Выберите город доставки');
  if (!["M1","N1"].includes(draft.vehicleCategory)) throw Error("Выберите категорию автомобиля по документам: M1 или N1");
  const parameters=validateCustomerParameters(draft);
  const now=new Date().toISOString();
  const offer:VehicleOffer={id:`manual-${randomUUID()}`,sourceId:'manual_link',sourceOfferId:'manual',market:body.market,make:title,model:'',year:parameters.year!,offerType:'fixed',status:'active',sourcePrice:price,sourceCurrency:body.currency,priceMode:'fixed',images:[],calculationStatus:'needs_data',firstSeenAt:now,updatedAt:now,operational:{sourceUrl:body.url?sourceUrl(body.url).href:undefined}};
  return {offer,parameters,draft};
}
