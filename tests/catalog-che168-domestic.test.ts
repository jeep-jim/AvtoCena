import assert from 'node:assert/strict';
import test from 'node:test';
import { DomesticChe168Adapter } from '../apps/web/lib/catalog/che168-dealer-source';

test('domestic Che168 binds CNY price to its own listing and never requests Global or uploads images', async()=>{
 const oldFetch=globalThis.fetch;
 const requests:string[]=[];
 globalThis.fetch=async(input:any)=>{
  requests.push(String(input));
  assert.match(String(input),/^https:\/\/dealers\.che168\.com\//);
  return new Response(`<ul><li><a href="https://www.che168.com/dealer/123/59848501.html">奇瑞 Tiggo 2021 1.5L</a><span>6.57万公里 / 2021年</span><div class="price"><b>2.88</b>万</div><img src="https://img.autoimg.cn/one.jpg"></li><li><a href="https://global.che168.com/en/detail/59848502">丰田 2022</a><span>2万公里</span><div class="price">99万</div></li></ul>`,{headers:{'content-type':'text/html; charset=utf-8'}});
 };
 try {
  const adapter=new DomesticChe168Adapter();
  const page=await adapter.fetchPage();
  assert.equal(page.items.length,1);
  const offer=adapter.normalizeOffer(page.items[0])!;
  assert.equal(offer.sourceCurrency,'CNY');
  assert.equal(offer.sourcePrice,28800);
  assert.notEqual(offer.engineCc,1500);
  const images=await adapter.fetchImages(offer);
  assert.equal(images.length,1);
  assert.equal(images[0].objectKey,'');
  assert.equal(requests.length,1);
 } finally {globalThis.fetch=oldFetch;}
});

test('empty first dealer does not terminate remaining dealer inventory',async()=>{
 const previous=globalThis.fetch;
 const urls:string[]=[];
 globalThis.fetch=async(input:any)=>{
  const url=String(input);urls.push(url);
  const body=url.includes('429115')?'<li><a href="https://www.che168.com/dealer/123/59848501.html">奇瑞 Tiggo 2021</a><span>2021年</span><div class="price">2.88万</div></li>':'<ul></ul>';
  return new Response(body);
 };
 try{const page=await new DomesticChe168Adapter().fetchPage();assert.equal(page.items.length,1);assert.equal(page.nextCursor,'3');assert.ok(urls.some(u=>u.includes('429115')));}
 finally{globalThis.fetch=previous;}
});
