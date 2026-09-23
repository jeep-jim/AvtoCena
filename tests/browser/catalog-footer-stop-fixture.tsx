import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFooterStop} from '../../apps/web/components/layout/CatalogFooterStop';
createRoot(document.getElementById('root')!).render(<><main><div style={{height:2400}}>Автомобили</div><nav style={{height:160}}>Страницы 1 2 3 <button>Показать ещё</button></nav></main><footer><CatalogFooterStop/><section id="footer-content" style={{height:1600,borderTop:'1px solid gray'}}>Информация о компании</section></footer></>);
