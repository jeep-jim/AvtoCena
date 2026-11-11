import React from 'react';
import {createRoot} from 'react-dom/client';
import {CollectionControls} from '../../apps/web/components/site/CollectionControls';
createRoot(document.getElementById('root')!).render(<main><h1>Управление сайтом</h1><CollectionControls/></main>);
