import {PUBLIC_MIN_VEHICLE_YEAR} from '@/lib/catalog/public-year-range';
import {findAutoCalcKnowledge} from '@/lib/autocalc/knowledge';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, max-age=30','X-Robots-Tag':'noindex, nofollow'};
const requests=new Map<string,{count:number;until:number}>();
let active=0;
export async function GET(request:Request){
 const url=new URL(request.url),query=url.searchParams.get('q')||'',year=Number(url.searchParams.get('year'))||undefined,market=url.searchParams.get('market')||undefined,make=url.searchParams.get('make')||undefined;
 if(query.length>180||(make&&make.length>80)||(year&&(!Number.isInteger(year)||year<PUBLIC_MIN_VEHICLE_YEAR||year>2100))||(market&&!['japan','china','korea','uae','europe','georgia'].includes(market)))return Response.json({error:'Проверьте название, год и рынок'},{status:400,headers});
 const now=Date.now(),ip=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';for(const [key,value]of requests)if(value.until<now)requests.delete(key);
 const entry=requests.get(ip)||{count:0,until:now+60000};if(++entry.count>30||requests.size>10000||active>=6)return Response.json({error:'Повторите поиск чуть позже'},{status:429,headers});requests.set(ip,entry);active++;
 try{return Response.json(await findAutoCalcKnowledge(query,year,market,make),{headers});}
 catch{return Response.json({error:'Подсказки временно недоступны. Можно заполнить данные вручную.'},{status:503,headers});}
 finally{active--;}
}
