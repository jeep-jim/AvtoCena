import React from 'react';
import {createRoot} from 'react-dom/client';
import {ShareLinkButton} from '../../apps/web/components/catalog/ShareLinkButton';
createRoot(document.getElementById('root')!).render(<main data-offer-id="car" data-offer-share-name="Chevrolet Trax Turbo 1.2" data-offer-share-year="2024" data-offer-share-engine-cc="1199" data-offer-saved-version="11111111-1111-1111-1111-111111111111">
 <div className="ac-inline-parameters" data-share-year="2023" data-share-engine-cc="1496" data-share-fuel="petrol"><div className="ac-offer-price-panel"><span className="ac-price">1 800 000 ₽</span></div></div>
 <ShareLinkButton/>
</main>);
