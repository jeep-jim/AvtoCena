import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerMap} from '../../apps/web/components/dealers/DealerMap';
import {DealerEditor} from '../../apps/web/components/dealers/DealerEditor';
import {defaultShowcase} from '../../apps/web/lib/dealers/showcase-model';
const s=defaultShowcase('dealer_topavto');
s.offices=[{id:'address',city:'Новокузнецк',address:'ТРК Планета',lat:null,lon:null,hours:'',phone:'',photos:[]},{id:'point',city:'Москва',address:'Тестовый офис',lat:55.75,lon:37.61,hours:'',phone:'',photos:[]}];
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1120,margin:'auto',padding:16}}>
<img src="/dealers/topavto-banner-1800x600.webp" alt="Баннер TopAvto" style={{width:'100%',aspectRatio:'3/1',objectFit:'cover',borderRadius:20}} />
<DealerMap offices={s.offices}/>
<DealerEditor initial={s} features={{version:0,affiliatesEnabled:true}}/>
</main>);
