import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogCard} from '../../apps/web/components/catalog/CatalogCard';
import {CatalogSelectionProvider} from '../../apps/web/components/catalog/CatalogSelectionContext';

const params = new URLSearchParams(location.search);
const caseId = params.get('case') || 'manual';
const list = params.get('view') === 'list';
localStorage.setItem('ac-catalog-view', list ? 'list' : 'grid');
const photo = (kind: string) => `/api/catalog/photo/fixture-${caseId}-${kind}?${new URLSearchParams({
  url: `https://2sc2.autoimg.cn/escimg/auto/fixture-${kind}.jpg`, market: 'china',
})}`;
const baseOffer = {
  market: 'china', make: 'Hyundai', model: 'Elantra', year: 2023, trim: '1.5L CVT',
  mileageKm: 39_400, engineCc: 1497, powerHp: 115, fuel: 'petrol', transmission: 'automatic', drive: 'fwd',
  totalRub: 1_650_154, publicVisibleRub: 1_650_154, publicSpecificationVerified: true, cardProjectionVersion: 3,
  sourcePrice: 65_600, sourceCurrency: 'CNY', priceMode: 'fixed', calculationStatus: 'ready', status: 'active',
  offerType: 'fixed', images: [], preparedChinaSelection: {version: 1, generationId: 'gen_china_123_1', city: 'Новокузнецк'},
};

function Fixture() {
  const [shown, setShown] = useState(true), [replaced, setReplaced] = useState(false);
  const [ready, setReady] = useState(false);
  // Let the real provider restore desktop/list preference before images mount.
  useEffect(() => setReady(true), []);
  return <>
    <nav className="flex gap-4 p-3">
      <button type="button" onClick={() => setShown(false)}>Убрать проверяемую карточку</button>
      <button type="button" onClick={() => setReplaced(true)}>Сменить проверяемое фото</button>
    </nav>
    <CatalogSelectionProvider><main className={list ? 'p-3' : 'grid max-w-3xl grid-cols-2 gap-3 p-3'}>
      {ready && shown ? <div data-fixture="broken"><CatalogCard dense eagerPrefetch offer={{...baseOffer,
        id: '000000000000000000000001', cardImageUrl: photo(replaced ? 'replaced' : 'broken')}}/></div> : null}
      {ready ? <div data-fixture="healthy"><CatalogCard dense eagerPrefetch offer={{...baseOffer,
        id: '000000000000000000000002', cardImageUrl: photo('healthy')}}/></div> : null}
    </main></CatalogSelectionProvider>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
