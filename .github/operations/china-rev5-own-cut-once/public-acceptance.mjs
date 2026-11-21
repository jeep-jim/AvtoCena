const ID=/^[a-f0-9]{24}$/;
const GEN=/^gen_[0-9]{13}_china[1-9][0-9]{0,19}$/;
const BASE='https://avtocena.com';
const need=(x,r)=>{if(!x)throw Error('china_public_acceptance:'+r)};
const release='22867cbcfaee27b2e8917b6bf880e44827f67b60',calc='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const readCard=html=>{
 const main=html.match(/<main\b[^>]*\bdata-offer-id="[^"]+"[^>]*>/)?.[0];
 return {id:main?.match(/\bdata-offer-id="([^"]+)"/)?.[1],amount:Number(main?.match(/\bdata-offer-price-rub="(\d+)"/)?.[1])};
};
const uniqueLinks=(text,generation)=>{
 const out=new Map();
 for(const m of text.matchAll(/href="([^"]+)"/g)){
  const href=m[1].replaceAll('&amp;','&');
  if(!href.startsWith('/cars/offer/'))continue;
  const u=new URL(href,BASE),id=u.pathname.match(/^\/cars\/offer\/([a-f0-9]{24})\/[a-z0-9-]{1,160}$/)?.[1];
  if(id&&u.searchParams.get('market')==='china'&&u.searchParams.get('preparedCut')===generation&&
    !u.hash&&[...u.searchParams].length===2)out.set(id,u.pathname+u.search);
 }
 return out;
};
export async function assertPublicInstalledChinaRuntime({fetcher=fetch}={}){
 const r=await fetcher(new URL('/api/health',BASE),{method:'GET',cache:'no-store',redirect:'error',
  headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
 need(r.status===200&&r.body,'installed_runtime_http');
 const parts=[];let n=0;for await(const b of r.body){n+=b.byteLength;need(n<=64*1024,'installed_runtime_body');parts.push(b);}
 const v=JSON.parse(Buffer.concat(parts).toString('utf8'));
 need(v?.ok===true&&v.service==='avtocena-web'&&v.releaseSha===release&&v.calculationVersion===calc,'installed_runtime');
}
export async function acceptChinaPublic({generation,readyRows,knownRemovedId,knownRemovedCanonicalPath,make,model,anchor,assertCurrent,fetcher=fetch}){
 need(GEN.test(generation)&&Number.isSafeInteger(readyRows)&&readyRows>=100000&&readyRows<=400000&&ID.test(knownRemovedId)&&
  typeof assertCurrent==='function'&&ID.test(anchor?.cardId)&&anchor.cardId!==knownRemovedId&&Number.isSafeInteger(anchor.listRub)&&anchor.listRub>0&&
  typeof make==='string'&&typeof model==='string'&&make.length<=80&&model.length<=80,'scope');
 const deadline=AbortSignal.timeout(120000);
 const read=async(path,max,html=false,allowGone=false)=>{
  const u=new URL(path,BASE);
  need(path.startsWith('/')&&!path.startsWith('//')&&u.origin===BASE&&!u.hash,'https_scope');
  const r=await fetcher(u,{method:'GET',cache:'no-store',redirect:'error',headers:{accept:html?'text/html':'application/json'},signal:deadline});
  if(allowGone&&(r.status===404||r.status===410)){await r.body?.cancel();return {gone:true};}
  need(r.status===200&&r.body,'http');const arr=[];let n=0;
  for await(const b of r.body){n+=b.byteLength;need(n<=max,'body_bound');arr.push(b);}
  const txt=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(arr));
  return html?txt:JSON.parse(txt);
 };
 await assertCurrent();
 const health=await read('/api/health',64*1024);
 need(health?.ok===true&&health.service==='avtocena-web'&&health.releaseSha===release&&health.calculationVersion===calc,'installed_runtime');
 const p=new URLSearchParams({market:'china',make,model,sort:'totalRub',page:'1',pageSize:'1',preparedCut:generation});
 const query='/api/catalog/search?'+p;
 const [filter,count,grid1,grid2]=await Promise.all([
  read(query,512*1024),read(query+'&countOnly=1',128*1024),
  read('/cars/china',8*1024*1024,true),read('/cars/china?page=2',8*1024*1024,true)]);
 const valid=b=>b?.ok===true&&b.generationId===generation&&b.countIncomplete!==true&&Array.isArray(b.items);
 need(valid(filter)&&valid(count)&&filter.total===count.total&&count.total===anchor.filteredCount&&count.total<=readyRows&&
  filter.items.length===1&&count.items.length===0,'indexed_list_count');
 const row=filter.items[0];
 need(row.id===anchor.cardId&&row.market==='china'&&row.preparedChinaSelection?.generationId===generation&&row.totalRub===anchor.listRub,'indexed_price');
 const a=uniqueLinks(grid1,generation),b=uniqueLinks(grid2,generation);
 need(a.size===24&&b.size===24&&[...a].every(([id])=>!b.has(id))&&!a.has(knownRemovedId)&&!b.has(knownRemovedId),'ordinary_24_grid');
 const fromAnchor=anchor.canonicalCardUri;
 const link=new URL(fromAnchor,BASE);
 need(typeof fromAnchor==='string'&&fromAnchor.startsWith('/cars/offer/'+anchor.cardId+'/')&&
  uniqueLinks('href="'+fromAnchor.replaceAll('&','&amp;')+'"',generation).get(anchor.cardId)===fromAnchor,'priced_card_uri');
 need(link.origin===BASE,'priced_card_origin');
 const gone=new URL(knownRemovedCanonicalPath,BASE);
 need(gone.origin===BASE&&gone.pathname.startsWith('/cars/offer/'+knownRemovedId+'/')&&/^[a-z0-9-]{1,160}$/.test(gone.pathname.split('/').at(-1))&&
  [...gone.searchParams].length===2&&gone.searchParams.get('market')==='china'&&gone.searchParams.get('preparedCut')===generation,'removed_card_uri');
 const [card,sold]=await Promise.all([read(fromAnchor,5*1024*1024,true),read(gone.pathname+gone.search,5*1024*1024,true,true)]);
 const c=readCard(card);
 // Exact installed 22867 renders genuine absent/withdrawn as either a hard
 // 404/410 or its explicit UnavailableOfferView soft-200, not an active listing.
 const realUnavailable=typeof sold==='string'&&/<main\b[^>]*class="ac-unavailable-main"/.test(sold)&&
  /<h1 id="unavailable-offer-title">(?:Этот автомобиль больше недоступен|Этот автомобиль продан)<\/h1>/.test(sold)&&
  !readCard(sold).id;
 need(c.id===anchor.cardId&&c.amount===anchor.listRub&&(sold.gone===true||realUnavailable),'same_price_and_confirmed_absence');
 await assertCurrent();
 return Object.freeze({status:'china_public_acceptance_passed',generation,ordinaryGrid1:24,ordinaryGrid2:24,filteredCount:count.total,
  parity:true,explicitRemovalAbsent:true,installedRuntime:release,cursorAdvanced:false});
}
