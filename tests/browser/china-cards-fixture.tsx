import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogCard} from '../../apps/web/components/catalog/CatalogCard';
const rows=[{id:'two',trim:'2026款 1.6L 舒适型 2座厢车'},{id:'five',trim:'2026款 1.6L 舒适型 5座厢车'}];
createRoot(document.getElementById('root')!).render(<main className="grid grid-cols-2 gap-3 p-3 md:grid-cols-4">{rows.map(o=><CatalogCard key={o.id} offer={{market:'china',catalogEntryKind:'model_variant',make:'Changan',model:'V5',year:2026,mileageKm:0,engineCc:1597,powerHp:123,fuel:'petrol',transmission:'manual',drive:'rwd',totalRub:1483000,sourcePrice:55800,sourceCurrency:'CNY',catalogPricingMode:'calculated',calculationStatus:'ready',status:'active',offerType:'fixed',images:[],...o}}/>)}</main>);
