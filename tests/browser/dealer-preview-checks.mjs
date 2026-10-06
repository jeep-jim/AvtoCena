import assert from 'node:assert/strict';
export async function checkDealerPreview(page,width){
 const registration=page.getByRole('link',{name:'Регистрация',exact:true});
 assert.equal(await registration.getAttribute('href'),'/dealers#dealer-apply');
 assert.ok((await registration.boundingBox()).y>=(await page.locator('#staff-login button[type=submit],#staff-login button.account-primary').boundingBox()).y);
 const iframe=page.locator('.entrance-dealer-preview iframe');
 const preview=width<=760?page.locator('.dealer-inline-preview'):page.frameLocator('.entrance-dealer-preview iframe');
 await preview.locator('[data-dealer-market-chips]').first().waitFor();
 const dock=preview.locator('.dealer-dock');await dock.waitFor();
 if(width<=760){
  assert.equal(await iframe.count(),0,'phone uses native page scrolling');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const bounds=await preview.boundingBox();
  for(const y of [0,bounds.y,Math.max(0,bounds.y+bounds.height-900)]){
   await page.evaluate(y=>scrollTo({top:y,behavior:'instant'}),y);await page.waitForTimeout(120);
   assert.ok(await dock.evaluate(n=>Math.abs(n.getBoundingClientRect().bottom-innerHeight)<2),'dock visible at viewport bottom throughout the preview');
   assert.ok(await dock.evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'dock is clickable');
  }
  await page.locator('#staff-login').scrollIntoViewIfNeeded();
  assert.ok((await dock.boundingBox()).y<500,'dock leaves with the profile before login');
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
 }else{
  const frameBox=await iframe.boundingBox();assert.ok(frameBox.height>0);
  assert.equal(await page.locator('.entrance-dealer-preview .dealer-live-preview').evaluate(n=>getComputedStyle(n).borderTopWidth),'1px');
  for(const bottom of [false,true]){
   await preview.locator('body').evaluate((n,bottom)=>n.ownerDocument.defaultView.scrollTo({top:bottom?n.scrollHeight:0,behavior:'instant'}),bottom);
   assert.ok(await dock.evaluate(n=>Math.abs(n.getBoundingClientRect().bottom-n.ownerDocument.defaultView.innerHeight)<2),'dock pinned to preview bottom');
  }
  await iframe.evaluate(n=>window.scrollTo({top:n.getBoundingClientRect().bottom+scrollY-innerHeight+20,behavior:'instant'}));await page.waitForTimeout(120);
  const db=await dock.boundingBox();assert.ok(await iframe.evaluate((n,{x,y})=>document.elementFromPoint(x,y)===n,{x:db.x+db.width/2,y:db.y+db.height/2}),'outer page does not clip the dock');
 }

 const chips=preview.locator('[data-dealer-market-chips]').first();assert.equal(await chips.locator(':scope > span').count(),6);
 const styles=await chips.locator(':scope > span').first().evaluate(n=>({background:getComputedStyle(n).backgroundColor,radius:getComputedStyle(n).borderRadius,height:n.getBoundingClientRect().height}));assert.equal(styles.radius,'999px');assert.ok(styles.height>=30);assert.notEqual(styles.background,'rgba(0, 0, 0, 0)');
 await dock.getByRole('button',{name:'Адреса',exact:true}).click();
 const drawer=(width<=760?page:preview).getByRole('dialog',{name:'Адреса'});await drawer.waitFor();assert.equal(await drawer.locator('[data-dealer-market-chips] > span').count(),6);
 assert.equal(await drawer.locator('[data-dealer-market-chips] > span').first().getAttribute('class'),await chips.locator(':scope > span').first().getAttribute('class'),'same chip component in catalog and directions');
 await drawer.getByRole('button',{name:'Закрыть адреса',exact:true}).click();
}
