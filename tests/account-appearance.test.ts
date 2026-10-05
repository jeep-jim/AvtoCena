import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import sharp from 'sharp';
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
    '@/lib/data': 'export const getJsonStorage=()=>({putBinary:async(k,data)=>globalThis.__accountMediaTest.stored.set(k,{data}),getBinary:async k=>globalThis.__accountMediaTest.stored.get(k)});',
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
  } finally {delete (globalThis as any).__accountMediaTest;}
});
