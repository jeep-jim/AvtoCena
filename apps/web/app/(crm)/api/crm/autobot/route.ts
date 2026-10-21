import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readAutobotConfig,saveAutobotConfig,publicConfig} from '@/lib/autobot/config';
import {budgetStatus} from '@/lib/autobot/budget';
import {regReply} from '@/lib/autobot/provider';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){if(!isPlatformOwner(await getCurrentUser()))return Response.json({error:'Доступно владельцу.'},{status:403,headers});try{return Response.json({config:publicConfig(await readAutobotConfig()),usage:await budgetStatus()},{headers});}catch{return Response.json({error:'Не удалось прочитать настройки.'},{status:503,headers});}}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(!origin||!['https://avtocena.com','https://www.avtocena.com',new URL(request.url).origin].includes(origin)||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Недопустимый источник запроса.'},{status:403,headers});
 if(!isPlatformOwner(await getCurrentUser()))return Response.json({error:'Доступно владельцу.'},{status:403,headers});
 try{const raw=await request.text();if(raw.length>12000)throw Error('Слишком большой запрос.');const body=JSON.parse(raw);if(body.op==='test'){const r=await regReply([{role:'user',content:'Ответь только: АвтоБот на связи.'}],AbortSignal.timeout(30000));return Response.json({reply:r.text,usage:await budgetStatus()},{headers});}await saveAutobotConfig(body);return Response.json({ok:true},{headers});}catch(e){return Response.json({error:e instanceof Error&&/^[А-ЯЁ]/.test(e.message)?e.message:'Не удалось сохранить настройки.'},{status:400,headers});}
}
