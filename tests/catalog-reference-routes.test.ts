import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canonicalCatalogHref,catalogRouteParams,catalogSearchHeading,isCatalogSearchPath,CATALOG_COUNTRIES} from '../apps/web/lib/catalog/catalog-routes';
import {dealerBrowsingHref} from '../apps/web/lib/dealers/browsing-context';
import {offerPath,offerIdFromPath,offerRouteId} from '../apps/web/lib/catalog/offer-url';
import {cleanShareTarget} from '../apps/web/lib/catalog/short-share';
import {power30OfferId} from '../apps/web/lib/power30/calculator';
import {extractOfferId} from '../apps/web/lib/contracts/offer-url-input';
test('country routes preserve every filter, dealer, city, page and hash; no redirect loops',()=>{
 for(const [market,country] of Object.entries(CATALOG_COUNTRIES)){
  const href=canonicalCatalogHref(`/cars?market=${market}&powerTo=160&page=2&cursor=abc&city=Kemerovo&dealer=pilot&preview=1&tag=a&tag=b#results`);
  assert.equal(href,`/cars/${market}?powerTo=160&page=2&cursor=abc&city=Kemerovo&dealer=pilot&preview=1&tag=a&tag=b#results`);
  assert.equal(canonicalCatalogHref(href),href);
  assert.equal(catalogSearchHeading({market}),`Авто из ${country} под заказ`);
 }
 assert.equal(canonicalCatalogHref('/cars?market=china&make=Toyota&model=Corolla&page=2'),'/cars/china/Toyota/Corolla?page=2');
 assert.deepEqual(catalogRouteParams('/cars/china/Toyota/Corolla'),{market:'china',make:'Toyota',model:'Corolla'});
 for(const href of ['/cars?market=china|japan','/cars?market=unknown','/cars?market=china&market=korea','/cars/green?stock=green','/cars?market=japan&stock=green','/cars/offer/id/slug','/crm','//evil.example/cars','https://evil.example/cars'])assert.equal(canonicalCatalogHref(href),href);
 assert.equal(isCatalogSearchPath('/cars/china/Toyota'),true);assert.equal(isCatalogSearchPath('/cars/offer/id/slug'),false);
 assert.equal(catalogRouteParams('/cars/china/%2Fprivate'),null);
});
test('friendly catalog paths still stay in the server-authorized dealer workspace',()=>{
 const dealer:any={id:'pilot',href:'/novokuznetsk/pilot?preview=1',preview:true,markets:['china']};
 assert.equal(dealerBrowsingHref('/cars/china/Toyota/Corolla?powerTo=160&page=2',dealer,'Новокузнецк'),'/novokuznetsk/pilot?preview=1&powerTo=160&page=2&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA&market=china&make=Toyota&model=Corolla');
 assert.equal(dealerBrowsingHref('/cars?market=china&powerTo=160',null),'/cars/china?powerTo=160');
 assert.match(dealerBrowsingHref('/cars/offer/car/model-2024',dealer),/dealer=pilot&preview=1$/);
});
test('legacy and new offer URLs resolve to the same identity across sharing, contracts and power30',()=>{
 const offer={id:'ajes-korea-12345',make:'Hyundai',model:'Avante',year:2024};
 const clean=offerPath(offer),old='/cars/offer/hyundai-avante-2024--ajes-korea-12345';
 assert.equal(clean,'/cars/offer/ajes-korea-12345/hyundai-avante-2024');
 for(const path of [clean,old,'/cars/offer/ajes-korea-12345']){
  assert.equal(offerIdFromPath(path),offer.id);assert.equal(extractOfferId('https://avtocena.com'+path),offer.id);assert.equal(power30OfferId('https://avtocena.com'+path),offer.id);
  const share=cleanShareTarget(path+'?dealer=pilot&calculation=version-1',false);assert.ok(share.path.startsWith(path+'?'));
 }
 assert.equal(offerRouteId('old-name--id'),'id');
 assert.equal(offerPath({id:'special_owner_1',make:'Test'}),'/cars/offer/special_owner_1');
 for(const path of ['/cars/offer/id/../../crm','/cars/offer/id/slug/extra','/cars/offer/%2Fsecret/slug'])assert.equal(offerIdFromPath(path),'');
 for(const path of ['/cars/offer/id/slug/extra','//evil.example/cars/offer/id/slug','/cars/offer/id/%2Fsecret'])assert.throws(()=>cleanShareTarget(path,false));
});
test('Onest is self-hosted, only public typography changes, and hidden fallback adds no second H1',()=>{
 const layout=fs.readFileSync('apps/web/app/(public)/layout.tsx','utf8');
 assert.match(layout,/@fontsource-variable\/onest\/wght.css/);
 assert.doesNotMatch(layout,/fonts.googleapis.com|fonts.gstatic.com/);
 const css=fs.readFileSync('apps/web/app/public-typography.css','utf8');assert.match(css,/data-public-typography/);assert.match(css,/font-weight:700!important/);
 const access=fs.readFileSync('apps/web/components/site/SitePageAccess.tsx','utf8');assert.doesNotMatch(access,/<h1[ >]/);assert.match(access,/data-site-disabled/);
});

test('contract URLs reject external hosts, credentials, unsafe identifiers and extra segments',()=>{
 for(const value of ['https://evil.example/cars/offer/id/slug','https://avtocena.com:444/cars/offer/id/slug','https://user:pass@avtocena.com/cars/offer/id/slug','https://avtocena.com/cars/offer/%2Fprivate/slug','https://avtocena.com/cars/offer/id/slug/extra'])assert.throws(()=>extractOfferId(value));
 const mini=fs.readFileSync('apps/web/components/telegram/TelegramMiniApp.tsx','utf8');
 assert.match(mini,/isCatalogSearchPath\(pathname\)/);
});
