import {currentGameAccess,globalGameRanking} from '@/lib/pognali-access';
import {beginGame,finishGame,publicGameId,validGameMode} from '@/lib/crm-game';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 const {player:user,status}=await currentGameAccess();if(!user)return json({error:status===403?'Доступ запрещён':'Войдите в кабинет'},status);
 try{return json({team:await globalGameRanking(),playerId:publicGameId(user.id)});
 }catch{return json({error:'Рейтинг временно недоступен. Попробуйте обновить его позже.'},503);}
}
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Запрос отклонён'},403);
 const {player:user,status}=await currentGameAccess();if(!user)return json({error:status===403?'Доступ запрещён':'Войдите в кабинет'},status);
 try{
  if(Number(request.headers.get('content-length')||0)>2048)return json({error:'Слишком большой запрос'},413);
  const raw=await request.text();if(raw.length>2048)return json({error:'Слишком большой запрос'},413);
  const input=JSON.parse(raw);if(!input||typeof input!=='object')return json({error:'Проверьте результат'},400);
  if(input.action==='start'&&validGameMode(input.mode))return json({run:await beginGame(user.id,input.mode,Date.now(),{name:user.name,avatar:user.avatar})});
  if(input.action==='finish'&&typeof input.runId==='string')return json({result:await finishGame(user.id,input)});
  return json({error:'Неизвестный режим игры'},400);
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(code==='too_many_runs')return json({error:'Подождите несколько секунд перед новым заездом'},429);
  if(code==='run_expired')return json({error:'Этот заезд уже завершён или устарел. Начните новый.'},409);
  if(code==='invalid_result'||error instanceof SyntaxError)return json({error:'Не удалось подтвердить результат заезда'},400);
  return json({error:'Не удалось сохранить результат. Нажмите «Повторить сохранение».'},503);
 }
}
