import React from 'react';
import {createRoot} from 'react-dom/client';
import {OfferSpecificationsDisclosure} from '../../apps/web/components/catalog/OfferSpecificationsDisclosure';
import {OfferUpdatedStatus} from '../../apps/web/components/catalog/OfferUpdatedStatus';

// Synthetic identity; this fixture never reads a catalog or supplier.
const props = {groups: [{name: 'Основные', items: [{name: 'Год', value: '2022'}]}], title: 'Автомобиль для проверки', historyOfferId: '0123456789abcdef01234567', historyLot: '42196907'};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth: 940, margin: 'auto', padding: 16}}>
  <OfferSpecificationsDisclosure {...props} mode="desktop" headerAside={<OfferUpdatedStatus date="13.11.2026" time="10:20"/>}/>
  <div className="xl:hidden"><OfferSpecificationsDisclosure {...props} mode="mobile"/></div>
</main>);
