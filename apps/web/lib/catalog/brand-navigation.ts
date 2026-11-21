import {dealerBrowsingHref,type DealerBrowsingContext} from '../dealers/browsing-context';

/** Preserve server-resolved country/source on country landing pages without query parameters. */
export function brandContextQuery(search:string,initial:Record<string,string>={}){
 const params=new URLSearchParams(search);
 for(const [key,value] of Object.entries(initial))if(value)params.set(key,value);
 return params.toString();
}
export function brandSelectionQuery(context:string,brands:string[]){
 const params=new URLSearchParams(context);
 const ordered=[...new Set(brands)].sort((a,b)=>a.localeCompare(b,'ru'));
 if(ordered.length)params.set('make',ordered.join(','));else params.delete('make');
 for(const key of ['brand','model','page','after'])params.delete(key);
 return params.toString();
}


/** The same canonical destination used by the buyer's left-side filter. */
export function catalogFilterHref(query:URLSearchParams,dealer:DealerBrowsingContext|null){
 const path=query.get('market')==='japan'&&query.get('stock')==='green'?'/cars/green':'/cars';
 return dealerBrowsingHref(query.size?`${path}?${query}`:path,dealer);
}

/** A new selection resets old pagination/model/generation, not the market. */
export function brandFilterHref(context:string,brands:string[],dealer:DealerBrowsingContext|null,city=''){
 const params=new URLSearchParams(brandSelectionQuery(context,brands));
 params.delete('preparedCut');
 if(city)params.set('city',city);
 return catalogFilterHref(params,dealer);
}
