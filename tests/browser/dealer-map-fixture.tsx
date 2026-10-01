import React from 'react';
import {publicDealerProfile} from '../../apps/web/lib/dealers/public-profile';
import {createRoot} from 'react-dom/client';
import {DealerProfileContent} from '../../apps/web/components/dealers/DealerProfileContent';
import {DealerMap} from '../../apps/web/components/dealers/DealerMap';
import {DealerEditor} from '../../apps/web/components/dealers/DealerEditor';
import {defaultShowcase} from '../../apps/web/lib/dealers/showcase-model';
const s=defaultShowcase('dealer_topavto');
s.offices=[{id:'address',city:'Новокузнецк',address:'ТРК Планета',lat:null,lon:null,hours:'Ежедневно, 10:00–22:00',phone:'',photos:[]},{id:'point',city:'Москва',address:'Тестовый офис',lat:55.75,lon:37.61,hours:'Ежедневно, 10:00–22:00',phone:'',photos:[]}];
s.banner='/dealers/topavto-banner-v3.webp';
s.description='Подбираем и доставляем автомобили из Японии, Китая и Кореи. Поможем найти ваш автомобиль и рассчитать доставку.';
s.catalogMarkets=['japan','korea'];s.phone='+79991234567';s.telegram='https://t.me/private';
createRoot(document.getElementById('root')!).render(<main>
<DealerProfileContent s={publicDealerProfile(s)} items={new URLSearchParams(location.search).has('offers')?[{id:'rav4',href:'/cars/offer/test-rav4',image:s.banner,title:'Toyota RAV4 Adventure 2.0',price:3490000,city:'Новосибирск',daysFrom:5,daysTo:7},{id:'kia',href:'/cars/offer/test-kia',image:s.banner,title:'Kia Sportage X-Line',price:3150000,city:'Москва',daysFrom:7,daysTo:10},{id:'mazda',href:'/cars/offer/test-mazda',image:s.banner,title:'Mazda CX-30',price:2600000,city:'Новосибирск',daysFrom:5,daysTo:7}]:[]}/>
<hr style={{margin:"24px 0"}}/>
<div style={{maxWidth:1440,margin:"auto",padding:16}}><DealerEditor initial={s} features={{version:0,affiliatesEnabled:true}} platformOwner/></div>
</main>);
