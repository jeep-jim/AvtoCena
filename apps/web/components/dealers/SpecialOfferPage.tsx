import {canManageDealer,managesAllDealers} from '@/lib/dealers/access';
import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {canCopyOffer} from '@/lib/offer-copy';
import {Suspense} from 'react';
import {DealerOfferMarkets} from './DealerOfferMarkets';
import {DealerBrowsingProvider} from './DealerBrowsingContext';
import {browsingContextFromShowcase} from '@/lib/dealers/resolve-browsing-context';
import {getSpecialOffer,publicRail} from '@/lib/dealers/public-showcase';
import {findDealer} from '@/lib/dealers/showcase-store';
import {SpecialRail} from './SpecialRail';
import {DealerOfferContent} from './DealerOfferContent';
async function RelatedDealerOffers({id,preview}:{id:string;preview:boolean}){
 const found=await getSpecialOffer(id,preview);if(!found)return null;
 return <SpecialRail kinds={found.offer.availability==='stock'?['stock','order','market']:['order','stock','market']} heading={`Ещё автомобили · ${found.showcase.name}`} items={publicRail(found.showcase).filter(item=>item.id!==found.offer.id)}/>;
}
export async function SpecialOfferPage({id,initialCity,previewRequested=false}:{id:string;initialCity?:string;previewRequested?:boolean}) {
 const userRead=getCurrentUser();
 const publicOfferRead=previewRequested?null:getSpecialOffer(id,false,true);
 const user=await userRead;
 const preview=previewRequested&&user?.role==='owner';
 const found=await (publicOfferRead??getSpecialOffer(id,preview,true));
 if(!found)notFound();
 const [dealer,canEdit]=await Promise.all([findDealer(found.showcase.dealerId),canManageDealer(user,found.showcase.dealerId)]);
 const editBase=managesAllDealers(user)?`/crm/dealers/${encodeURIComponent(found.showcase.dealerId)}`:user?.companyId===found.showcase.dealerId?'/dealer-cabinet':null;
 const editHref=canEdit&&editBase?`${editBase}?offer=${encodeURIComponent(found.offer.id)}`:undefined;
 // getSpecialOffer has already applied publication/membership restrictions.
 const browsing=found.showcase.profileEnabled||preview?browsingContextFromShowcase(found.showcase,preview):null;
 return <DealerBrowsingProvider dealer={browsing} profile><DealerOfferContent editHref={editHref} initialCity={initialCity} id={id} s={found.showcase} o={found.offer} preview={preview} verified={dealer?.status==='verified'} related={<Suspense fallback={null}><RelatedDealerOffers id={id} preview={preview}/></Suspense>} markets={<Suspense fallback={<p className="mt-8 text-sm text-[var(--ac-muted)]">Подбираем автомобили по направлениям дилера…</p>}><DealerOfferMarkets markets={found.showcase.catalogMarkets}/></Suspense>} localCitySelection={Boolean(user)} canCopy={canCopyOffer(user)} canPdf={hasCrmPermission(user,"calculations")}/></DealerBrowsingProvider>;
}
