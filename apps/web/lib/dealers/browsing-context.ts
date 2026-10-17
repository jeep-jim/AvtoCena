import type { DealerMarket } from './catalog-markets';
export type DealerBrowsingContext = {id:string;name:string;headerIcon?:string;logoLight:string;logoDark:string;href:string;preview:boolean;markets:DealerMarket[]};
export function dealerBrowsingHref(href:string, dealer:DealerBrowsingContext|null):string {
 if(!dealer || !href.startsWith('/') || href.startsWith('//'))return href;
 const url=new URL(href,'https://avtocena.com');
 if(url.pathname==='/cars'||url.pathname==='/cars/green') {
  const target=new URL(dealer.href,'https://avtocena.com');
  for(const [key,value] of url.searchParams)if(!['dealer','preview'].includes(key))target.searchParams.set(key,value);
  if(url.pathname==='/cars/green'){target.searchParams.set('market','japan');target.searchParams.set('stock','green');}
  return target.pathname+target.search+url.hash;
 }
 if(url.pathname.startsWith('/cars/')||url.pathname==='/request') {
  url.searchParams.set('dealer',dealer.id);
  if(dealer.preview)url.searchParams.set('preview','1');
  return url.pathname+url.search+url.hash;
 }
 return href;
}
