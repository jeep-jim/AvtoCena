import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {GET} from '../apps/web/app/(public)/feeds/yandex-auto/[file]/route';

test('large published XML redirects without loading bytes; stale and missing feeds fail closed', async()=>{
  const entry={path:'catalog/advertising/yandex/a/all.xml',count:27530,bytes:80_000_000,sha256:'verified-by-publisher'};
  const meta={generatedAt:new Date().toISOString(),files:{'all.xml':entry}};
  let exists=true;
  const mocks=[
    mock.method(LocalJsonStorage.prototype,'readJson',async()=>meta),
    mock.method(LocalJsonStorage.prototype,'binaryExists',async()=>exists),
    mock.method(LocalJsonStorage.prototype,'getBinary',async()=>{throw Error('web must not load XML');}),
    mock.method(LocalJsonStorage.prototype,'createBinaryDownloadUrl',async(path,ttl)=>{
      assert.equal(path,entry.path);assert.equal(ttl,900);return 'https://storage.example/feed.xml';
    }),
    mock.method(console,'error',()=>{}),
  ];
  const request=()=>GET(new Request('https://avtocena.com/feeds/yandex-auto/all.xml'),{params:Promise.resolve({file:'all.xml'})});
  try{
    const res=await request();
    assert.equal(res.status,307);assert.equal(await res.text(),'');
    assert.equal(res.headers.get('location'),'https://storage.example/feed.xml');
    assert.equal(res.headers.get('cache-control'),'private, no-store');
    assert.equal(res.headers.get('x-feed-offers'),'27530');
    assert.equal(res.headers.get('content-encoding'),null);
    exists=false;assert.equal((await request()).status,503);
    exists=true;meta.generatedAt='2020-01-01';assert.equal((await request()).status,503);
    assert.equal(mocks[2].mock.callCount(),0);assert.equal(mocks[3].mock.callCount(),1);
  }finally{mocks.forEach(m=>m.mock.restore());}
});

test('local XML fallback returns plain verified XML and rejects corrupted bytes',async()=>{
  const data=Buffer.from('<?xml version="1.0"?><data><cars/></data>');
  const entry={path:'catalog/advertising/yandex/b/green.xml',count:1,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  const mocks=[
    mock.method(LocalJsonStorage.prototype,'readJson',async()=>({generatedAt:new Date().toISOString(),files:{'green.xml':entry}})),
    mock.method(LocalJsonStorage.prototype,'binaryExists',async()=>true),
    mock.method(LocalJsonStorage.prototype,'getBinary',async()=>({data,size:data.length})),
    mock.method(console,'error',()=>{}),
  ];
  const request=()=>GET(new Request('https://avtocena.com/feeds/yandex-auto/green.xml'),{params:Promise.resolve({file:'green.xml'})});
  try{
    const res=await request();assert.equal(res.status,200);assert.equal(await res.text(),data.toString());
    assert.equal(res.headers.get('content-encoding'),null);
    entry.sha256='wrong';assert.equal((await request()).status,503);
  }finally{mocks.forEach(m=>m.mock.restore());}
});
