import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConsentMetrika} from '../../apps/web/components/analytics/ConsentMetrika';
import {YandexMetrikaRouteTracker} from '../../apps/web/components/analytics/YandexMetrikaRouteTracker';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
createRoot(document.getElementById('root')!).render(<><ConsentMetrika/><main><h1>АвтоЦена</h1><p>Проверка статистики посещений</p></main><PublicLegalFooter/><YandexMetrikaRouteTracker/></>);
