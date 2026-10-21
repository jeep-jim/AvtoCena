import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPageUrl,isPublicPagePath} from '../apps/web/lib/public-page-url';
test('page QR retains the exact public location and saved calculation',()=>{
 assert.equal(publicPageUrl('https://avtocena.com/cars?market=uae&priceMax=2000000#results'),'https://avtocena.com/cars?market=uae&priceMax=2000000#results');
 assert.equal(publicPageUrl('https://avtocena.com/cars/china/cadillac-ct4-2024-abc','v2'),'https://avtocena.com/cars/china/cadillac-ct4-2024-abc?calculation=v2');
 assert.equal(publicPageUrl('https://avtocena.com/'),'https://avtocena.com/');
});
test('internal pages cannot be encoded by the page QR',()=>{
 for(const route of ['/admin','/admin/settings','/crm','/crm/clients/123','/login','/api/catalog','/auth/reset','/internal']){
  assert.equal(isPublicPagePath(route),false);assert.equal(publicPageUrl('https://avtocena.com'+route),null);
 }
 assert.equal(publicPageUrl('javascript:alert(1)'),null);
});
