/** Initial browse surface only: a user-supplied search/sort/page always uses
 * the exact prepared selection. Never portray an admitted sample as page one. */
export function isChinaDefaultShowcaseQuery(params:Record<string,string|string[]|undefined>){
 return params.market==='china'&&Object.entries(params).every(([k,v])=>
  v===undefined||v===''||((k==='market'||k==='city')&&typeof v==='string'));
}
export function chinaExactListHref(city?:string){
 const p=new URLSearchParams({page:'1'});
 if(city)p.set('city',city);
 return '/cars/china?'+p;
}
