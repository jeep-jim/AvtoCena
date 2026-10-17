import {loadSource} from '@/lib/autocalc/load';
import { isCalculationOriginAllowed } from '@/lib/catalog/calculation-request-origin';
import { readSource, extractSource, sourceUrl } from '@/lib/autocalc/source';
import { autocalcScenario } from '@/lib/autocalc/scenario';
import { calculateOfferWithCustomerParametersDetailed } from '@/lib/catalog/customs-pricing';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'};
const requests=new Map<string,{count:number;until:number}>();
export async function POST(request:Request) {
  if(!isCalculationOriginAllowed(request))return Response.json({error:'Недопустимый источник запроса'},{status:403,headers});
  const key=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
  const now=Date.now();for(const [k,v] of requests)if(v.until<now)requests.delete(k);
  const limit=requests.get(key)||{count:0,until:now+60000};if(++limit.count>20 || requests.size>10000)return Response.json({error:'Слишком много запросов. Повторите через минуту.'},{status:429,headers});requests.set(key,limit);
  let raw='';let size=0;const reader=request.body?.getReader();const decoder=new TextDecoder();
  if(reader){while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>12000){await reader.cancel();return Response.json({error:'Слишком большой запрос'},{status:413,headers});}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}
  try {
    const body=JSON.parse(raw);
    if(body.action==='extract'){
      const url=sourceUrl(body.url).href;
      return Response.json(await loadSource(url),{headers});
    }
    const {offer,parameters,draft}=autocalcScenario(body);
    const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);
    if(!result.ok)return Response.json({error:result.error},{status:422,headers});
    if(body.action==='pdf'){
      const {offerPdfData,renderOfferPdf}=await import('@/lib/catalog/offer-pdf');
      const data=offerPdfData(offer,draft,result.calculation,'Расчёт по данным пользователя. Характеристики и стоимость требуют подтверждения.');
      data.url='https://avtocena.com/autocalc';data.photoUrl=undefined;
      return new Response(new Uint8Array(await renderOfferPdf(data)),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="AvtoCena-calculation.pdf"'}});
    }
    return Response.json(result.calculation,{headers});
  }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось выполнить расчёт'},{status:400,headers});}
}
