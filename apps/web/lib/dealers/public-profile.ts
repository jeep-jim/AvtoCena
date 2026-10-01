import {dealerMarkets} from './catalog-markets';
import type {DealerShowcase, DealerOffice} from './showcase-model';
export type PublicDealerOffice = Omit<DealerOffice, 'phone'>;
export type PublicDealerProfile = Pick<DealerShowcase, 'headerIcon'|'catalogMarkets'|'dealerId'|'name'|'description'|'banner'|'logoLight'|'logoDark'|'profileEnabled'|'buyersEnabled'|'buyerPhotos'|'specialHeading'> & {offices:PublicDealerOffice[]};
// Only public presentation fields cross the server/client boundary. Private
// contacts, draft vehicles and the dealer's pricing settings stay on the server.
export function publicDealerProfile(s:DealerShowcase):PublicDealerProfile {
 return {headerIcon:s.headerIcon||'',catalogMarkets:dealerMarkets(s.catalogMarkets),dealerId:s.dealerId,name:publicDealerText(s.name),description:publicDealerText(s.description),banner:s.banner,logoLight:s.logoLight,logoDark:s.logoDark,profileEnabled:s.profileEnabled,buyersEnabled:s.buyersEnabled,buyerPhotos:s.buyersEnabled?s.buyerPhotos.map(p=>({...p,caption:publicDealerText(p.caption)})):[],specialHeading:publicDealerText(s.specialHeading),offices:s.offices.map(({phone:_,...o})=>({...o,city:publicDealerText(o.city),address:publicDealerText(o.address),hours:publicDealerText(o.hours),photos:o.photos.map(p=>({...p,caption:publicDealerText(p.caption)}))}))};
}
export function publicDealerText(text:string){return text.replace(/(?:https?:\/\/|www\.)\S+|@[a-zA-Z][\w.]{3,}|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'').replace(/(?:\+?7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g,'').trim();}
