import type {AssistantProvider} from '../../../lib/team-assistant/providers';
const source='avtocena-assistant-v1';
export async function connector(op:string,payload:Record<string,unknown>={},signal?:AbortSignal):Promise<any>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();let timer:ReturnType<typeof setTimeout>;
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);};
  const cancel=()=>{if(op==='send')window.postMessage({source,id:crypto.randomUUID(),op:'cancel',userId:payload.userId,provider:payload.provider,requestId:payload.requestId},location.origin);};
  const abort=()=>{cancel();cleanup();reject(new DOMException('Остановлено','AbortError'));};
  const receive=(e:MessageEvent)=>{if(e.source!==window||e.origin!==location.origin||e.data?.source!==source+'-reply'||e.data.id!==id)return;cleanup();e.data.ok?resolve(e.data):reject(Error(e.data.error||'Не удалось соединиться с выбранным помощником.'));};
  timer=setTimeout(()=>{cancel();cleanup();reject(Error(op==='ping'?'Для подключения установите расширение ИИ Бро.':'Нет ответа от расширения. Нажмите «Проверить соединение» в настройках помощника.'));},op==='send'?100000:op==='connect'?40000:op==='diagnose'?10000:1500);
  window.addEventListener('message',receive);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  window.postMessage({source,id,op,...payload},location.origin);
 });
}
export async function serveBrowserTurns(channel:string,userId:string,signal:AbortSignal,provider:AssistantProvider='gpt'){
 const seen=new Set<string>();
 while(!signal.aborted){
  const r=await fetch('/api/crm/assistant/browser?channel='+channel,{cache:'no-store',signal});
  if(!r.ok)throw Error('Соединение прервано. Войдите в аккаунт команды заново.');const {turn}=await r.json();
  if(turn&&!seen.has(turn.id)){
   seen.add(turn.id);let text='',error='';
   try{const result=await connector('send',{userId,provider,input:turn.input,requestId:turn.id},signal);text=result.text;}catch(e){if(signal.aborted)throw e;error=e instanceof Error?e.message.slice(0,240):'Вкладка не ответила.';}
   const sent=await fetch('/api/crm/assistant/browser',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({channel,id:turn.id,text,error})});if(!sent.ok)throw Error('Ответ не сохранён: соединение закрыто.');
  }
  await new Promise(r=>setTimeout(r,700));
 }
}
