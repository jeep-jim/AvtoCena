import React from 'react';
import {createRoot} from 'react-dom/client';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {TelegramMiniApp} from '../../apps/web/components/telegram/TelegramMiniApp';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
import '../../apps/web/components/telegram/telegram-miniapp.css';
function App(){const path=usePathname();return <><header className="ac-public-header">Полная навигация сайта</header><main className="ac-page-copy mx-auto max-w-5xl p-4"><h1>{path.includes('/offer/')?'Карточка автомобиля':'Автомобили под ваш бюджет'}</h1>{path==='/mini'||path==='/cars'?<><CatalogFilters initial={Object.fromEntries(new URLSearchParams(location.search))}/><Link href="/cars/offer/qa-mini">Toyota — открыть карточку</Link></>:<p>Карточка и расчёт используют общие компоненты сайта.</p>}<a href="https://example.com/">Внешняя ссылка</a><a href="https://t.me/avtocena_bot">Телеграм</a></main><TelegramMiniApp/><PublicLegalFooter/></>}
createRoot(document.getElementById('root')!).render(<App/>);
