import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
import {CatalogFooterStop} from '../../apps/web/components/layout/CatalogFooterStop';
createRoot(document.getElementById('root')!).render(<><main><div style={{height:2400}}>Автомобили</div><div style={{padding:16}}><CatalogLoadMore query={{market:"japan"}} initialPage={Number(new URLSearchParams(location.search).get("page"))||3} initialTotal={447} initialCount={24} initialCards={null}/></div></main><footer><CatalogFooterStop/><section id="footer-content" style={{height:1600,borderTop:'1px solid gray'}}>Информация о компании</section></footer></>);
