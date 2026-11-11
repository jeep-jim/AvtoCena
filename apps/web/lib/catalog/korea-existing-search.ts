import {parseEngineCc} from './engine-input';
import type {CatalogSearchParams} from './types';
/** Preserve the visitor's filters while making the other published Korea inventory discoverable. */
export function koreaExistingSearch(params:Record<string,string>){
 const n=(key:string)=>{const v=Number(params[key]);return Number.isFinite(v)&&v>0?v:undefined;};
 const query:CatalogSearchParams & {source:"existing"}={market:'korea',source:'existing',page:1,pageSize:4,
  city:params.city||undefined,make:params.make||params.brand||undefined,model:params.model||undefined,
  budgetFrom:n('budgetFrom'),budgetTo:n('budgetTo')||n('budget'),hasPrice:params.hasPrice||undefined,
  yearFrom:n('yearFrom'),yearTo:n('yearTo'),mileageFrom:n('mileageFrom'),mileageTo:n('mileageTo'),
  engineFrom:parseEngineCc(params.engineFrom),engineTo:parseEngineCc(params.engineTo),powerFrom:n('powerFrom'),powerTo:n('powerTo'),
  fuel:params.fuel||undefined,transmission:params.transmission||undefined,drive:params.drive||undefined,
  bodyType:params.bodyType||params.body||undefined,sort:params.sort||'updatedAt'};
 const link=new URLSearchParams(params);link.set('market','korea');link.set('source','existing');
 for(const key of ['page','pageSize','after','stock','auctionGrade'])link.delete(key);
 return {query,href:'/cars?'+link.toString()};
}
