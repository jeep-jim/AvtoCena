import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

export function publicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a,b] = ip.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
export function sourceUrl(value: unknown) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(url.hostname) || !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) throw Error('Вставьте HTTPS-ссылку на публичное объявление');
  url.hash='';
  if (url.href.length>2048) throw Error('Ссылка слишком длинная');
  return url;
}
// Pin the validated address for every hop: redirects cannot reach internal services.
export async function readSource(value: string, signal: AbortSignal, redirects=0,format:"html"|"json"="html",retry=0): Promise<{html:string;url:string}> {
  const url=sourceUrl(value);
  const addresses=await lookup(url.hostname,{all:true,family:4});
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(x=>!publicIPv4(x.address))) throw Error('Этот адрес недоступен для загрузки');
  const response=await new Promise<{status:number;location?:string;html:string}>((resolve,reject)=>{
    const req=request(url,{signal,family:4,headers:{'User-Agent':'AvtoCena/1.0 (+https://avtocena.com)','Accept':format==='json'?'application/json':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},lookup:((_host:any,_options:any,callback:any)=>callback(null,addresses[0].address,4)) as any},res=>{
      const status=res.statusCode || 0;
      if(status>=300&&status<400){res.resume();resolve({status,location:res.headers.location,html:''});return;}
      if(status!==200 || !(format==='json'?/application\/json/i:/text\/html|application\/xhtml\+xml/i).test(String(res.headers['content-type']))){res.resume();reject(Error('Источник не предоставил страницу объявления'));return;}
      let size=0;const chunks:Buffer[]=[];
      res.on('data',chunk=>{size+=chunk.length;if(size>2_000_000){res.destroy(Error('Страница слишком большая'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status,html:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.end();
  }).catch(async error=>{
    // Retry a dropped connection once, within the original time budget. Never retry an HTTP refusal.
    if(!retry&&!signal.aborted&&['ECONNRESET','EPIPE','EAI_AGAIN'].includes(error?.code)){
      const page=await readSource(value,signal,redirects,format,1);
      return {status:200,html:page.html,finalUrl:page.url};
    }
    throw error;
  });
  if('location' in response&&response.location){if(redirects>=3)throw Error('Слишком много перенаправлений');return readSource(new URL(response.location,url).href,signal,redirects+1,format,retry);}
  return {html:response.html,url:'finalUrl' in response?response.finalUrl:url.href};
}
const text=(x:any):string=>String(typeof x==='object' ? x?.name ?? x?.value ?? '' : x ?? '').replace(/<[^>]*>/g,'').trim().slice(0,180);
const numeric=(x:any)=>{const n=Number(typeof x==='object'?x?.value:x);return Number.isFinite(n)&&n>0?n:undefined;};
export function extractSource(html:string,url:string) {
  const pageTitle=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (/pardon our interruption|access denied|just a moment|verify (?:that )?you are human|attention required|robot check|security verification|captcha/i.test(pageTitle)) throw Error('Источник показал страницу проверки вместо объявления');
  const nodes:any[]=[];
  function visit(x:any,depth=0){if(!x||typeof x!=='object'||depth>12||nodes.length>500)return;if(Array.isArray(x)){x.slice(0,100).forEach(y=>visit(y,depth+1));return;}nodes.push(x);if(x['@graph'])visit(x['@graph'],depth+1);if(x.mainEntity)visit(x.mainEntity,depth+1);}
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(match[1]));}catch{}}
  const byId=new Map(nodes.filter(x=>typeof x['@id']==='string').map(x=>[x['@id'],x]));
  const resolve=(x:any)=>x&&typeof x==='object'&&x['@id']?{...byId.get(x['@id']),...x}:x;
  const samePage=(value:any)=>{try{const candidate=new URL(text(value),url),page=new URL(url);return candidate.origin===page.origin&&candidate.pathname===page.pathname&&candidate.search===page.search;}catch{return false;}};
  const cars=nodes.filter(x=>[x['@type']].flat().some(t=>['Car','Vehicle','Product','IndividualProduct'].includes(t)));
  const car=cars.length===1?cars[0]:cars.find(x=>(x.url&&samePage(x.url))||(x['@id']&&samePage(x['@id']))) || {};
  const offers=[car.offers].flat().filter(Boolean).map(resolve);const offer=offers.length===1?offers[0]:{};
  const priceSpecification=resolve(offer.priceSpecification)||{};
  const engine=resolve(car.vehicleEngine) || {};
  const meta=(key:string)=>{for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const attrs=Object.fromEntries([...m[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(x=>[x[1].toLowerCase(),x[2]]));if(attrs.property===key||attrs.name===key)return attrs.content || '';}return '';};
  const title=text(car.name || meta('og:title') || meta('twitter:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const photos=[car.image || meta('og:image') || meta('twitter:image')].flat().map(resolve).map(x=>typeof x==='object'?x?.contentUrl||x?.url:x).filter(Boolean).slice(0,20).flatMap(x=>{try{return [sourceUrl(new URL(x,url).href).href];}catch{return [];}});
  const host=new URL(url).hostname;const hosts:Record<string,string>={'che168.com':'china','autohome.com.cn':'china','dongchedi.com':'china','guazi.com':'china','encar.com':'korea','kcar.com':'korea','mobile.de':'europe','autoscout24.com':'europe','dubizzle.com':'uae','dubicars.com':'uae','myauto.ge':'georgia','pro-auctions.ru':'japan','sferacar.ru':'japan','akebono.world':'japan'};
  const market=Object.entries(hosts).find(([h])=>host===h||host.endsWith('.'+h))?.[1] || '';
  const draft:Record<string,string>={};
  const put=(k:string,v:any)=>{if(v!==undefined && v!=='')draft[k]=String(v);};
  // Model year is not evidence of production year. Keep it blank unless date is explicit.
  const production=text(car.productionDate);if(/^\d{4}(?:-\d{2})?/.test(production)){put('year',production.slice(0,4));put('productionMonth',production.slice(5,7));}
  const fuel=text(car.fuelType||engine.fuelType).toLowerCase();
  const fuels:Record<string,string>={gasoline:'petrol',petrol:'petrol',diesel:'diesel',electric:'electric',electricity:'electric',hybrid:'hybrid',бензин:'petrol',дизель:'diesel'};put('fuel',fuels[fuel]);
  const cc=engine.engineDisplacement;if(['CMQ','cm3','cm³','cc'].includes(cc?.unitCode||cc?.unitText))put('engineCc',numeric(cc));
  if(['LTR','l','L'].includes(cc?.unitCode||cc?.unitText)&&numeric(cc))put('engineCc',Math.round(numeric(cc)!*1000));
  const power=engine.enginePower;const unit=power?.unitCode||power?.unitText;
  if(['BHP','PS','hp','л.с.'].includes(unit))put('powerHp',numeric(power));
  if(['KWT','kW','кВт'].includes(unit)&&numeric(power)){put('powerKw',numeric(power));put('powerHp',(numeric(power)!/0.73549875).toFixed(2));}
  for(const [key,value] of Object.entries({trim:car.vehicleConfiguration,transmission:car.vehicleTransmission,drive:car.driveWheelConfiguration,body:car.bodyType,color:car.color,description:car.description}))if(text(value))put(key,text(value));
  const mileage=car.mileageFromOdometer;
  if(['KMT','km','км'].includes(mileage?.unitCode||mileage?.unitText)&&Number.isFinite(Number(mileage?.value))&&Number(mileage.value)>=0)put('mileageKm',Number(mileage.value));
  const steering=text(car.steeringPosition);
  if(/^(?:https?:\/\/schema.org\/)?LeftHandDriving$/.test(steering))put('steering','left');
  if(/^(?:https?:\/\/schema.org\/)?RightHandDriving$/.test(steering))put('steering','right');
  // Explicit product metadata is useful on sites without JSON-LD. Do not use it on ambiguous multi-car pages.
  const metadataAllowed=cars.length===0||Boolean(car['@type']);
  const price=numeric(offer.price??priceSpecification.price)??(metadataAllowed?numeric(meta('product:price:amount')||meta('og:price:amount')):undefined);
  const currency=text(offer.priceCurrency||priceSpecification.priceCurrency||(metadataAllowed?(meta('product:price:currency')||meta('og:price:currency')):'')).toUpperCase();
  return {title,make:text(resolve(car.brand)),model:text(car.model),market,price:price?.toString()||'',currency,images:[...new Set(photos)],draft,url};
}
