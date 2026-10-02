import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {canCopyOffer} from '@/lib/offer-copy';
import {getSpecialOffer} from '@/lib/dealers/public-showcase';
import {findDealer} from '@/lib/dealers/showcase-store';
import {DealerOfferContent} from './DealerOfferContent';
export async function SpecialOfferPage({id,previewRequested=false}:{id:string;previewRequested?:boolean}) {
 const user=await getCurrentUser();
 const preview=previewRequested&&user?.role==='owner';
 const found=await getSpecialOffer(id,preview);
 if(!found)notFound();
 const dealer=await findDealer(found.showcase.dealerId);
 return <DealerOfferContent id={id} s={found.showcase} o={found.offer} preview={preview} verified={dealer?.status==='verified'} canCopy={canCopyOffer(user)} canPdf={hasCrmPermission(user,"calculations")}/>;
}
