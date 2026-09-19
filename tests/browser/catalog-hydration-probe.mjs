import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
for(const width of [390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log('PAGE_ERROR',width,String(e));});
 // Diagnostic only: enrich React's text mismatch message in this browser response.
 await page.route('**/_next/static/chunks/*.js',async route=>{
  const response=await route.fetch();let body=await response.text();
  body=body.replace('function sq(e,t,n){if(t=sH(t),sH(e)!==t&&n)throw Error(i(425))}', 'function sq(e,t,n){if(t=sH(t),sH(e)!==t&&n)throw Error("HYDRATION_TEXT "+JSON.stringify({server:e,client:t}))}');
  await route.fulfill({response,body});
 });
 await page.goto('https://avtocena.com/cars',{waitUntil:'networkidle',timeout:90000});
 if(width<1024){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();console.log('MOBILE_SHEET',await page.locator('.ac-mobile-filter-sheet').count());}
 console.log('DIAG',JSON.stringify({width,errors}));await context.close();
}
await browser.close();
