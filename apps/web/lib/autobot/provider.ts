import {readAutobotConfig,configReady,validateEndpoint} from './config';
import {reserveBudget,settleBudget} from './budget';
export async function regReply(input:any[],signal:AbortSignal){return providerReply(input,signal,false);}
export async function regSearch(input:any[],signal:AbortSignal){return providerReply(input,signal,true);}
async function providerReply(input:any[],signal:AbortSignal,search:boolean){
 const stored=await readAutobotConfig();
 const c=search?{...stored,model:"sonar",inputRate:220.68,outputRate:220.68}:stored;if(!configReady(c))throw Error('АвтоБот пока недоступен. Подберите автомобиль в каталоге или оставьте заявку.');
 const messages=input.map(m=>{if(typeof m.content!=='string')throw Error('Анализ вложений для этого подключения ещё не включён. Отправьте текст.');return {role:m.role,content:m.content};});
 const bytes=Buffer.byteLength(JSON.stringify(messages));if(bytes>80000)throw Error('Диалог получился слишком длинным. Начните новый разговор.');
 // Sonar: reserve its full advertised 127K context plus a 10 RUB search-fee buffer.
 // The buffer is conservative budget accounting, not a claimed provider tariff.
 // One UTF-8 byte per token is a conservative bound, plus role/template overhead.
 const maxTokens=search?2500:3600,upper=(search?10:0)+((search?127000:bytes+4096)*c.inputRate+maxTokens*c.outputRate)/1e6;
 const ticket=await reserveBudget(upper,c.monthlyLimit);let cost:number|undefined;
 try{
  const r=await fetch(validateEndpoint(c.endpoint),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify({model:c.model,messages,stream:false,max_tokens:maxTokens,temperature:0.3})});
  if(!r.ok)throw Error(r.status===429?'АвтоБот сейчас занят. Попробуйте чуть позже.':'Не удалось получить ответ. Попробуйте позже или оставьте заявку.');
  const reader=r.body?.getReader();if(!reader)throw Error('Ответ не получен.');let raw='',size=0;const decoder=new TextDecoder();try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>256000)throw Error('Ответ слишком большой. Уточните вопрос.');raw+=decoder.decode(x.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(raw),u=data.usage;
  if(Number.isInteger(u?.prompt_tokens)&&u.prompt_tokens>=0&&Number.isInteger(u?.completion_tokens)&&u.completion_tokens>=0)cost=(u.prompt_tokens*c.inputRate+u.completion_tokens*c.outputRate)/1e6+(search?10:0);
  const choice=data.choices?.[0];if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw Error('Ответ не завершён. Уточните вопрос и попробуйте снова.');
  const metadata=choice.message.provider_specific_fields||data.provider_specific_fields||{};
  const found=search?[...(Array.isArray(metadata.search_results)?metadata.search_results:[]),...(Array.isArray(metadata.citations)?metadata.citations:[]).map((url:string)=>({url})),...(Array.isArray(choice.message.annotations)?choice.message.annotations:[]).map((a:any)=>a.url_citation||a),...(Array.isArray(data.search_results)?data.search_results:[]),...(Array.isArray(data.citations)?data.citations:[]).map((url:string)=>({url}))]:[];
  const sources:{title:string;url:string}[]=[];for(const row of found){try{const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password||u.port)continue;if(!sources.some(s=>s.url===u.href))sources.push({title:String(row.title||u.hostname).slice(0,180),url:u.href});}catch{}}
  const text=search?choice.message.content.replace(/\[(\d+)\]/g,(all:string,n:string)=>{const url=data.citations?.[Number(n)-1];return sources.some(s=>s.url===url)?'['+n+']('+url+')':all;}):choice.message.content;
  const linkCandidates=search?[...text.matchAll(/\[([^\]]{1,180})\]\((https:\/\/[^\s)]+)\)/g)].slice(0,4).map(m=>({title:m[1],url:m[2]})):[];
  return {text,sources:sources.slice(0,8),linkCandidates};
 }finally{await settleBudget(ticket,cost);}
}
