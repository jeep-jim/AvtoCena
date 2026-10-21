import {availableShowcase} from '@/lib/dealers/program-store';
import {DealerDirectory} from '@/components/dealers/DealerDirectory';
import {findDealer,readShowcase} from '@/lib/dealers/showcase-store';
import {PILOT_DEALER_ID} from '@/lib/dealers/showcase-model';
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import {publicDealerText} from '@/lib/dealers/public-profile';
export const dynamic='force-dynamic';
export const metadata={title:'Автодилеры — АвтоЦена',alternates:{canonical:'/dealers'},description:'Найдите автодилера в своём городе. Каталог компаний АвтоЦена.'};
export default async function Page(){
 const [stored,dealer]=await Promise.all([readShowcase(PILOT_DEALER_ID),findDealer(PILOT_DEALER_ID)]);
 const s=stored?await availableShowcase(stored):null;
 const dealers=s?.profileEnabled?[{id:s.dealerId,name:publicDealerText(s.name),description:publicDealerText(s.description),logoLight:s.logoLight,logoDark:s.logoDark,banner:s.banner,bannerMobile:s.bannerMobile,href:dealerProfilePath(s),cities:[...new Set(s.offices.map(o=>o.city))],verified:dealer?.status==='verified'}]:[];
 return <DealerDirectory dealers={dealers}/>;
}
