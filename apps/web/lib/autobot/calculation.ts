import {getOfferForPage} from '../catalog/offer-page-data';
import {getOffer} from '../catalog/storage';
import {offerParameterDraft} from '../catalog/offer-parameter-draft';
import {validateCustomerParameters} from '../catalog/customer-parameters';
import {calculateOfferWithCustomerParametersDetailed} from '../catalog/customs-pricing';
import {autocalcScenario} from '../autocalc/scenario';
export function normalizeCalculationArgs(raw:any){
 const args={...raw,draft:{...raw?.draft}};
 const fuel=String(args.draft.fuel||'').trim().toLowerCase();
 const fuels:Record<string,string>={petrol:'petrol',gasoline:'petrol',petroleum:'petrol','бензин':'petrol','бензиновый':'petrol',diesel:'diesel','дизель':'diesel','дизельный':'diesel',electric:'electric','электро':'electric','электричество':'electric','электромобиль':'electric',hybrid:'hybrid','гибрид':'hybrid',lpg:'lpg','сжиженный газ':'lpg',cng:'cng','метан':'cng'};
 if(fuels[fuel])args.draft.fuel=fuels[fuel];
 const markets:Record<string,string>={'китай':'china','япония':'japan','корея':'korea','оаэ':'uae','европа':'europe','грузия':'georgia'};
 if(typeof args.market==='string')args.market=markets[args.market.trim().toLowerCase()]||args.market.trim().toLowerCase();
 if(typeof args.currency==='string')args.currency=args.currency.trim().toUpperCase();
 return args;
}
export async function calculateForChat(input:any){
 const args=normalizeCalculationArgs(input);
 let offer:any,parameters:any;
 if(args?.id){
  if(!/^[a-zA-Z0-9_-]{1,180}$/.test(args.id))throw Error('Уточните автомобиль.');
  offer=await getOfferForPage(args.id)||await getOffer(args.id);if(!offer)throw Error('Автомобиль не найден.');
  const allowed=['year','productionMonth','productionDay','engineCc','fuel','powerHp','powerKw','hybridKind','power30MinKw','icePowerKw','vehicleCategory','grossVehicleWeightKg','n1IceFuel'];
  const draft:Record<string,any>={...offerParameterDraft(offer),deliveryCity:args.city||offer.deliveryCity||''};
  for(const k of allowed)if(args.draft?.[k]!=null)draft[k]=args.draft[k];
  const names:Record<string,string>={year:'год выпуска',fuel:'топливо',powerHp:'мощность двигателя, л.с.',engineCc:'объём двигателя, см³',deliveryCity:'город доставки',power30MinKw:'подтверждённая 30-минутная мощность, кВт',icePowerKw:'мощность ДВС, кВт',hybridKind:'тип гибрида'};
  const required=['year','fuel','deliveryCity',...(draft.vehicleCategory==='N1'?[]:['powerHp']),...(draft.fuel==='electric'?['power30MinKw']:['engineCc']),...(draft.fuel==='hybrid'?['hybridKind','power30MinKw','icePowerKw']:[])];
  const missing=required.filter(k=>draft[k]==null||draft[k]==='').map(k=>names[k]);
  if(missing.length)return {ok:false,missing,error:'Для расчёта нужны: '+missing.join(', ')+'.'};
  try{parameters=validateCustomerParameters(draft);}catch(e){let message=e instanceof Error?e.message:'Проверьте параметры.';for(const [k,label] of Object.entries(names))message=message.replaceAll(k,label);throw Error(message);}
 }else{const scenario=autocalcScenario(args);offer=scenario.offer;parameters=scenario.parameters;}
 const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);
 return {...result,vehicle:{make:offer.make,model:offer.model,year:offer.year,market:offer.market},parameters,calculatedAt:new Date().toISOString(),label:'Расчёт по указанным данным; характеристики и условия требуют подтверждения. Не изменяет объявление.'};
}

export function calculationReply(result:any){
 if(!result?.ok)return result?.error||'Для расчёта не хватает исходных данных.';
 const c=result.calculation, money=(v:number)=>Math.round(v).toLocaleString('ru-RU')+' ₽';
 const parts=[`${[result.vehicle?.make,result.vehicle?.model,result.vehicle?.year].filter(Boolean).join(' ')}: ${money(c.totalRub)} — расчёт по указанным данным.`,c.deliveryQuote?.city?`Город доставки: ${c.deliveryQuote.city}.`:'',c.currencyRate?`Курс ${c.currencyRate.currency}: ${c.currencyRate.effectiveRate} ₽, дата курса ${c.currencyRate.rateDate}.`:'',...((c.breakdown||[]).map((r:any)=>`${r.title}: ${money(r.amountRub)}.`))];
 const warnings=[...new Set<string>(c.warnings||[])];if(warnings.length)parts.push('Условия расчёта:',...warnings);
 parts.push('Характеристики и итоговые условия требуют подтверждения. [Открыть АвтоРасчёт](/autocalc)');return parts.filter(Boolean).join('\n');
}
