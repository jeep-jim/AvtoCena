import {pathToFileURL} from 'node:url';
const origin='https://avtocena.com', id='f011736e0fada0af4e0a7491', cut='gen_1795239842026_china44871616387';
const q='?'+new URLSearchParams({market:'china',preparedCut:cut});
const card='/cars/offer/'+id,legacy='/cars/offer/avtomobil--'+id,resolver='/api/catalog/offer-redirect/'+id;
const canonical=new RegExp('^'+card+'/[a-z0-9-]{1,160}$');
const formats=Object.freeze({bare:card,resolver,legacy});
const need=(x,k)=>{if(!x)throw Error('china_ford_direct:'+k)};
function scopedLocation(raw,current){
 if(!raw)return {class:'absent',canonicalPath:null};
 let u;try{u=new URL(raw,current);}catch{return{class:'invalid',canonicalPath:null};}
 const sameOrigin=u.origin===origin&&!u.username&&!u.password&&!u.hash,
  knownMarket=u.searchParams.getAll('market').length===1&&u.searchParams.get('market')==='china',
  knownCut=u.searchParams.getAll('preparedCut').length===1&&u.searchParams.get('preparedCut')===cut;
 const kind=!sameOrigin?'foreign_or_unsafe':u.pathname===resolver?'exact_resolver':u.pathname===legacy?'exact_legacy_fallback':
  u.pathname===card?'same_bare_id':canonical.test(u.pathname)?'exact_same_id_canonical':u.pathname==='/cars'?'catalog_root':'other_same_origin';
 const extraQuery=[...u.searchParams].some(([k])=>k!=='market'&&k!=='preparedCut');
 return {class:kind,sameOrigin,marketPresent:u.searchParams.has('market'),cutPresent:u.searchParams.has('preparedCut'),
  knownMarket,knownCut,extraQuery,canonicalPath:kind==='exact_same_id_canonical'&&!extraQuery&&
   (!u.searchParams.has('market')||knownMarket)&&(!u.searchParams.has('preparedCut')||knownCut)?u.pathname:null};
}
function bodyClass(text){
 const main=[...text.matchAll(/<main\b[^>]*>/gi)].map(m=>m[0]);
 const row=main.find(m=>/\bdata-offer-id=/.test(m));
 const identified=row?.match(/\bdata-offer-id="([^"]+)"/)?.[1]===id;
 const price=Number(row?.match(/\bdata-offer-price-rub="(\d+)"/)?.[1]);
 const explicitMain=main.some(m=>/\bac-unavailable-main\b/.test(m));
 const heading=/<h1\b[^>]*\bid="unavailable-offer-title"[^>]*>([\s\S]{0,500}?)<\/h1>/.exec(text)?.[1]?.replace(/<!--[^]*?-->|<[^>]+>/g,'').trim();
 return {hasActiveCard:Boolean(row),exactActiveFord:identified,hasActivePrice:Number.isSafeInteger(price)&&price>0,
  explicitUnavailable:explicitMain&&['Этот автомобиль больше недоступен','Этот автомобиль продан'].includes(heading),
  supplierUnavailable:main.some(m=>/\bdata-supplier-unavailable(?:=|\s|>)/.test(m)),
  genericRetryHeading:/<h1\b[^>]*>Не удалось загрузить автомобиль<\/h1>/.test(text),
  noindexMeta:/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/.test(text)};
}
export async function inspectFord({fetcher=fetch}={}){
 let count=0,total=0;const signal=AbortSignal.timeout(65_000);
 async function get(p,cap,accept){
  need((p==='/api/health'||Object.values(formats).some(x=>p===x+q)||p.endsWith(q)&&canonical.test(p.slice(0,-q.length)))&&++count<=5,'exact_get_scope');
  const u=new URL(p,origin),r=await fetcher(u,{method:'GET',redirect:'manual',cache:'no-store',signal,headers:{accept}});
  const l=scopedLocation(r.headers.get('location'),u),chunks=[];let n=0;
  if(r.status>=300&&r.status<400){await r.body?.cancel();return {status:r.status,loc:l,noindex:r.headers.get('x-robots-tag')==='noindex',text:''};}
  if(r.body)for await(const b of r.body){n+=b.byteLength;total+=b.byteLength;need(n<=cap&&total<=12*1024**2,'hard_body_cap');chunks.push(b);}
  return {status:r.status,loc:l,noindex:r.headers.get('x-robots-tag')==='noindex',text:new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))};
 }
 const h=await get('/api/health',64*1024,'application/json'),x=JSON.parse(h.text);
 need(h.status===200&&x.ok===true&&x.releaseSha==='22867cbcfaee27b2e8917b6bf880e44827f67b60'&&
  x.calculationVersion==='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90','installed_release');
 const [bare,api,old]=await Promise.all([get(card+q,4*1024**2,'text/html'),get(resolver+q,512*1024,'text/html'),get(legacy+q,5*1024**2,'text/html')]);
 // Only an already verified same-ID source-defined redirect path can trigger
 // the optional canonical request. Use our own exact query, never forward it.
 const discovered=api.loc.canonicalPath??bare.loc.canonicalPath??old.loc.canonicalPath;
 const direct=discovered?await get(discovered+q,5*1024**2,'text/html'):null;
 const sanitized=r=>{const {canonicalPath,...location}=r.loc;return {status:r.status,location,noindexHeader:r.noindex,...bodyClass(r.text)};};
 return {kind:'china_ford_direct_public_read_only',generation:cut,bare:sanitized(bare),resolver:sanitized(api),legacy:sanitized(old),
   canonical:direct?sanitized(direct):null,knownDirectBrowserPaths:[old.status,...(direct?[direct.status]:[])],
   publishedActiveFord:[bare,api,old,...(direct?[direct]:[])].some(v=>bodyClass(v.text).exactActiveFord),
   providerRequests:0,storageWrites:0,cursorWrites:0,requests:count};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await inspectFord()));}catch(e){const s=e instanceof Error?e.message:'';
  console.log(JSON.stringify({kind:'china_ford_direct_read_held',reason:/^china_ford_direct:[a-z_]+$/.test(s)?s:'public_transport_or_parse'}));process.exitCode=2;}
}
