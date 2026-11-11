import {cache} from 'react';
import type {ShortShare} from '../catalog/short-share';
import {readShowcase} from './showcase-store';
import {availableShowcase} from './program-store';
import {dealerProfilePath} from './profile-url';
import {publicDealerProfile} from './public-profile';
import {socialImageUrl} from '../catalog/social-image';
export const readDealerSelection=cache(async(record:Extract<ShortShare,{version:2}>)=>{
 const stored=await readShowcase(record.dealerId);if(!stored)return null;
 const s=await availableShowcase(stored);if(!s.profileEnabled)return null;
 const p=publicDealerProfile(s),target=new URL(record.path,'https://avtocena.com');
 const city=target.searchParams.get('city');
 const description=[p.name,city?`Доставка: ${city}`:'', 'Выбранные параметры и актуальные автомобили — в каталоге компании.'].filter(Boolean).join('. ');
 const photo=p.banner||p.logoLight||p.logoDark;
 return {path:dealerProfilePath(s)+target.search+'#catalog',description,images:photo?[socialImageUrl(photo)]:[]};
});
