import {getCurrentUser} from '@/lib/auth';
import {assistantAllowed} from '@/lib/team-assistant/policy';
import {readHistory,mutateHistory} from '@/lib/team-assistant/store';
import {validChannel} from '@/lib/team-assistant/browser';
import {readAssistantBody} from '@/lib/team-assistant/media';
export const dynamic='force-dynamic';
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user||!assistantAllowed(user))return json({error:'Нет доступа.'},403);
 const channel=new URL(request.url).searchParams.get('channel');if(!validChannel(channel))return json({error:'Неверное соединение.'},400);
 const s=await readHistory(user.id),t=s.browserTurn;
 return json(t&&t.channel===channel&&t.lease===s.lease&&t.expires>Date.now()&&t.input?{turn:{id:t.id,input:t.input}}:{turn:null});
}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(!origin||!['https://avtocena.com','https://www.avtocena.com',new URL(request.url).origin].includes(origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Недопустимый источник.'},403);
 const user=await getCurrentUser();if(!user||!assistantAllowed(user))return json({error:'Нет доступа.'},403);
 try{
  const b=await readAssistantBody(request);if(!validChannel(b.channel)||!validChannel(b.id)||typeof b.text!=='string'||b.text.length>100000||typeof b.error!=='string'||b.error.length>240)throw Error();
  await mutateHistory(user.id,s=>{const t=s.browserTurn;if(!t||t.channel!==b.channel||t.id!==b.id||t.lease!==s.lease||t.expires<Date.now()||!t.input)throw Error();return {...s,browserTurn:{...t,input:undefined,text:b.text,error:b.error}};});
  return json({ok:true});
 }catch{return json({error:'Ответ устарел или соединение закрыто.'},409);}
}
