import {DealerOfferView} from './DealerOfferView';
import type {ComponentProps} from 'react';
import type {DealerShowcase} from '@/lib/dealers/showcase-model';
/** Send only fields required by the public offer, never bank details or other drafts. */
export function DealerOfferContent({s,...props}:Omit<ComponentProps<typeof DealerOfferView>,'s'>&{s:DealerShowcase}){
 const {dealerId,citySlug,slug,name,logoLight,logoDark,profileEnabled,specialsEnabled,stockEnabled,pricing,offices,updatedAt}=s;
 return <DealerOfferView {...props} s={{dealerId,citySlug,slug,name,logoLight,logoDark,profileEnabled,specialsEnabled,stockEnabled,pricing,offices:offices.map(o=>({...o,phone:''})),updatedAt}}/>;
}
