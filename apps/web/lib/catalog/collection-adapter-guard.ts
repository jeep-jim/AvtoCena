import type {CatalogSourceAdapter} from './types';
import {assertCollectionEnabled} from './collection-controls';
/** Proxy preserves prototype methods and this binding on class-based adapters. */
export function guardCollectionAdapter(source:CatalogSourceAdapter):CatalogSourceAdapter {
  const guarded=new Set(['fetchPage','fetchImages','refreshOffer','healthCheck']);
  return new Proxy(source,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(typeof value!=='function')return value;
    if(!guarded.has(String(key)))return value.bind(target);
    return async (...args:unknown[])=>{await assertCollectionEnabled(target.sourceId);return value.apply(target,args);};
  }});
}
