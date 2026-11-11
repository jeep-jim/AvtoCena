import {availableShowcase} from '@/lib/dealers/program-store';
import {DealerDirectory} from '@/components/dealers/DealerDirectory';
import {readDealers,readShowcase} from '@/lib/dealers/showcase-store';
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import {publicDealerText} from '@/lib/dealers/public-profile';
export const dynamic='force-dynamic';
export const metadata={title:'Автодилеры — АвтоЦена',alternates:{canonical:'/dealers'},description:'Найдите автодилера в своём городе. Каталог компаний АвтоЦена.'};
export default async function Page(){
 const rows=await readDealers();
 const dealers=[];
 // Bounded batches: directory size must not fan out all storage reads at once.
 for(let offset=0;offset<rows.length;offset+=8){
  const batch=await Promise.all(rows.slice(offset,offset+8).map(async dealer=>{
   const stored=await readShowcase(dealer.id);
   if(!stored?.profileEnabled)return null;
   const s=await availableShowcase(stored);
   if(!s.profileEnabled)return null;
   return {id:s.dealerId,name:publicDealerText(s.name),description:publicDealerText(s.description),logoLight:s.logoLight,logoDark:s.logoDark,banner:s.banner,bannerMobile:s.bannerMobile,href:dealerProfilePath(s),cities:[...new Set(s.offices.map(o=>o.city))],verified:dealer.status==='verified'};
  }));
  for(const dealer of batch)if(dealer)dealers.push(dealer);
 }
 return <DealerDirectory dealers={dealers}/>;
}
