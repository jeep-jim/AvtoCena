import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {CatalogCard} from './CatalogCard';
import {searchOffers} from '@/lib/catalog/storage';
import {applyActiveBusinessPricingBatch} from '@/lib/catalog/live-business-pricing';
import {koreaExistingSearch} from '@/lib/catalog/korea-existing-search';
export async function KoreaExistingMatches({params}:{params:Record<string,string>}){
 const {query,href}=koreaExistingSearch(params);
 let result;
 try{result=await searchOffers(query);}catch{return <p className="mt-6"><Link href={href} className="underline">Посмотреть другие предложения из Кореи</Link></p>;}
 if(!result.total)return null;
 const items=await applyActiveBusinessPricingBatch(result.items).catch(()=>[]);
 return <section className="mt-8 md:mt-9" data-korea-existing-matches data-matching-count={result.total}>
  <div className="mb-4 flex items-center justify-between gap-3"><h2 className="min-w-0 text-[26px] font-black tracking-[-0.04em] md:text-4xl">Ещё автомобили из Кореи</h2><Link className="ac-market-all-link shrink-0 text-sm font-black" href={href}>Все {result.total.toLocaleString('ru-RU')} →</Link></div>
  <div className="mb-2.5 grid min-w-0 grid-cols-2 gap-2.5 sm:mb-3 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense/>)}</div>
 </section>;
}
