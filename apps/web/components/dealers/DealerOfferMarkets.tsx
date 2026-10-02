import {CatalogCard} from '@/components/catalog/CatalogCard';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {DealerLink as Link} from './DealerBrowsingContext';
import {DEALER_MARKETS,type DealerMarket} from '@/lib/dealers/catalog-markets';
import {searchOffers} from '@/lib/catalog/storage';
import {applyActiveBusinessPricingBatch} from '@/lib/catalog/live-business-pricing';
import {isRenderableRelatedOffer} from '@/lib/catalog/related-offer-selection';
export async function DealerOfferMarkets({markets}:{markets:DealerMarket[]}){
 const groups=await Promise.all(DEALER_MARKETS.filter(m=>markets.includes(m.id)).map(async market=>{
  try{const result=await searchOffers({market:market.id,pageSize:12,sort:'updatedAt'});const rows=await applyActiveBusinessPricingBatch(result.items);return {...market,items:rows.filter(isRenderableRelatedOffer).slice(0,4)};}
  catch(error){console.error('dealer_related_market_failed',market.id,error);return {...market,items:[]};}
 }));
 return groups.length?<section className="mt-10 space-y-8" data-dealer-markets><h2 className="text-2xl font-black md:text-4xl">Автомобили под заказ</h2>{groups.map(group=><section key={group.id}><div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xl font-black"><CatalogMarketFlag market={group.id}/>{group.label}</h3><Link href={`/cars?market=${group.id}`} className="ac-market-all-link text-sm font-black">Все →</Link></div>{group.items.length?<div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{group.items.map(item=><CatalogCard key={item.id} offer={item} compact/>)}</div>:<p className="mt-3 text-sm text-[var(--ac-muted)]">Посмотрите каталог этого направления или оставьте заявку на подбор.</p>}</section>)}</section>:null;
}
