import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilterUiEnhancer} from '../../apps/web/components/catalog/CatalogFilterUiEnhancer';
import {IntentPrefetchLink} from '../../apps/web/components/catalog/IntentPrefetchLink';
createRoot(document.getElementById('root')!).render(<>
  <main className="ac-catalog-page">
    <div className="ac-catalog-filter-panel">
      {['Год','Цена','Пробег','Объём двигателя'].map(title => <div className="ac-range-card" key={title} data-year-min="2008">
        <div><div><div>{title}</div></div></div>
        {['от','до'].map(side => <div className="ac-range-input-box" key={side}><input aria-label={`${title}: ${side}`}/></div>)}
      </div>)}
    </div>
    {Array.from({length:24},(_,i) => <div key={i} style={{height:300,padding:10}}><IntentPrefetchLink href={`/cars/offer-${i}`} className="card">Автомобиль {i}</IntentPrefetchLink></div>)}
  </main>
  <CatalogFilterUiEnhancer/>
</>);
