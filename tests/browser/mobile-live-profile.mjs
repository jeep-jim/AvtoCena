import fs from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const out='artifacts/mobile-profile';fs.mkdirSync(out,{recursive:true});
const results=[];
try{
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await context.addInitScript(()=>{
 window.__probe={active:false,queries:0,rects:0,scrollTasks:[],longTasks:[],lcp:[],touchListeners:[]};
 const p=window.__probe,query=Document.prototype.querySelectorAll,rect=Element.prototype.getBoundingClientRect,add=EventTarget.prototype.addEventListener;
 Document.prototype.querySelectorAll=function(selector){if(p.active&&String(selector).includes('ac-'))p.queries++;return query.call(this,selector)};
 Element.prototype.getBoundingClientRect=function(){if(p.active)p.rects++;return rect.call(this)};
 EventTarget.prototype.addEventListener=function(type,fn,opts){if(type==='touchmove')p.touchListeners.push({target:this===document?'document':this===window?'window':'element',passive:opts?.passive===true});return add.call(this,type,fn,opts)};
 new PerformanceObserver(list=>p.longTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask',buffered:true});
 new PerformanceObserver(list=>p.lcp.push(...list.getEntries().map(x=>({t:x.startTime,size:x.size,url:x.url})))).observe({type:'largest-contentful-paint',buffered:true});
});
const page=await context.newPage();
const client=await context.newCDPSession(page);
await client.send('Performance.enable');
const health=await context.request.get('https://avtocena.com/api/health',{timeout:15000});
fs.writeFileSync(`${out}/health.json`,await health.text());
for(const path of ['/cars','/cars/korea']){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const begin=Date.now();let navigationError=null;try{await page.goto('https://avtocena.com'+path,{waitUntil:'load',timeout:45000})}catch(e){navigationError=e.message.slice(0,150)}
 await page.waitForTimeout(1500);
 const before=await page.evaluate(()=>({nav:performance.getEntriesByType('navigation')[0]?.toJSON(),paint:performance.getEntriesByType('paint').map(x=>x.toJSON()),lcp:window.__probe.lcp,longTasks:window.__probe.longTasks,dom:document.querySelectorAll('*').length,cards:document.querySelectorAll('.ac-catalog-card').length,images:[...document.images].length,js:performance.getEntriesByType('resource').filter(x=>x.initiatorType==='script').reduce((o,x)=>({count:o.count+1,decoded:o.decoded+x.decodedBodySize,transfer:o.transfer+x.transferSize}),{count:0,decoded:0,transfer:0}),touchListeners:window.__probe.touchListeners}));
 await page.screenshot({path:`${out}/${path.replaceAll('/','_')}.png`});
 await page.evaluate(()=>{window.__probe.active=true;window.__probe.longTasks=[]});
 for(let n=0;n<4;n++){
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:340,y:730}]});
 for(const y of [670,600,530,440,330,210]){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:340,y}]});await page.waitForTimeout(20)}
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(650);
 }
 const metrics=await client.send('Performance.getMetrics');
 const scroll=await page.evaluate(()=>{window.__probe.active=false;return {queries:window.__probe.queries,rects:window.__probe.rects,scrollTasks:window.__probe.scrollTasks,longTasks:window.__probe.longTasks,y:scrollY}});
 results.push({path,observedAt:new Date().toISOString(),elapsed:Date.now()-begin,navigationError,before,scroll,metrics,errors});console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(`${out}/baseline.json`,JSON.stringify(results,null,2));
}finally{await browser.close()}
