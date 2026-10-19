import {createHash} from 'node:crypto';
import {readAutobotConfig,configReady} from '@/lib/autobot/config';
import {regReply} from '@/lib/autobot/provider';
import {runPublicAutobot} from '@/lib/autobot/agent';
export const dynamic='force-dynamic';export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
const limits=new Map<string,{count:number;until:number;busy:boolean}>();
export async function GET(){try{return Response.json({connected:configReady(await readAutobotConfig())},{headers});}catch{return Response.json({connected:null},{status:503,headers});}}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(!origin||!['https://avtocena.com','https://www.avtocena.com',new URL(request.url).origin].includes(origin)||request.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Откройте чат на сайте АвтоЦена.'},{status:403,headers});
 const now=Date.now();for(const [k,v] of limits)if(v.until<now&&!v.busy)limits.delete(k);
 const ip=request.headers.get('x-real-ip')||'unknown',key=createHash('sha256').update(ip).digest('hex');
 const entry=limits.get(key)||{count:0,until:now+3600000,busy:false};if(entry.busy||entry.count>=30||limits.size>=10000)return Response.json({error:'Слишком много запросов. Попробуйте позже.'},{status:429,headers});entry.busy=true;entry.count++;limits.set(key,entry);
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('Отправьте текстовый вопрос.');
  const reader=request.body?.getReader();let text='',size=0;const d=new TextDecoder();if(reader)try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.byteLength;if(size>40000)throw Error('Сообщение слишком длинное.');text+=d.decode(c.value,{stream:true});}text+=d.decode();}finally{await reader.cancel().catch(()=>{});}
  const body=JSON.parse(text);const result=await runPublicAutobot(body,request,regReply);return Response.json(result,{headers});
 }catch(e){const message=e instanceof Error?e.message:'';return Response.json({error:/^[А-ЯЁ]/.test(message)?message:'Не удалось ответить. Попробуйте ещё раз.'},{status:503,headers});}finally{entry.busy=false;}
}
