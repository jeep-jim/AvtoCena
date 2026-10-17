import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogEditorialEditor} from '../../apps/web/components/catalog/CatalogEditorialEditor';
createRoot(document.getElementById('root')!).render(<main className="relative h-96"><CatalogEditorialEditor offerId="fixture" originalTitle="Toyota Corolla Cross" sourceSpecifications={{bodyType:'sedan',drive:'fwd'}}/></main>);
