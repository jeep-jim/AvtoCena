import {autoCalcMake, splitAutoCalcIdentity} from '../autocalc/identity';
import type {SourceDraft} from '../autocalc/load';
import type {SpecialOffer} from './showcase-model';
export const importLabels:Partial<Record<keyof SpecialOffer,string>>={make:'Марка',model:'Модель',trim:'Комплектация',year:'Год производства',productionMonth:'Месяц производства',engineCc:'Объём, см³',powerHp:'Мощность, л.с.',power30MinKw:'30-мин. мощность, кВт',fuel:'Двигатель',transmission:'Коробка передач',drive:'Привод',body:'Кузов',color:'Цвет',steering:'Руль',mileageKm:'Пробег, км',priceUsd:'Цена автомобиля, $',description:'Описание',equipment:'Оснащение'};
/** Only evidence supplied by the existing extractor. No customs or eligibility assumptions. */
export function importedOffer(data:SourceDraft):Partial<SpecialOffer>{
 const identity=splitAutoCalcIdentity(data.title||'');
 const patch:Partial<SpecialOffer>={};
 const make=autoCalcMake(data.make||identity.make);const model=data.model||identity.model;
 if(make)patch.make=make;if(model)patch.model=model;
 const d=data.draft||{};
 for(const key of ['year','productionMonth','engineCc','powerHp','power30MinKw','mileageKm'] as const){
  const value=Number(d[key]);if(d[key]!==undefined&&d[key]!==''&&Number.isFinite(value)&&value>=0)patch[key]=value;
 }
 if(['petrol','diesel','electric','hybrid','series_hybrid'].includes(d.fuel))patch.fuel=d.fuel as SpecialOffer['fuel'];
 for(const key of ['trim','transmission','drive','body','color','description','equipment'] as const)if(d[key]?.trim())patch[key]=d[key].trim();
 if(['left','right'].includes(d.steering))patch.steering=d.steering as SpecialOffer['steering'];
 for(const fact of data.facts||[]){
  if(fact.label==='Пробег, км'&&Number.isFinite(Number(fact.value))&&Number(fact.value)>=0)patch.mileageKm=Number(fact.value);
  if(fact.label==='Коробка передач'&&fact.value)patch.transmission=fact.value;
  if(fact.label==='Привод'&&fact.value)patch.drive=fact.value;
 }
 if(data.currency?.toUpperCase()==='USD'&&Number(data.price)>0)patch.priceUsd=Number(data.price);
 return patch;
}
export function applyImportedOffer(current:SpecialOffer,patch:Partial<SpecialOffer>,replace=false){
 return Object.fromEntries(Object.entries(patch).filter(([key])=>replace||!current[key as keyof SpecialOffer]));
}
