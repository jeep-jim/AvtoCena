import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogEditorialEditor} from '../../apps/web/components/catalog/CatalogEditorialEditor';
createRoot(document.getElementById('root')!).render(<main className="relative h-96"><CatalogEditorialEditor offerId="fixture" originalTitle="Toyota Corolla Cross" sourcePrice={57800} sourceCurrency="CNY" sourcePhotos={['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="gray"/></svg>','data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="navy"/></svg>']} sourceSpecifications={{bodyType:'sedan',drive:'fwd'}}/></main>);
