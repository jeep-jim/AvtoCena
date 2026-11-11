import React from 'react';
import {createRoot} from 'react-dom/client';
import {CurrencyChartEnhancer} from '../../apps/web/components/layout/CurrencyChartEnhancer';
import {PublicUiEnhancer} from '../../apps/web/components/layout/PublicUiEnhancer';

const root=createRoot(document.getElementById('root')!);
root.render(<><CurrencyChartEnhancer/><PublicUiEnhancer/></>);
(window as any).__currencyFixture={unmount:()=>root.unmount()};
