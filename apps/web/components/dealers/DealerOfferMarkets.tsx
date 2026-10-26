import {MarketResultCount} from '../catalog/MarketResultCount';
import {AjesRail} from '@/components/catalog/AjesRail';
import {MARKET_RAIL_CLASS} from '@/components/catalog/market-rail-layout';
import {GreenCornerRail} from '@/components/catalog/GreenCornerRail';
import {readGreenCorner,publicGreenOffer} from '@/lib/catalog/green-corner';
import {formatCatalogCount} from '@/lib/catalog/count-format';
import {balanceBusinessRows} from '@/lib/catalog/market-page';
import {CatalogCard} from '@/components/catalog/CatalogCard';
import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {DealerLink as Link} from './DealerBrowsingContext';
import {DEALER_MARKETS,type DealerMarket} from '@/lib/dealers/catalog-markets';
import {searchOffers} from '@/lib/catalog/storage';
import {applyActiveBusinessPricingBatch} from '@/lib/catalog/live-business-pricing';
import {isRenderableRelatedOffer} from '@/lib/catalog/related-offer-selection';
export async function DealerOfferMarkets({markets}:{markets:DealerMarket[]}){
 const greenRead=markets.includes("japan")?readGreenCorner().catch(()=>null):Promise.resolve(null);
 const groups=await Promise.all(DEALER_MARKETS.filter(m=>markets.includes(m.id)&&m.id!=="japan"&&m.id!=="korea").map(async market=>{
  try{const result=await searchOffers({market:market.id,pageSize:12,sort:'updatedAt'});const candidates=balanceBusinessRows(result.items.filter(isRenderableRelatedOffer)).slice(0,6);const rows=await applyActiveBusinessPricingBatch(candidates);return {...market,total:result.total,items:rows};}
  catch(error){console.error('dealer_related_market_failed',market.id,error);return {...market,total:null,items:[]};}
 }));
 const green=await greenRead;
 const greenItems=green?await applyActiveBusinessPricingBatch(green.items.slice(0,10).map(publicGreenOffer)):[];
 return markets.length?<section className="mt-10 space-y-8" data-dealer-markets><h2 className="text-2xl font-black md:text-4xl">Автомобили под заказ</h2>{DEALER_MARKETS.filter(m=>markets.includes(m.id)).map(market=>{
 if(market.id==='japan')return <section key="japan" className="space-y-8"><AjesRail market="japan"/>{green&&<GreenCornerRail items={greenItems} total={green.items.length}/>}</section>;
 if(market.id==='korea')return <AjesRail key="korea" market="korea"/>;
 const group=groups.find(group=>group.id===market.id)!;
 return <section key={group.id}><div className="flex items-center justify-between gap-3"><h3 className="flex flex-wrap items-center gap-2 text-xl font-black"><CatalogMarketFlag market={group.id}/>{group.label}<MarketResultCount total={group.total??undefined}>{group.total===null?"уточняется":formatCatalogCount(group.total)}</MarketResultCount></h3><Link href={`/cars?market=${group.id}`} className="ac-market-all-link text-sm font-black">Все →</Link></div>{group.items.length?<div className={MARKET_RAIL_CLASS+" mt-5"}>{group.items.map(item=><div key={item.id} className="min-w-0"><CatalogCard offer={item} compact dense/></div>)}</div>:<p className="mt-3 text-sm text-[var(--ac-muted)]">Не удалось загрузить автомобили. <Link href={`/cars?market=${group.id}`} className="underline">Открыть каталог</Link></p>}</section>;
 })}</section>:null;
}
