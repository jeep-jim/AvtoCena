import React from 'react';
import {createRoot} from 'react-dom/client';
import {AutoCalcPage} from '../../apps/web/components/autocalc/AutoCalcPage';
import {AutoCalcButton} from '../../apps/web/components/autocalc/AutoCalcButton';
createRoot(document.getElementById('root')!).render(<><AutoCalcPage initialUrl=""/><footer className="p-6"><AutoCalcButton/></footer></>);
