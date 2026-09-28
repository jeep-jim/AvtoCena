import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {readCrmUsers} from '@/lib/crm-users';
import {beginGame,finishGame,gameBest,validGameMode} from '@/lib/crm-game';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role)||user.status==='disabled')return json({error:'Войдите в CRM'},401);
 try{
  const users=(await readCrmUsers()).filter(u=>isCrmRole(u.role)&&u.status!=='disabled'&&(u.companyId||'')===(user.companyId||''));
  const team=[]; // Bounded concurrency, even for large teams.
  for(let i=0;i<users.length;i+=8)team.push(...await Promise.all(users.slice(i,i+8).map(async u=>({id:u.id,name:u.displayName,avatar:u.avatarUrl,best:await gameBest(u.id)}))));
  return json({team});
 }catch{return json({error:'Рейтинг временно недоступен. Попробуйте обновить его позже.'},503);}
}
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Запрос отклонён'},403);
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role)||user.status==='disabled')return json({error:'Войдите в CRM'},401);
 try{
  if(Number(request.headers.get('content-length')||0)>2048)return json({error:'Слишком большой запрос'},413);
  const raw=await request.text();if(raw.length>2048)return json({error:'Слишком большой запрос'},413);
  const input=JSON.parse(raw);if(!input||typeof input!=='object')return json({error:'Проверьте результат'},400);
  if(input.action==='start'&&validGameMode(input.mode))return json({run:await beginGame(user.id,input.mode)});
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
