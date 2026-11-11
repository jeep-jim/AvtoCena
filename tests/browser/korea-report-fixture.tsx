import React from 'react';
import {createRoot} from 'react-dom/client';
import {OfferSpecificationsDisclosure} from '../../apps/web/components/catalog/OfferSpecificationsDisclosure';
import {OfferUpdatedStatus} from '../../apps/web/components/catalog/OfferUpdatedStatus';
const props={groups:[{name:'Основные',items:[{name:'Год',value:'2023'}]}],title:'Kia K5',historyOfferId:'ajes-korea-fixture',historyLot:'43015054'};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:940,margin:'auto',padding:16}}><OfferSpecificationsDisclosure {...props} mode="desktop" headerAside={<OfferUpdatedStatus date="27.10.2026" time="10:30"/>}/><div className="xl:hidden"><OfferSpecificationsDisclosure {...props} mode="mobile"/></div></main>);
