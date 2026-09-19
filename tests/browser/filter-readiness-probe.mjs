import {chromium} from 'playwright';
const b=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:390,height:900}});
p.on('pageerror',e=>console.log('PAGE_ERROR',String(e)));
await p.goto('https://avtocena.com/cars?market=japan',{waitUntil:'domcontentloaded',timeout:90000});
await p.locator('[data-catalog-batch="1"] article').last().waitFor({timeout:60000});
const cookie=p.getByRole('complementary',{name:'Уведомление о cookie'});if(await cookie.isVisible())await cookie.getByRole('button',{name:'Закрыть',exact:true}).click();
const button=p.getByRole('button',{name:'Открыть фильтры',exact:true});
console.log('BEFORE',await button.evaluate(n=>{const r=n.getBoundingClientRect();return {html:n.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML}}));
await button.click();await p.waitForTimeout(1000);
console.log('AFTER_FIRST',p.url(),await p.locator('.ac-mobile-filter-sheet').count());
if(!await p.locator('.ac-mobile-filter-sheet').count()){await p.waitForTimeout(3000);await button.click();await p.waitForTimeout(1000);console.log('AFTER_SECOND',p.url(),await p.locator('.ac-mobile-filter-sheet').count());}
await b.close();
