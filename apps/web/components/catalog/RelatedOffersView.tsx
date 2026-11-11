"use client";
import {CatalogCard} from './CatalogCard';
import {CatalogMarketFlag} from './CatalogMarketFlag';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {CATALOG_MARKET_LABELS} from '@/lib/catalog/runtime-config';
import type {RelatedRecommendations} from './recommendation-types';
export function RelatedOffersView({data,markets}:{data:RelatedRecommendations;markets?:string[]}) {
  const {current,make,familyModel,greenCurrent,modelTitle,marketLabel,marketTotal,stockModels,sameModel,crossMarketGroups,marketRows,partial}=data;
  const modelParams = new URLSearchParams({market:String(current.market||""),make,model:familyModel});
  const marketParams = new URLSearchParams({market:String(current.market||"")});
  if(current.market==='japan')marketParams.set('stock','all');
  if(/^ajes-(?:korea|china)-/.test(String(current.id))){marketParams.set('source','ajes');modelParams.set('source','ajes');}
  const rail = (rows:any[]) => <div className="ac-result-rail ac-hide-scrollbar mt-5 md:!grid md:!grid-flow-row md:!grid-cols-2 md:!auto-cols-auto md:!overflow-visible xl:!grid-cols-4">{rows.map(item=><CatalogCard key={item.id} offer={item} compact />)}</div>;
  return <div className="mt-10 space-y-10 md:mt-14 md:space-y-14" data-related-offers>
    {stockModels.length && (!markets||markets.includes("japan")) ? <section data-related-section="stock-model"><div className="flex items-end justify-between gap-3"><h2 className="ac-green-heading text-[26px] font-black md:text-4xl">{modelTitle} · В наличии</h2><Link href={`/cars/green?${modelParams}`} className="ac-market-all-link ac-green-button shrink-0 text-sm font-black">Все →</Link></div>{rail(stockModels)}</section> : null}
    {sameModel.length ? <section data-related-section="market-model"><div className="flex items-end justify-between gap-3"><h2 className="min-w-0 text-[26px] font-black leading-none tracking-[-0.035em] md:text-4xl">Ещё {modelTitle} · {marketLabel}</h2><Link href={`/cars?${modelParams}${current.market==='japan'?'&stock='+ (greenCurrent?'auction':'all'):''}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{rail(sameModel)}</section> : null}
    {crossMarketGroups.length ? <section data-related-section="other-markets"><h2 className="text-[26px] font-black md:text-4xl">{modelTitle} на других рынках</h2><div className="space-y-8">{crossMarketGroups.filter(group=>!markets||markets.includes(group.market)).map(group=><section key={group.market}><div className="mt-5 flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xl font-black"><CatalogMarketFlag market={group.market} className="h-5 w-7" />{CATALOG_MARKET_LABELS[group.market as keyof typeof CATALOG_MARKET_LABELS]}</h3><Link href={`/cars?${new URLSearchParams({make,model:familyModel,market:group.market,...(group.market==='japan'?{stock:'all'}:{})})}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{rail(group.items)}</section>)}</div></section> : null}
    <section data-related-section="market"><div className="mb-4 flex items-end justify-between gap-4"><h2 className="flex min-w-0 items-center gap-2 text-[26px] font-black tracking-[-0.04em] md:text-4xl"><CatalogMarketFlag market={String(current.market || "")} className="h-5 w-7 md:h-6 md:w-9" /><span>{marketLabel}</span><span className="text-sm text-[var(--ac-muted)] md:text-base">· {marketTotal===null?"—":marketTotal.toLocaleString("ru-RU")}</span></h2><Link href={`/cars?${marketParams}`} className="ac-market-all-link shrink-0 text-sm font-black">Все →</Link></div>{marketRows.length?rail(marketRows):<p className="text-[var(--ac-muted)]">{partial?'Не удалось загрузить предложения этого рынка.':'Другие предложения появятся после обновления каталога.'}</p>}</section>
  </div>;
}
