import test from 'node:test';
import assert from 'node:assert/strict';
import { yandexOfficeUrls } from '../apps/web/lib/dealers/yandex-map';
import { mediaUrl, type DealerOffice } from '../apps/web/lib/dealers/showcase-model';
const office:DealerOffice = { id:'a',city:'Новокузнецк',address:'ТРК Планета',lat:null,lon:null,phone:'',hours:'',photos:[] };
test('Yandex widget supports an address without geocoding and safely encodes input',()=>{
  const urls=yandexOfficeUrls({...office,address:'ул. Тестовая, 1 & ll=evil'});
  const u=new URL(urls.widget);
  assert.equal(u.origin,'https://yandex.ru');
  assert.equal(u.pathname,'/map-widget/v1/');
  assert.equal(u.searchParams.get('text'),'Новокузнецк, ул. Тестовая, 1 & ll=evil');
  assert.equal(u.searchParams.get('ll'),null);
});
test('saved coordinates retain correct Yandex longitude/latitude order and red pin',()=>{
  const u=new URL(yandexOfficeUrls({...office,lat:53.75,lon:87.13}).widget);
  assert.equal(u.searchParams.get('ll'),'87.13,53.75');
  assert.equal(u.searchParams.get('pt'),'87.13,53.75,pm2rdm');
  assert.equal(u.searchParams.get('text'),null);
  assert.equal(new URL(yandexOfficeUrls({...office,lat:NaN,lon:87}).widget).searchParams.get('text'),'Новокузнецк, ТРК Планета');
});
test('built-in TopAvto banner is accepted only for the pilot dealer',()=>{
 assert.equal(mediaUrl('/dealers/topavto-banner-1800x600.webp','dealer_topavto'),'/dealers/topavto-banner-1800x600.webp');
 assert.throws(()=>mediaUrl('/dealers/topavto-banner-1800x600.webp','another'));
 assert.equal(mediaUrl('/dealers/topavto-banner-v3.webp','dealer_topavto'),'/dealers/topavto-banner-v3.webp');
 assert.throws(()=>mediaUrl('/dealers/topavto-banner-v3.webp','another'));
 assert.throws(()=>mediaUrl('/dealers/unknown.webp','dealer_topavto'));
});
