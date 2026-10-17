import {createHash,randomBytes,randomUUID,scryptSync,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {readDataJson,mutateDataJson} from '../data';
import type {AssistantState,AssistantAction} from './types';
type Envelope={encrypted:string};
const root='crm/team-assistant/';
const uid=(id:string)=>createHash('sha256').update(id).digest('hex');
const historyKey=(id:string)=>root+'histories/'+uid(id)+'.json';
function key(){const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!secret)throw Error('Хранение переписки ещё не настроено.');return createHash('sha256').update('team-assistant-v1:'+secret).digest();}
function seal(value:unknown,context:string):Envelope{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(context));const b=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return {encrypted:Buffer.concat([iv,c.getAuthTag(),b]).toString('base64')};}
function open<T>(value:Envelope|null,context:string,fallback:T):T{if(!value)return fallback;const b=Buffer.from(value.encrypted,'base64'),c=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));c.setAAD(Buffer.from(context));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString());}
export async function readHistory(id:string){const k=historyKey(id);return open(await readDataJson<Envelope|null>(k,null),k,{messages:[],revision:0} as AssistantState);}
export async function mutateHistory(id:string,fn:(s:AssistantState)=>AssistantState){const k=historyKey(id);return open(await mutateDataJson<Envelope|null>(k,null,e=>seal(fn(open(e,k,{messages:[],revision:0})),k)),k,{messages:[],revision:0} as AssistantState);}
export async function lockHistory(id:string,revision:number){const lease=randomUUID(),now=Date.now();await mutateHistory(id,s=>{
 if((s.busyUntil||0)>now)throw Error('Дождитесь окончания текущего ответа.');
 if(s.revision!==revision)throw Error('Переписка обновилась в другом окне. Откройте помощника заново.');
 const currentWindow=Math.floor(now/3600000),count=s.window===currentWindow?s.count||0:0;
 if(count>=40)throw Error('Достигнут лимит 40 запросов в час. Попробуйте позже.');
 return {...s,lease,busyUntil:now+150000,window:currentWindow,count:count+1};});return lease;}
export async function unlockHistory(id:string,lease:string){await mutateHistory(id,s=>s.lease===lease?{...s,busyUntil:0,lease:undefined}:s);}
type Settings={phraseHash:string;phraseSalt:string;updatedAt?:string};
// Initial phrase is owner's requested value; only its one-way digest is present in the repository.
const initial:Settings={phraseSalt:'avtocena-team-assistant-initial-v1',phraseHash:'5dcfb7170aefd1fe516959ffda2a252cfb497e0f0ff5e0b9c88fa5f0e4a4e08f'};
export async function checkPhrase(value:string){const s=await readDataJson<Settings>(root+'settings.json',initial);const candidate=scryptSync(value.normalize('NFC').trim(),s.phraseSalt,32);return timingSafeEqual(candidate,Buffer.from(s.phraseHash,'hex'));}
export async function changePhrase(value:string){if(value.trim().length<8||value.length>120)throw Error('Кодовая фраза должна содержать от 8 до 120 символов.');const salt=randomBytes(24).toString('hex');await mutateDataJson(root+'settings.json',initial,()=>({phraseSalt:salt,phraseHash:scryptSync(value.normalize('NFC').trim(),salt,32).toString('hex'),updatedAt:new Date().toISOString()}));}
export type Pending={action:AssistantAction;createdAt:number;state:'ready'|'working'|'done';base?:string;url?:string};
const pendingKey=(user:string,id:string)=>root+'actions/'+uid(user)+'.json';
export async function savePending(user:string,p:Pending){const k=pendingKey(user,p.action.id);await mutateDataJson<Envelope|null>(k,null,e=>{const rows=open<Record<string,Pending>>(e,k,{});return seal({...Object.fromEntries(Object.entries(rows).filter(([,v])=>Date.now()-v.createdAt<3600000).slice(-15)),[p.action.id]:p},k);});}
export async function mutatePending(user:string,id:string,fn:(p:Pending)=>Pending){const k=pendingKey(user,id);let result:Pending|undefined;await mutateDataJson<Envelope|null>(k,null,e=>{const rows=open<Record<string,Pending>>(e,k,{}),p=rows[id];if(!p||Date.now()-p.createdAt>15*60000)throw Error('Предложение устарело. Попросите помощника подготовить его заново.');result=fn(p);return seal({...rows,[id]:result},k);});return result!;}
