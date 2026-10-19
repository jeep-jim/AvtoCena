import {getJsonStorage} from '../apps/web/lib/data';
async function body(url:string,limit=2*1024*1024){
 const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(60000),headers:{'User-Agent':'AvtoCena owner-requested release verification'}});
 const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('large');}chunks.push(value);}
 return {status:response.status,text:Buffer.concat(chunks).toString('utf8')};
}
async function main(){
 const health=await body('https://avtocena.com/api/health');let h:any;try{h=JSON.parse(health.text);}catch{throw Error('health_invalid');}
 console.log('RELEASE_HEALTH',JSON.stringify({status:health.status,ok:h.ok,releaseSha:h.releaseSha,calculationVersion:h.calculationVersion}));
 const page=await body('https://avtocena.com/s/GgabHBpFJ9vgLYJ0');
 const details=[...page.text.matchAll(/<details\b[\s\S]*?<\/details>/gi)].map(m=>m[0]);
 const source=details.find(s=>s.includes('ac-offer-updated')&&s.includes('https://m.che168.com/cardetail/index?infoid=59163228'));
 console.log('HAVAL_LIVE_PAGE',JSON.stringify({status:page.status,hasHaval:/HAVAL|Haval/.test(page.text),originalSourceInExistingDisclosure:!!source,sourcePlaceholderVisible:/href="[^"]*\{LOT\}/.test(page.text),hasEngineModel:page.text.includes('GW4G15M'),hasSourceSpecs:page.text.includes('Характеристики из объявления'),priceAttribute:page.text.match(/data-offer-price-rub="([0-9]+)"/)?.[1]}));
 const lock:any=await getJsonStorage().readJson('catalog/import-lock.json',null);console.log('RELEASE_PUBLICATION_LOCK',JSON.stringify({operationType:lock?.operationType,lockedUntil:lock?.lockedUntil}));
 if(page.status!==200)throw Error('page_not_verified');
}
main().catch(e=>{console.log('RELEASE_VERIFY_FAILED',['health_invalid','release_not_active','page_not_verified','empty','large'].includes(e?.message)?e.message:'request_failed');process.exitCode=1;});
