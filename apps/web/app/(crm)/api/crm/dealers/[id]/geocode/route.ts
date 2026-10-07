import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {accountRateLimit} from '@/lib/account/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser(),{id}=await params;
 if(!isCalculationOriginAllowed(req)||!await canManageDealer(user,id))return Response.json({error:'Доступ запрещён.'},{status:403});
 if(!await accountRateLimit('address:'+user!.id,90,60000))return Response.json({error:'Повторите поиск через минуту.'},{status:429});
 try{const text=await req.text();if(text.length>2048)return new Response(null,{status:413});const b=JSON.parse(text),query=String(b.query||'').trim().slice(0,200),city=String(b.city||'').trim().slice(0,100);
 if(query.length<3)return Response.json({suggestions:[]});const token=process.env.DADATA_API_KEY||process.env.DADATA_TOKEN;
 if(!token)return Response.json({error:'Поиск адресов временно недоступен. Уточните адрес и проверьте его на карте.'},{status:503});
 const r=await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Token ${token}`},body:JSON.stringify({query:[city,query].filter(Boolean).join(', '),count:7,to_bound:{value:'house'}}),signal:AbortSignal.timeout(7000),cache:'no-store'});
 if(!r.ok)throw Error('lookup');const result=await r.json();
 const suggestions=(result.suggestions||[]).map((s:any)=>{const d=s.data||{},lat=Number(d.geo_lat),lon=Number(d.geo_lon),precise=d.house&&d.geo_lat!=null&&d.geo_lon!=null&&String(d.qc_geo)==='0'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;return {address:String(s.value||'').slice(0,300),city:String(d.city||d.settlement||city),lat:precise?lat:null,lon:precise?lon:null};}).filter((s:any)=>s.address);
 return Response.json({suggestions},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Не удалось найти адрес. Попробуйте ещё раз.'},{status:503});}
}
