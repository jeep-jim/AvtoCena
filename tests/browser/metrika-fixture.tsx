import React,{useState} from 'react';
import {ConsentCheckbox} from '../../apps/web/components/legal/ConsentCheckbox';
import {leadFetch} from '../../apps/web/lib/lead-submit-client';
import {createRoot} from 'react-dom/client';
import {ConsentMetrika} from '../../apps/web/components/analytics/ConsentMetrika';
import {YandexMetrikaRouteTracker} from '../../apps/web/components/analytics/YandexMetrikaRouteTracker';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
function Form(){const [consent,setConsent]=useState(false);return <form onSubmit={async e=>{e.preventDefault();await leadFetch('/api/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({personalDataConsent:consent,source:'model_calculation_request'})});}}><ConsentCheckbox checked={consent} onChange={setConsent}/><button>Отправить проверочную заявку</button></form>;}
createRoot(document.getElementById('root')!).render(<><ConsentMetrika/><main><h1>АвтоЦена</h1><p>Проверка статистики посещений</p><Form/></main><PublicLegalFooter/><YandexMetrikaRouteTracker/></>);
