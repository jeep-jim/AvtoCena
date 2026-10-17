import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import sharp from 'sharp';
import fs from 'node:fs';
import {normalizeAccountAppearance} from '../apps/web/lib/account-appearance';
const require = createRequire(import.meta.url);

test('account artwork accepts only uploaded media and keeps four independent roles', () => {
  const banner = '/api/site-media/' + 'a'.repeat(64), icon = '/api/site-media/' + 'b'.repeat(64);
  const raw = {customer: {banner, icon}, dealer: {banner: icon, icon: banner}, blogger: {banner: '', icon: ''}, supplier: {banner, icon: ''}};
  assert.deepEqual(normalizeAccountAppearance(raw), raw);
  for (const url of ['javascript:alert(1)', 'https://example.com/picture.png', '/api/site-media/../../secret', 'data:image/svg+xml,test']) {
    assert.throws(() => normalizeAccountAppearance({customer: {banner: url}}));
  }
});

test('site media protects uploads, validates images, and serves only the exact public media key', async () => {
  const state: any = {user: null, stored: new Map()};
  (globalThis as any).__accountMediaTest = state;
  const mocks: Record<string, string> = {
    '@/lib/auth': 'export const getCurrentUser=async()=>globalThis.__accountMediaTest.user;',
    '@/lib/data': 'export const getJsonStorage=()=>({putBinary:async(k,data)=>globalThis.__accountMediaTest.stored.set(k,{data}),getBinary:async k=>globalThis.__accountMediaTest.stored.get(k),deleteBinary:async k=>globalThis.__accountMediaTest.stored.delete(k),createBinaryDownloadUrl:async()=>globalThis.__accountMediaTest.downloadUrl||null});',
  };
  async function load(entry: string) {
    const result = await build({entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, plugins: [{name: 'site-media-test', setup(b) {
      b.onResolve({filter: /^@\//}, args => mocks[args.path] ? {path: args.path, namespace: 'mock'} : undefined);
      b.onLoad({filter: /.*/, namespace: 'mock'}, args => ({contents: mocks[args.path], loader: 'ts'}));
    }}]});
    const module = {exports: {} as any}; new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports); return module.exports;
  }
  try {
    const upload = await load('apps/web/app/(crm)/api/crm/site-media/route.ts');
    const read = await load('apps/web/app/(public)/api/site-media/[id]/route.ts');
    const png = await sharp({create: {width: 20, height: 20, channels: 4, background: '#00aa0080'}}).png().toBuffer();
    const request = (origin = 'https://avtocena.com', bytes = png, type = 'image/png') => {
      const form = new FormData(); form.set('file', new File([new Uint8Array(bytes)], 'image.png', {type}));
      return new Request('https://avtocena.com/api/crm/site-media', {method: 'POST', headers: {origin}, body: form});
    };
    for (const user of [null, {role: 'dealer', companyId: 'other', permissions: {site: true}}, {role: 'admin', companyId: 'dealer_topavto'}, {role: 'owner', companyId: 'other'}]) {
      state.user = user; assert.equal((await upload.POST(request())).status, 403);
    }
    state.user = {id: 'owner', role: 'owner', companyId: 'dealer_topavto', status: 'active'};
    assert.equal((await upload.POST(request('https://foreign.example'))).status, 403);
    assert.equal(state.stored.size, 0);
    assert.equal((await upload.POST(request(undefined, Buffer.from('not an image')))).status, 400);
    assert.equal((await upload.POST(request(undefined, png, 'image/svg+xml'))).status, 400);
    const response = await upload.POST(request()); assert.equal(response.status, 200);
    const {url} = await response.json(); assert.match(url, /^\/api\/site-media\/[a-f0-9]{64}$/);
    const id = url.split('/').pop();
    const media = await read.GET(new Request('https://avtocena.com' + url), {params: Promise.resolve({id})});
    assert.equal(media.status, 200); assert.equal(media.headers.get('Content-Type'), 'image/webp');
    assert.equal((await sharp(Buffer.from(await media.arrayBuffer())).metadata()).hasAlpha, true);
    assert.equal((await read.GET(new Request('https://avtocena.com'), {params: Promise.resolve({id: '../documents'})})).status, 404);
    await upload.POST(request()); assert.equal(state.stored.size, 1, 'identical files reuse one object');
    assert.equal((await upload.POST(request(undefined,png,'video/mp4'))).status,400);
    const mp4=Buffer.alloc(32);mp4.writeUInt32BE(24,0);mp4.write('ftypisom',4);mp4.write('mp42',16);
    const videoResponse=await upload.POST(request(undefined,mp4,'video/mp4'));assert.equal(videoResponse.status,200);
    const videoUrl=(await videoResponse.json()).url;assert.ok(videoUrl.endsWith('.mp4'));
    const videoId=videoUrl.split('/').pop();
    const partial=await read.GET(new Request('https://avtocena.com'+videoUrl,{headers:{range:'bytes=4-11'}}),{params:Promise.resolve({id:videoId})});
    assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Type'),'video/mp4');assert.equal(await partial.text(),'ftypisom');
    const badRange=await read.GET(new Request('https://avtocena.com'+videoUrl,{headers:{range:'bytes=999-'}}),{params:Promise.resolve({id:videoId})});assert.equal(badRange.status,416);
    const command=(body:any)=>upload.POST(new Request('https://avtocena.com/api/crm/site-media',{method:'POST',headers:{origin:'https://avtocena.com','content-type':'application/json'},body:JSON.stringify(body)}));
    // A real playable MP4 padded with a valid ISO free box exceeds the container request limit.
    const original=fs.readFileSync('apps/web/public/account-media/loading-oct05.mp4');
    const free=Buffer.alloc(4*1024*1024);free.writeUInt32BE(free.length);free.write('free',4);
    const large=Buffer.concat([original,free]);
    const start=await command({action:'start',name:'car.mp4',type:'video/mp4',size:large.length});assert.equal(start.status,200);
    const {token,chunkSize}=await start.json();assert.equal(chunkSize,2*1024*1024);
    const part=async(index:number,bytes:Buffer,uploadToken=token)=>{
      const form=new FormData();form.set('file',new Blob([new Uint8Array(bytes)]),'part');
      const req=new Request('https://avtocena.com/api/crm/site-media',{method:'POST',headers:{origin:'https://avtocena.com','x-media-upload':uploadToken,'x-media-part':String(index)},body:form});
      assert.ok((await req.clone().arrayBuffer()).byteLength<3.5*1024*1024);
      return upload.POST(req);
    };
    assert.equal((await part(0,large.subarray(0,chunkSize),token+'x')).status,400);
    state.user={...state.user,id:'another-owner'};assert.equal((await part(0,large.subarray(0,chunkSize))).status,400);state.user.id='owner';
    assert.equal((await part(0,Buffer.from('short'))).status,400);
    for(let offset=0,index=0;offset<large.length;offset+=chunkSize,index++)assert.equal((await part(index,large.subarray(offset,offset+chunkSize))).status,200);
    const finished=await command({action:'finish',token});assert.equal(finished.status,200);
    const uploaded=(await finished.json()).url;const uploadedId=uploaded.split('/').pop();
    assert.deepEqual(state.stored.get('settings/account-media/'+uploadedId).data,large);
    assert.ok(![...state.stored.keys()].some(k=>k.includes('pending')),'temporary parts are deleted');
    const missing=await command({action:'start',name:'car.mp4',type:'video/mp4',size:large.length});
    assert.equal((await command({action:'finish',token:(await missing.json()).token})).status,400);
    assert.equal((await command({action:'start',name:'huge.mp4',type:'video/mp4',size:33*1024*1024})).status,400);
    state.downloadUrl='https://storage.example/video.mp4?signed=yes';
    const redirect=await read.GET(new Request('https://avtocena.com'+uploaded,{headers:{range:'bytes=0-'}}),{params:Promise.resolve({id:uploadedId})});
    assert.equal(redirect.status,307);assert.equal(redirect.headers.get('location'),state.downloadUrl);assert.equal(redirect.headers.get('cache-control'),'no-store');

  } finally {delete (globalThis as any).__accountMediaTest;}
});

test('appearance preserves separate theme backgrounds and limits public media to uploaded assets',()=>{
 const photo='/api/site-media/'+'c'.repeat(64),video=photo+'.mp4';
 const value={customer:{banner:'',icon:'',backgroundLight:photo,backgroundDark:'',colorLight:'#d7e7fa',colorDark:'#253e5b',media:[{url:video,type:'video',caption:'Погрузка'},{url:photo,type:'image',caption:'Автомобиль'}]}};
 assert.deepEqual(normalizeAccountAppearance(value),value);
 for(const patch of [{colorLight:'url(javascript:alert(1))'},{backgroundDark:'https://other.test/image'},{media:[{url:video,type:'image'}]},{media:Array(7).fill({url:photo,type:'image'})},{media:[{url:'/api/account/documents/private',type:'image'}]}])assert.throws(()=>normalizeAccountAppearance({customer:{...value.customer,...patch}}));
});
