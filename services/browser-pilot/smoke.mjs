import {chromium} from 'playwright';
import {replayPointer} from './controls.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({chromiumSandbox:true,timeout:15000});
try{
 const page=await browser.newPage({viewport:{width:420,height:640}});
 await page.setContent('<input id="field" style="position:absolute;left:10px;top:10px;width:200px;height:40px"><button id="btn" style="position:absolute;left:10px;top:80px;width:100px;height:40px" onclick="this.textContent=\'clicked\'">Press</button>');
 await replayPointer(page,[{x:50,y:30}]);
 await page.locator('input:focus').fill('Honda Fit');
 assert.equal(await page.locator('#field').inputValue(),'Honda Fit');
 await replayPointer(page,[{x:50,y:100}]);
 assert.equal(await page.locator('#btn').innerText(),'clicked');
 console.log('Sandbox browser: user pointer and focused input passed on local fixture; no external requests.');
}finally{await browser.close();}
