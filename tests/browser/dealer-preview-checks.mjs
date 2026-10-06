import assert from 'node:assert/strict';
export async function checkDealerPreview(page,width){
 const registration=page.getByRole('link',{name:'Регистрация',exact:true});
 assert.equal(await registration.getAttribute('href'),'/dealers#dealer-apply');
 assert.ok((await registration.boundingBox()).y>=(await page.locator('#staff-login button[type=submit],#staff-login button.account-primary').boundingBox()).y);
 const iframe=page.locator('.entrance-dealer-preview iframe'),preview=page.frameLocator('.entrance-dealer-preview iframe');
 await preview.locator('[data-dealer-market-chips]').first().waitFor();
 const dock=preview.locator('.dealer-dock');await dock.waitFor();
 const frameBox=await iframe.boundingBox(),welcome=await page.locator('.account-welcome').boundingBox();
 if(width<=760){assert.ok(frameBox.y>=welcome.y-1&&frameBox.y+frameBox.height<=welcome.y+welcome.height+1,'phone preview must fit its wrapper');assert.equal(await page.locator('.entrance-dealer-preview .dealer-live-preview').evaluate(n=>getComputedStyle(n).borderTopWidth),'0px');}
 else assert.equal(await page.locator('.entrance-dealer-preview .dealer-live-preview').evaluate(n=>getComputedStyle(n).borderTopWidth),'1px');
 for(const bottom of [false,true]){
  await preview.locator('body').evaluate((n,bottom)=>n.ownerDocument.defaultView.scrollTo({top:bottom?n.scrollHeight:0,behavior:'instant'}),bottom);
  assert.ok(await dock.evaluate(n=>{const r=n.getBoundingClientRect(),win=n.ownerDocument.defaultView;return Math.abs(r.bottom-win.innerHeight)<2;}),'dock pinned to preview bottom');
 }
 await iframe.evaluate(n=>window.scrollTo({top:n.getBoundingClientRect().bottom+scrollY-innerHeight+20,behavior:'instant'}));await page.waitForTimeout(120);
 const db=await dock.boundingBox();assert.ok(await iframe.evaluate((n,{x,y})=>document.elementFromPoint(x,y)===n,{x:db.x+db.width/2,y:db.y+db.height/2}),'outer page does not clip the dock');
 const chips=preview.locator('[data-dealer-market-chips]').first();assert.equal(await chips.locator(':scope > span').count(),6);
 const styles=await chips.locator(':scope > span').first().evaluate(n=>({background:getComputedStyle(n).backgroundColor,radius:getComputedStyle(n).borderRadius,height:n.getBoundingClientRect().height}));assert.equal(styles.radius,'999px');assert.ok(styles.height>=30);assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');
 await dock.getByRole('button',{name:'Адреса',exact:true}).click();
 const drawer=preview.getByRole('dialog',{name:'Адреса'});await drawer.waitFor();assert.equal(await drawer.locator('[data-dealer-market-chips] > span').count(),6);
 assert.deepEqual(await drawer.locator('[data-dealer-market-chips] > span').first().evaluate(n=>({background:getComputedStyle(n).backgroundColor,radius:getComputedStyle(n).borderRadius,height:n.getBoundingClientRect().height})),styles,'same chips in catalog and directions');
 await drawer.getByRole('button',{name:'Закрыть адреса',exact:true}).click();
}
