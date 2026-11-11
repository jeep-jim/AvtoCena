import {randomUUID} from 'node:crypto';
import {readHistory,mutateHistory} from './store';
export type BrowserTurn={channel:string;id:string;lease:string;expires:number;input?:unknown[];text?:string;error?:string};
export const validChannel=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
export function browserReply(user:string,channel:string,lease:string){return async(input:unknown[],signal:AbortSignal)=>{
 const id=randomUUID();
 await mutateHistory(user,s=>{if(s.lease!==lease)throw Error('Переписка обновилась.');return {...s,browserTurn:{channel,id,lease,expires:Date.now()+110000,input}};});
 try{while(true){
  signal.throwIfAborted();const s=await readHistory(user),t=s.browserTurn;
  if(s.lease!==lease||!t||t.id!==id)throw Error('Соединение с вкладкой прервано. Подключитесь заново.');
  if(t.error)throw Error(t.error);if(t.text!==undefined)return {text:t.text,sources:[]};
  if(t.expires<Date.now())throw Error('Вкладка ChatGPT не ответила. Проверьте её и подключитесь заново.');
  await new Promise(r=>setTimeout(r,700));
 }}finally{await mutateHistory(user,s=>s.browserTurn?.id===id?{...s,browserTurn:undefined}:s);}
};}
