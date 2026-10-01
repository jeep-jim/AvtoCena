import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerProfileContent} from '../../apps/web/components/dealers/DealerProfileContent';
import {DealerMap} from '../../apps/web/components/dealers/DealerMap';
import {DealerEditor} from '../../apps/web/components/dealers/DealerEditor';
import {defaultShowcase} from '../../apps/web/lib/dealers/showcase-model';
const s=defaultShowcase('dealer_topavto');
s.offices=[{id:'address',city:'Новокузнецк',address:'ТРК Планета',lat:null,lon:null,hours:'',phone:'',photos:[]},{id:'point',city:'Москва',address:'Тестовый офис',lat:55.75,lon:37.61,hours:'',phone:'',photos:[]}];
s.banner='/dealers/topavto-banner-v2.webp';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1120,margin:'auto',padding:16}}>
<DealerProfileContent s={s}/>
<hr style={{margin:"24px 0"}}/>
<DealerEditor initial={s} features={{version:0,affiliatesEnabled:true}}/>
</main>);
