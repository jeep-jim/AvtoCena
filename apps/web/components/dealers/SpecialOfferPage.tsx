import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {canCopyOffer} from '@/lib/offer-copy';
import {Suspense} from 'react';
import {DealerOfferMarkets} from './DealerOfferMarkets';
import {DealerBrowsingProvider} from './DealerBrowsingContext';
import {resolveDealerBrowsingContext} from '@/lib/dealers/resolve-browsing-context';
import {getSpecialOffer,publicRail} from '@/lib/dealers/public-showcase';
import {findDealer} from '@/lib/dealers/showcase-store';
import {DealerOfferContent} from './DealerOfferContent';
export async function SpecialOfferPage({id,initialCity,previewRequested=false}:{id:string;initialCity?:string;previewRequested?:boolean}) {
 const user=await getCurrentUser();
 const preview=previewRequested&&user?.role==='owner';
 const found=await getSpecialOffer(id,preview);
 if(!found)notFound();
 const dealer=await findDealer(found.showcase.dealerId);
 const browsing=await resolveDealerBrowsingContext(found.showcase.dealerId,preview);
 return <DealerBrowsingProvider dealer={browsing} profile><DealerOfferContent initialCity={initialCity} id={id} s={found.showcase} o={found.offer} preview={preview} verified={dealer?.status==='verified'} items={publicRail(found.showcase)} markets={<Suspense fallback={<p className="mt-8 text-sm text-[var(--ac-muted)]">Подбираем автомобили по направлениям дилера…</p>}><DealerOfferMarkets markets={found.showcase.catalogMarkets}/></Suspense>} localCitySelection={Boolean(user)} canCopy={canCopyOffer(user)} canPdf={hasCrmPermission(user,"calculations")}/></DealerBrowsingProvider>;
}
