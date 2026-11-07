import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire('/tmp/catalog-browser/package.json')('playwright');
await fs.mkdir('followup-output',{recursive:true});
const results=[],routes=[['catalog','https://avtocena.com/cars'],['china','https://avtocena.com/cars?market=china'],['korea160','https://avtocena.com/cars?market=korea&powerTo=160'],['japan160','https://avtocena.com/cars?market=japan&powerTo=160']];
const browser=await chromium.launch({headless:true});
try{
 for(const [name,url] of routes){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,400)));
  await page.addInitScript(()=>{window.__lcp=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp.push(e.startTime);}).observe({type:'largest-contentful-paint',buffered:true});});
  let result={name,url};const start=performance.now();
  try{
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
   result.status=response?.status();result.domMs=Math.round(performance.now()-start);
   await page.waitForTimeout(5000);
   Object.assign(result,await page.evaluate(()=>{
    const nav=performance.getEntriesByType('navigation')[0],text=document.body.innerText;
    return {protocol:nav?.nextHopProtocol,ttfbMs:Math.round(nav?.responseStart-nav?.requestStart),h1:[...document.querySelectorAll('h1')].map(x=>x.textContent),visibleH1:[...document.querySelectorAll('h1')].filter(x=>x.getBoundingClientRect().height>0).map(x=>x.textContent),lcpMs:Math.round(window.__lcp?.at(-1)||0),requests:performance.getEntriesByType('resource').length,errorBoundary:text.includes('Не удалось загрузить эту страницу'),incomplete:text.includes('Количество уточняется')||text.includes('Часть предложений')||text.includes('Найти ещё'),cardLinks:new Set([...document.querySelectorAll('a[href*="/cars/offer/"]')].map(x=>x.getAttribute('href')?.split('?')[0])).size,text:text.slice(0,4000)};
   }));
   await page.screenshot({path:`followup-output/${name}.png`});
  }catch(error){result.error=String(error);}
  result.errors=errors;results.push(result);console.log('PUBLIC_READBACK',JSON.stringify(result));await context.close();
 }
}finally{await browser.close();}
const report={checkedAt:new Date().toISOString(),runId:process.env.GITHUB_RUN_ID,method:'one anonymous Chromium sample per route, 1440x1000, GitHub Ubuntu24 runner; no VPN comparison',results};
await fs.writeFile('followup-output/report.json',JSON.stringify(report,null,2));
const rows=results.map(r=>`| ${r.name} | ${r.status??'нет ответа'} | ${r.protocol??'не измерен'} | ${r.domMs??'—'} | ${r.lcpMs??'—'} | ${r.requests??'—'} | ${r.cardLinks??'—'} | ${r.errorBoundary??'не проверено'} |`).join('\n');
const note=`## 07.11.2026 — ZMA: измеренный разбор и установленный HTTP/2

Приоритет владельца от 07.11 сохраняется: до приёмки каталога, скорости, типографики и SEO несвязанные новые функции не продолжать. Успешная сборка и health не являются приёмкой маршрутов.

### Исходный сравнительный аудит

Run 42333928729, artifact 13558033932: анонимный Chromium 1440×1000, один runner; это ограниченные наблюдения, не VPN-тест и не нагрузочная статистика. ZMA использует Nuxt, HTTP/2, локальный Onest Variable и WebP-обложки, cache-control s-maxage=120 на странице Китая и 300 на карточке. Частный backend/БД неизвестен. Hover-prefetch в замере НЕ обнаружен. ZMA: body 16/400/24, H1 48/700/60, карточка16/600/22. Китай: 53 запроса, DOM2665мс, LCP2764мс, HTML145366байт. Карточка: DOM1471мс,LCP1760мс.

АвтоЦена до изменения: HTTP/1.1, Arial, H1 около50px/900; /cars 110запросов, DOM7146мс,LCP7240мс, HTML972866байт до gzip. Китай DOM1627мс. Корея<=160 DOM7297мс, ни одной карточки в начальной неполной выдаче; Япония<=160 один сохранённый Step Wagon, выдача неполная. Ошибка /cars из скриншота в одном анонимном прогоне не воспроизведена — не объявлена исправленной. Код содержал общий H1 при выбранном рынке и второй скрытый H1 fallback.

Read-only production-срез 42333433652: visitor_restricted811, detail_cache_queue_timeout719, local_busy350; OOM и перезапусков не было. Точная причина конкретного скриншота пока не установлена. Запрещено обходить отказ поставщика подменой посетителя или считать сырой PW подтверждённой мощностью.

### Установлено

PR1713 объединён как 3f5e6716705b1695ecff6f720cb0b0c5fb7c6f09 после CI42336956350 и тестов преобразования nginx42336937904. Применение из main42337561703 успешно: nginx1.28.3, nginx-t до/после, ALPN h2, внешний HTTP/2 200. До/после неизменны releaseSha98324b3f26e7aa2120df2f3690ee8b17bf564bf4 и calculationVersion5dad731a202ea33dfc83ad4f26f2893eb4a2d61fbf67e4a08a162e5827eac573. Приложение не заменялось, данные/источники/расчёты/права/кеширование HTML не менялись.

### Повторный браузерный срез

Run ${report.runId}, ${report.checkedAt}. Один свежий анонимный контекст на маршрут, те же размеры и версия браузера, другой runner. DOM — готовность DOM, не время полной интерактивности; LCP — последнее событие в окне5секунд. Из разницы одиночных замеров нельзя приписывать весь эффект HTTP/2.

| Маршрут | HTTP | Протокол | DOM,мс | LCP,мс | Запросы | Уникальные ссылки карточек | Общая ошибка |
|---|---:|---|---:|---:|---:|---:|---|
${rows}

### Код, ещё не установленный

Ветка fix/catalog-reference-20261107: Onest из лицензированного npm-пакета, country H1/title, канонические /cars/{market} и /cars/offer/{stable-id}/{slug}, 308 со старых ссылок с сохранением города/дилера/фильтров/расчёта; изоляция отказа отдельного локального рынка. Run42337250523: все2804регрессии и typecheck прошли, build остановлен на неверном subset-import variable-шрифта. Импорт исправлен на документированный wght.css; новый полный прогон обязателен. Изменения интерфейса не публиковались этой записью.

### Остаётся открытым

Полная выдача<=160Корея/Япония и точные счётчики, причина периодического падения /cars, ограничение дорогих цепочек данных, лишний объём HTML и повторяющиеся блоки, браузерная/mobile/light-dark приёмка новых ссылок и Onest, согласованность sitemap/redirects/canonical. HTTP/2 само по себе эти проблемы не решает. Сохранять HTTP/2 при будущей переустановке nginx-конфигурации; постоянный контроль шаблона активации ещё требует проверки. VPN/безVPN не измерено. Не заявлять завершение всей задачи.
`;
await fs.writeFile('followup-output/roadmap-entry.md',note);
