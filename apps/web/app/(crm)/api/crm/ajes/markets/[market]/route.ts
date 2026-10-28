import {getJsonStorage} from '@/lib/data';
import type {AjesRequestDiagnostic} from '@/lib/catalog/ajes-request-diagnostic';
import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {ajesPassword} from '@/lib/catalog/ajes-settings';
import {ajesPreviewMarket,AjesPreviewError} from '@/lib/catalog/ajes-market-preview';
import {previewAjesMarket,readAjesPreviewDiagnostic} from '@/lib/catalog/ajes-market-preview-runtime';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
type Context={params:Promise<{market:string}>};
export async function GET(_req:Request,context:Context){
 if(!isPlatformOwner(await getCurrentUser()))return response({error:'Доступ запрещён'},403);
 try{const market=ajesPreviewMarket((await context.params).market);return response({market,configured:Boolean(await ajesPassword()),diagnostic:await readAjesPreviewDiagnostic(market),catalogDiagnostic:await getJsonStorage().readJson<AjesRequestDiagnostic|null>(`integrations/ajes/catalog-failure-${market}.json`,null).catch(()=>null),publicationReady:true});}
 catch{return response({error:'Не удалось прочитать подключение'},503);}
}
export async function POST(req:Request,context:Context){
 if(!isPlatformOwner(await getCurrentUser())||!isCalculationOriginAllowed(req))return response({error:'Доступ запрещён'},403);
 try{
  const market=ajesPreviewMarket((await context.params).market);
  const preview=await previewAjesMarket(market,req.headers.get('x-real-ip')||'');
  return response({ok:true,preview,diagnostic:await readAjesPreviewDiagnostic(market),publicationReady:true});
 }catch(error){
  const reason=error instanceof Error?error.message:'';
  const message=reason==='quota_exhausted'?'Достигнут общий лимит запросов AJ System. Повторите проверку позже.':reason==='visitor_restricted'?'Поставщик отклонил подключение. Обратитесь к нему с адресом вашего подключения.':reason.startsWith('collection_disabled_by_owner')?'Для проверки включите этот источник и его рынок.':reason==='not_configured'?'Сначала настройте общий доступ AJ System в разделе Японии.':'Не удалось подтвердить доступ. Проверьте включение источника и повторите позже.';
  return response({error:message,diagnostic:error instanceof AjesPreviewError?error.diagnostic:null},503);
 }
}
