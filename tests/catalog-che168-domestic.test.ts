import assert from 'node:assert/strict';
import test from 'node:test';
import { DomesticChe168Adapter } from '../apps/web/lib/catalog/che168-dealer-source';

test('domestic Che168 binds CNY price to its own listing and never requests Global or uploads images', async()=>{
 const oldFetch=globalThis.fetch;
 const requests:string[]=[];
 globalThis.fetch=async(input:any)=>{
  requests.push(String(input));
  assert.match(String(input),/^https:\/\/(?:dealers|www)\.che168\.com\//);
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
  assert.equal(offer.operational.photoIdentityVerified,true);
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
 try{const page=await new DomesticChe168Adapter().fetchPage('dealer:1');assert.equal(page.items.length,1);assert.equal(page.nextCursor,'dealer:3');assert.ok(urls.some(u=>u.includes('429115')));}
 finally{globalThis.fetch=previous;}
});

test('national list advances independently and accepts a dealer-price CSS class',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response('<li><a href="https://www.che168.com/dealer/123/59848501.html">奇瑞 Tiggo 2021 汽油 1498cc 147马力</a><span>6.57万公里</span><div class="car-price"><b>2.88</b>万</div></li>');
 try {const adapter=new DomesticChe168Adapter(),page=await adapter.fetchPage();assert.equal(page.nextCursor,'national:2');const o=adapter.normalizeOffer(page.items[0])!;assert.equal(o.sourcePrice,28800);assert.equal(o.engineCc,1498);assert.equal(o.powerHp,147);assert.equal((o.operational.semanticEvidence as any).fuel.status,'exact');}
 finally {globalThis.fetch=previous;}
});
test('national access denial does not fall back to another route',async()=>{
 const previous=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('access denied',{status:403});};
 try {const p=await new DomesticChe168Adapter().fetchPage();assert.equal(p.health?.blocked,true);assert.equal(p.nextCursor,null);assert.equal(requests,1);}
 finally {globalThis.fetch=previous;}
});
