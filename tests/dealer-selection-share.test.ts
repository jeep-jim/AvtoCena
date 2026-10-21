import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionQuery,selectionTarget} from '../apps/web/lib/dealers/selection-share';
import {cleanShareTarget,createShortShare,readShortShare} from '../apps/web/lib/catalog/short-share';
import {dealerBrowsingHref} from '../apps/web/lib/dealers/browsing-context';
import {socialImageUrl} from '../apps/web/lib/catalog/social-image';
import {renderSocialPhoto,renderCatalogPhoto} from '../apps/web/lib/catalog/photo-rendition';
import sharp from 'sharp';

test('dealer selection roundtrip preserves filters and city, drops private flags, and anchors catalogue',async()=>{
 const query='make=Audi%7CLynk+%26+Co&model=Q5&budget=2500000&sort=totalRub&city=Новокузнецк&preview=1&token=secret&page=4&utm_source=private';
 const target=cleanShareTarget(selectionTarget('dealer_topavto',query),true);
 assert.equal(target.version,2);assert.equal(target.mini,false);
 const u=new URL(target.path,'https://avtocena.com');assert.equal(u.hash,'#catalog');assert.equal(u.searchParams.get('city'),'Новокузнецк');assert.equal(u.searchParams.get('make'),'Audi|Lynk & Co');assert.equal(u.searchParams.get('budget'),'2500000');assert.equal(u.searchParams.get('selection'),'1');
 for(const k of ['preview','token','page','utm_source'])assert.equal(u.searchParams.has(k),false);
 const records=new Map();const storage:any={readJson:async(k:string,f:any)=>records.get(k)??f,writeJson:async(k:string,v:any)=>records.set(k,v)};
 const short=await createShortShare(target,storage);assert.match(short,/^\/s\/[\w-]{16}$/);assert.deepEqual(await readShortShare(short.slice(3),storage),target);
 assert.equal(await createShortShare(cleanShareTarget(selectionTarget('dealer_topavto',new URLSearchParams(query).toString()),false),storage),short);
 assert.notEqual(await createShortShare(cleanShareTarget(selectionTarget('dealer_topavto',query+'&yearFrom=2023'),false),storage),short);
});
test('bad values cannot become redirects; tolerant page parsing never crashes public catalogue',()=>{
 for(const value of ['/dealers/../crm','//evil.test/dealers/id','/dealers/id?budget=-1','/dealers/id?city=%3Cscript%3E','/dealers/id?sort=unknown'])assert.throws(()=>cleanShareTarget(value,false));
 assert.equal(selectionQuery(new URLSearchParams('make=Audi&budget=oops&sort=oops'),false).toString(),'make=Audi');
});
test('Japan filter navigation retains the dealer and selected delivery city',()=>{
 const dealer:any={id:'dealer_topavto',href:'/nvkz/topavto',preview:false};
 const u=new URL(dealerBrowsingHref('/cars/green?make=Honda&city=Новокузнецк',dealer),'https://avtocena.com');
 assert.equal(u.pathname,'/nvkz/topavto');assert.equal(u.searchParams.get('market'),'japan');assert.equal(u.searchParams.get('stock'),'green');assert.equal(u.searchParams.get('city'),'Новокузнецк');
 assert.match(dealerBrowsingHref('/cars/offer/car',dealer),/^\/cars\/offer\/car\?dealer=dealer_topavto/);
});
test('social previews use separate bounded JPEG, normal gallery keeps WebP',async()=>{
 const photo='/api/catalog/photo/signature?url=https%3A%2F%2Fci.encar.com%2Fa.jpg&market=korea';
 const u=new URL(socialImageUrl(photo));assert.equal(u.searchParams.get('format'),'jpeg');assert.equal(u.searchParams.get('url'),'https://ci.encar.com/a.jpg');
 assert.equal(socialImageUrl('https://example.com/a.webp'),'https://example.com/a.webp');
 assert.equal(new URL(socialImageUrl('/api/dealers/id/media/photo')).searchParams.get('format'),'jpeg');
 const input=await sharp({create:{width:1600,height:900,channels:4,background:'#fff0'}}).webp().toBuffer();
 const jpeg=await renderSocialPhoto(input);const meta=await sharp(jpeg).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.width,1200);assert.equal(meta.height,675);assert.equal(meta.hasAlpha,false);
 const original=await renderCatalogPhoto(input,false);assert.equal((await sharp(original).metadata()).format,'webp');
});

test('selection API requires own-company access and published profile; public car sharing stays available',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const fs=await import('node:fs');const path=await import('node:path');
 const dir=path.resolve('artifacts/selection-api');fs.mkdirSync(dir,{recursive:true});
 const mocks:Record<string,string>={
  '@/lib/auth':'export async function getCurrentUser(){return globalThis.__selectionActor||null}',
  '@/lib/dealers/showcase-store':"export async function findDealer(){return {status:'verified'}};export async function readShowcase(){return {profileEnabled:globalThis.__selectionPublished!==false}}",
  '@/lib/dealers/program-store':'export async function availableShowcase(s){return s}',
  '@/lib/catalog/short-share':`export {cleanShareTarget} from ${JSON.stringify(path.resolve('apps/web/lib/catalog/short-share.ts'))};export async function createShortShare(){return '/s/1234567890123456'}`
 };
 await build({entryPoints:['apps/web/app/api/share/route.ts'],outfile:dir+'/route.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/^@\//},a=>mocks[a.path]?{path:a.path,namespace:'mocks'}:undefined);b.onResolve({filter:/^\.\/showcase-store$/},a=>a.importer.endsWith('/dealers/access.ts')?{path:'@/lib/dealers/showcase-store',namespace:'mocks'}:undefined);b.onLoad({filter:/.*/,namespace:'mocks'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});
 const {POST}=createRequire(import.meta.url)(dir+'/route.cjs');const g=globalThis as any;
 const req=(p='/dealers/external?make=Audi')=>new Request('https://avtocena.com/api/share',{method:'POST',headers:{origin:'https://avtocena.com','Content-Type':'application/json'},body:JSON.stringify({path:p})});
 try{
  for(const actor of [null,{role:'dealer',companyId:'other',dealerApproved:true},{role:'dealer',companyId:'external',dealerApproved:false},{role:'dealer',companyId:'external',dealerApproved:true,status:'disabled'}]){g.__selectionActor=actor;assert.equal((await POST(req())).status,403);}
  g.__selectionActor={role:'dealer',companyId:'external',dealerApproved:true};assert.equal((await POST(req())).status,200);
  g.__selectionPublished=false;assert.equal((await POST(req())).status,404);
  g.__selectionActor=null;assert.equal((await POST(req('/cars/offer/car'))).status,200);
 }finally{delete g.__selectionActor;delete g.__selectionPublished;}
});

test('shared green and auction selections retain their source and query',()=>{
 for(const query of ['market=japan&stock=green&make=Honda&model=Fit&q=Honda','market=japan&source=ajes&chassis=RK1&lotNumber=123']){
 const input=new URLSearchParams(query),output=new URL(selectionTarget('dealer_topavto',query),'https://avtocena.com').searchParams;
 for(const [key,value] of input)assert.equal(output.get(key),value);
 }
});


test('custom selection title survives storage and changes link identity; blank keeps legacy links',async()=>{
 const records=new Map();const storage:any={readJson:async(k:string,f:any)=>records.get(k)??f,writeJson:async(k:string,v:any)=>records.set(k,v)};
 const path=selectionTarget('dealer_topavto','make=Audi&market=china');
 const original=cleanShareTarget(path,false);
 const blank=cleanShareTarget(path,false,'   ');assert.deepEqual(blank,original);
 const titled=cleanShareTarget(path,false,'  Для Николая\n Audi  ');
 assert.equal(titled.version===2&&titled.title,'Для Николая Audi');
 const url=await createShortShare(titled,storage);assert.deepEqual(await readShortShare(url.slice(3),storage),titled);
 assert.notEqual(url,await createShortShare(original,storage));
 assert.equal(cleanShareTarget(path,false,'я'.repeat(200)).version,2);
 assert.equal(cleanShareTarget('/cars/offer/car',false,'not a car title').version,1);
});

 test('shared selection retains white Audi filters and ordered sorting through short-link storage',async()=>{
 const filters=new URLSearchParams({make:'Audi',market:'china',color:'white',bodyType:'hatchback',yearFrom:'2023',yearTo:'2024',powerTo:'160',city:'Новокузнецк',sort:'mileage,year,totalRub'});
 const target=cleanShareTarget(selectionTarget('dealer_topavto',filters.toString()),false);
 const records=new Map();const storage:any={readJson:async(k:string,f:any)=>records.get(k)??f,writeJson:async(k:string,v:any)=>records.set(k,v)};
 const short=await createShortShare(target,storage);const restored=await readShortShare(short.slice(3),storage);assert.ok(restored);
 const actual=new URL(restored.path,'https://avtocena.com').searchParams;
 for(const [key,value] of filters)assert.equal(actual.get(key),value,key);
 const withoutColor=new URLSearchParams(filters);withoutColor.delete('color');
 assert.notEqual(await createShortShare(cleanShareTarget(selectionTarget('dealer_topavto',withoutColor.toString()),false),storage),short);
 assert.equal(selectionQuery(new URLSearchParams('sort=mileageDesc')).get('sort'),'mileageDesc');
 for(const sort of ['mileage,unknown','year,yearAsc','totalRub,totalRubDesc','mileage,year,totalRub,yearAsc'])assert.throws(()=>selectionQuery(new URLSearchParams({sort})));
 });
