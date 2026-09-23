import crypto from 'node:crypto';
import {readDataJson,writeDataJson,readChunkedDataJson} from './data';
export const METRIKA_COUNTER_ID=112098062;
export const METRIKA_GOALS={lead_submitted:'Заявка отправлена',crm_qualified:'Квалифицированный лид',crm_contract:'Договор / оплата',crm_spam:'Спам'};
const CONFIG='integrations/metrika/config.json';
const STATE='integrations/metrika/state.json';
type Config={enabled:boolean;encryptedToken:string;timeZone:string;connectedAt:string};
type State={sent:Record<string,string>;lastAcceptedAt?:string;lastUploadId?:string;lastError?:string;pending?:number;missingClientId?:number};
const emptyState=():State=>({sent:{}});
function key() {const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!secret)throw Error('encryption_not_configured');return crypto.createHash('sha256').update('metrika:'+secret).digest();}
export function encryptMetrikaToken(token:string) {const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const body=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(x=>x.toString('base64')).join('.');}
export function decryptMetrikaToken(token:string) {const [iv,tag,body]=token.split('.').map(x=>Buffer.from(x,'base64'));const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}
async function api(token:string,path:string,init:RequestInit={},send:typeof fetch=fetch) {
 const response=await send(`https://api-metrika.yandex.net${path}`,{...init,headers:{...init.headers,Authorization:`OAuth ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`metrika_http_${response.status}`);
 return response.json();
}
export async function connectMetrika(token:string,send:typeof fetch=fetch) {
 if(!/^[A-Za-z0-9_.-]{20,2048}$/.test(token))throw Error('invalid_token');
 const encryptedToken=encryptMetrikaToken(token);
 const info=await api(token,`/management/v1/counter/${METRIKA_COUNTER_ID}`,{},send);
 const timeZone=info.counter?.time_zone_name;
 if(!timeZone)throw Error('counter_timezone_missing');
 new Intl.DateTimeFormat('en',{timeZone}).format(new Date());
 const current=await api(token,`/management/v1/counter/${METRIKA_COUNTER_ID}/goals`,{},send);
 for(const [id,name] of Object.entries(METRIKA_GOALS)) {
  const exists=current.goals?.some((goal:any)=>goal.type==='action'&&goal.conditions?.some((c:any)=>c.type==='exact'&&c.url===id));
  if(!exists)await api(token,`/management/v1/counter/${METRIKA_COUNTER_ID}/goals`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({goal:{name,type:'action',conditions:[{type:'exact',url:id}]}})},send);
 }
 await writeDataJson(CONFIG,{enabled:true,encryptedToken,timeZone,connectedAt:new Date().toISOString()} satisfies Config);
}
export async function disableMetrika() {const config=await readDataJson<Config|null>(CONFIG,null);if(config)await writeDataJson(CONFIG,{...config,enabled:false});}
export async function metrikaStatus() {
 const config=await readDataJson<Config|null>(CONFIG,null);const state=await readDataJson<State>(STATE,emptyState());
 return {counterId:METRIKA_COUNTER_ID,enabled:Boolean(config?.enabled),connectedAt:config?.connectedAt||null,timeZone:config?.timeZone||null,lastAcceptedAt:state.lastAcceptedAt||null,lastUploadId:state.lastUploadId||null,lastError:state.lastError||null,pending:state.pending||0,missingClientId:state.missingClientId||0,acceptedOrders:Object.keys(state.sent).length};
}
export function metrikaOrder(lead:any,timeZone:string) {
 const clientId=String(lead.metrikaClientId||lead.attribution?.metrikaClientId||'');
 if(!/^\d{1,32}$/.test(clientId)||!lead.id||!Number.isFinite(Date.parse(lead.createdAt)))return null;
 const history=new Set([lead.status,...(lead.statusHistory||[]).map((x:any)=>x.status)]);
 const goals:string[]=[];
 if(lead.status==='spam')goals.push('crm_spam');
 else {
  if(history.has('qualified'))goals.push('crm_qualified');
  if(history.has('contract_signed')||history.has('paid'))goals.push('crm_contract');
 }
 const status=lead.status==='spam'?'SPAM':['rejected','duplicate'].includes(lead.status)?'CANCELLED':history.has('paid')?'PAID':'IN_PROGRESS';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(lead.createdAt)).map(p=>[p.type,p.value]));
 return {id:String(lead.id),create_date_time:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,client_uniq_id:String(lead.clientId||lead.id),client_ids:clientId,order_status:status,goals:goals.join(','),currency:'RUB'};
}
export function metrikaCsv(orders:NonNullable<ReturnType<typeof metrikaOrder>>[]) {
 const columns=['id','create_date_time','client_uniq_id','client_ids','order_status','goals','currency'] as const;
 const quote=(value:string)=>`"${value.replace(/"/g,'""')}"`;
 return columns.join(',')+'\n'+orders.map(order=>columns.map(c=>quote(order[c])).join(',')).join('\n');
}
/** Runs in a single serialized GitHub worker. SAVE + stable CRM id makes retries idempotent. */
export async function flushMetrika(send:typeof fetch=fetch) {
 const config=await readDataJson<Config|null>(CONFIG,null);if(!config?.enabled)return {enabled:false};
 const state=await readDataJson<State>(STATE,emptyState());
 try {
  const leads=await readChunkedDataJson<any>('leads/leads.json',[]);
  const pending:Array<{order:NonNullable<ReturnType<typeof metrikaOrder>>;hash:string}>=[];
  let missingClientId=0;
  for(const lead of leads) {
   if(lead.archivedAt)continue;
   const age=(Date.now()-Date.parse(lead.createdAt))/86400000;
   if(!Number.isFinite(age)||age<0||age>(state.sent[lead.id]?111:21))continue;
   const order=metrikaOrder(lead,config.timeZone);if(!order){missingClientId++;continue;}
   const hash=crypto.createHash('sha256').update(JSON.stringify(order)).digest('hex');
   if(state.sent[order.id]!==hash)pending.push({order,hash});
  }
  state.pending=pending.length;state.missingClientId=missingClientId;
  if(!pending.length){state.lastError='';await writeDataJson(STATE,state);return {enabled:true,pending:0,missingClientId};}
  const batch=pending.slice(0,200);const form=new FormData();form.append('file',new Blob([metrikaCsv(batch.map(x=>x.order))],{type:'text/csv'}),'crm-orders.csv');
  const result=await api(decryptMetrikaToken(config.encryptedToken),`/cdp/api/v1/counter/${METRIKA_COUNTER_ID}/data/simple_orders?merge_mode=SAVE&delimiter_type=COMMA`,{method:'POST',body:form},send);
  if(result.uploading?.api_validation_status!=='PASSED'||!result.uploading?.uploading_id)throw Error('metrika_upload_not_validated');
  for(const {order,hash} of batch)state.sent[order.id]=hash;
  state.lastAcceptedAt=new Date().toISOString();state.lastUploadId=String(result.uploading.uploading_id);state.lastError='';state.pending-=batch.length;
  await writeDataJson(STATE,state);
  return {enabled:true,accepted:batch.length,pending:state.pending,uploadId:state.lastUploadId,missingClientId};
 } catch(error) {
  // Never store/log raw API responses, request bodies or OAuth credentials.
  state.lastError=error instanceof Error&&/^metrika_[a-z_0-9]+$/.test(error.message)?error.message:'metrika_delivery_failed';
  await writeDataJson(STATE,state);return {enabled:true,error:state.lastError};
 }
}
