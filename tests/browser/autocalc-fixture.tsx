import React from 'react';
import {createRoot} from 'react-dom/client';
import {AutoCalcPage} from '../../apps/web/components/autocalc/AutoCalcPage';
import {StaffPermissions} from '../../apps/web/components/crm/StaffPermissions';
import {AutoCalcButton} from '../../apps/web/components/autocalc/AutoCalcButton';
createRoot(document.getElementById('root')!).render(window.location.search.includes('permissions')?<main className="crm-root crm-workspace p-6"><StaffPermissions role="manager"/><StaffPermissions role="owner"/></main>:<><AutoCalcPage initialUrl=""/><footer className="p-6"><AutoCalcButton/></footer></>);
