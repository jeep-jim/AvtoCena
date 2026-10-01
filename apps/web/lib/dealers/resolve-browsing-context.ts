import {cache} from 'react';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from './access';
import {readShowcase} from './showcase-store';
import {publicDealerProfile} from './public-profile';
import {dealerProfilePath} from './profile-url';
import type {DealerBrowsingContext} from './browsing-context';
export const resolveDealerBrowsingContext=cache(async(id:string,previewRequested=false):Promise<DealerBrowsingContext|null>=>{
 if(!id)return null;
 const s=await readShowcase(id);if(!s)return null;
 const preview=previewRequested&&await canManageDealer(await getCurrentUser(),id);
 if(!s.profileEnabled&&!preview)return null;
 const p=publicDealerProfile(s);
 return {id:s.dealerId,name:p.name,logoLight:p.logoLight,logoDark:p.logoDark,href:preview?`/dealers/${encodeURIComponent(s.dealerId)}?preview=1`:dealerProfilePath(s),preview,markets:p.catalogMarkets};
});
