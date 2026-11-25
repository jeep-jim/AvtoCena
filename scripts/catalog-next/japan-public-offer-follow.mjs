// Single AJ page + one canonical offer URL; no scraping, source dump or IP spoofing.
const origin='https://avtocena.com';
const report={kind:'japan-public-offer-follow-v1',market:'japan',visitorIpSpoofed:false,
  completeProviderDownloads:0};
async function grab(url,accept){
 const response=await fetch(url,{redirect:'follow',cache:'no-store',headers:{Accept:accept},
  signal:AbortSignal.timeout(28000)});
 const p=new URL(response.url);
 if(!['avtocena.com','www.avtocena.com'].includes(p.hostname)||p.protocol!=='https:')throw Error('external_redirect');
 const chunks=[];let size=0;
 for await(const bytes of response.body??[]){size+=bytes.byteLength;if(size>2*1024*1024)throw Error('response_size');chunks.push(Buffer.from(bytes))}
 return {status:response.status,redirected:response.redirected,body:Buffer.concat(chunks).toString('utf8')};
}
try {
 const listing=await grab(origin+'/api/catalog/search?market=japan&page=1&pageSize=1','application/json');
 const parsed=JSON.parse(listing.body),id=parsed?.items?.[0]?.id;
 report.list={httpStatus:listing.status,oneJapanOffer:parsed?.ok===true&&parsed.items?.length===1&&parsed.items[0].market==='japan'};
 if(listing.status!==200||!report.list.oneJapanOffer||!/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(String(id)))throw Error('list_unverified');
 const detail=await grab(origin+'/cars/offer/'+encodeURIComponent(id),'text/html');
 report.detail={httpStatus:detail.status,redirected:detail.redirected,hasRubPrice:detail.body.includes('₽'),
   hasJapanTitle:detail.body.includes('Япония'),isNotFound:detail.body.includes('Страница не найдена')};
 report.status=detail.status===200&&report.detail.hasRubPrice?'confirmed':'not_confirmed';
 if(report.status!=='confirmed')process.exitCode=1;
}catch(e){report.status='not_confirmed';report.errorType=['TypeError','AbortError','TimeoutError'].includes(e?.name)?e.name:'route_verification';process.exitCode=1}
console.log(JSON.stringify(report));
