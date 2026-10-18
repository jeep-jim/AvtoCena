import {readAutobotConfig,configReady,validateEndpoint} from './config';
import {reserveBudget,settleBudget} from './budget';
export async function regReply(input:any[],signal:AbortSignal){
 const c=await readAutobotConfig();if(!configReady(c))throw Error('АвтоБот пока недоступен. Подберите автомобиль в каталоге или оставьте заявку.');
 const messages=input.map(m=>{if(typeof m.content!=='string')throw Error('Анализ вложений для этого подключения ещё не включён. Отправьте текст.');return {role:m.role,content:m.content};});
 const bytes=Buffer.byteLength(JSON.stringify(messages));if(bytes>80000)throw Error('Диалог получился слишком длинным. Начните новый разговор.');
 // One UTF-8 byte per token is a conservative bound, plus role/template overhead.
 const maxTokens=3600,upper=((bytes+4096)*c.inputRate+maxTokens*c.outputRate)/1e6;
 const ticket=await reserveBudget(upper,c.monthlyLimit);let cost:number|undefined;
 try{
  const r=await fetch(validateEndpoint(c.endpoint),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.token},body:JSON.stringify({model:c.model,messages,stream:false,max_tokens:maxTokens,temperature:0.3})});
  if(!r.ok)throw Error(r.status===429?'АвтоБот сейчас занят. Попробуйте чуть позже.':'Не удалось получить ответ. Попробуйте позже или оставьте заявку.');
  const reader=r.body?.getReader();if(!reader)throw Error('Ответ не получен.');let raw='',size=0;const decoder=new TextDecoder();try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>256000)throw Error('Ответ слишком большой. Уточните вопрос.');raw+=decoder.decode(x.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(raw),u=data.usage;
  if(Number.isInteger(u?.prompt_tokens)&&u.prompt_tokens>=0&&Number.isInteger(u?.completion_tokens)&&u.completion_tokens>=0)cost=(u.prompt_tokens*c.inputRate+u.completion_tokens*c.outputRate)/1e6;
  const choice=data.choices?.[0];if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw Error('Ответ не завершён. Уточните вопрос и попробуйте снова.');
  return {text:choice.message.content,sources:[] as {title:string;url:string}[]};
 }finally{await settleBudget(ticket,cost);}
}
