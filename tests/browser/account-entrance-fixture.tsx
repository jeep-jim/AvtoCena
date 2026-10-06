import '../../apps/web/app/public-regression-fixes.css';
import {CustomerPortal} from '../../apps/web/components/account/CustomerPortal';
import {PublicHeader} from '../../apps/web/components/layout/PublicHeader';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AccountEntrance} from '../../apps/web/components/account/AccountEntrance';
import {SiteControls} from '../../apps/web/components/site/SiteControls';
import {publicDealerProfile} from '../../apps/web/lib/dealers/public-profile';
import {defaultShowcase} from '../../apps/web/lib/dealers/showcase-model';
import {ACCOUNT_ROLES} from '../../apps/web/lib/account-appearance';
const appearance = Object.fromEntries(ACCOUNT_ROLES.map((role, i) => [role.id, {banner: '/api/site-media/' + String(i + 1).repeat(64), icon: '/api/site-media/' + String(i + 5).repeat(64)}]));
const account=(window as Window & {__CUSTOMER_ACCOUNT__?:any}).__CUSTOMER_ACCOUNT__ || {id:'test',name:'Тестовый покупатель',phone:'+79990000000',telegramConnected:true,avatarUrl:'/avatars/customers/character-1.svg',avatarId:'character-1'};
createRoot(document.getElementById('root')!).render(location.pathname==='/account'?<main className="account-cabinet-page min-h-screen"><PublicHeader backHref="/"/><div className="account-cabinet-content"><CustomerPortal account={account}/></div></main>:location.pathname === '/crm/site'
  ? <SiteControls initial={{version: 0, affiliatesEnabled: true}}/>
  : <main className="ac-page-copy ac-login-page">{location.search.includes("header")&&<PublicHeader backHref="/"/>}<AccountEntrance topDealer={{profile:publicDealerProfile(defaultShowcase('dealer_topavto','Top Avto')),items:[]}} appearance={(window as any).__ACCOUNT_APPEARANCE__|| (location.search.includes('media')?{customer:{banner:'',icon:'',colorLight:'#bddaf7',colorDark:'#294b70',media:[{url:'/api/site-media/'+ 'a'.repeat(64),type:'image',caption:'Автомобиль перед отправкой'},{url:'/api/site-media/'+ 'b'.repeat(64)+'.mp4',type:'video',caption:'Погрузка автомобиля'}]}}:location.search.includes('scenes')?{}:appearance)} nextPath="/account" errorCode="" initialRole={new URLSearchParams(location.search).get('role') || 'customer'}/></main>);
