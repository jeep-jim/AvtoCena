import defaults from './default-templates.json';
import {randomUUID} from 'node:crypto';
import {appendChunkedDataJson,getJsonStorage,mutateDataJson,readChunkedDataJson,readDataJson} from '../data';
import {encryptClientDocument,decryptClientDocument} from '../client-documents';
import {canSeeLead} from '../crm-visibility';
import type {AuthUser} from '../auth';
import {initialFields,today,type ContractRecord,type ContractTemplate,type TemplateId} from './model';
type Index={id:string;createdBy:string;createdAt:string};
type Envelope={encrypted:string};
const key=(id:string)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Договор не найден.');return `contracts/records/${id}.json`;};
const seal=(r:ContractRecord):Envelope=>({encrypted:encryptClientDocument(Buffer.from(JSON.stringify(r)),key(r.id)).toString('base64')});
const open=(id:string,e:Envelope):ContractRecord=>JSON.parse(decryptClientDocument(Buffer.from(e.encrypted,'base64'),key(id)).toString());
export async function accessibleClient(user:AuthUser,id:string){if(!id)return null;const c=(await readChunkedDataJson<any>('clients/clients.json',[])).find(c=>c.id===id);if(!c||!canSeeLead(user,c))throw Error('Нет доступа к клиенту.');return c;}
export async function getContract(user:AuthUser,id:string){const e=await readDataJson<Envelope|null>(key(id),null);if(!e)throw Error('Договор не найден.');const r=open(id,e);if(!['owner','admin'].includes(user.role)&&r.createdBy!==user.id)throw Error('Нет доступа к договору.');if(r.clientId)await accessibleClient(user,r.clientId);return r;}
export async function listContracts(user:AuthUser){
 const items=await readChunkedDataJson<Index>('contracts/index.json',[]);
 const admin=['owner','admin'].includes(user.role);
 const clients=await readChunkedDataJson<any>('clients/clients.json',[]);
 const visibleClients=new Set(clients.filter(c=>canSeeLead(user,c)).map(c=>c.id));
 const eligible=items.filter(i=>admin||i.createdBy===user.id),result=[];
 for(let i=0;i<eligible.length;i+=8){const batch=await Promise.all(eligible.slice(i,i+8).map(async item=>{
  const encrypted=await readDataJson<Envelope|null>(key(item.id),null);if(!encrypted)return null;
  const r=open(item.id,encrypted);if((!admin&&r.createdBy!==user.id)||(r.clientId&&!visibleClients.has(r.clientId)))return null;
  return {id:r.id,number:r.number,client:r.fields.fio||'Без клиента',car:r.fields.car||'',updatedAt:r.updatedAt,versions:r.versions.length};
 }));result.push(...batch.filter((r):r is NonNullable<typeof r>=>r!==null));}
 return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
const templateKey=(id:TemplateId)=>{if(!['japan','other'].includes(id))throw Error('Шаблон не найден.');return `contracts/builder-templates/${id}.json`;};
function decodeTemplate(id:TemplateId,e:Envelope|null):ContractTemplate{return e?JSON.parse(decryptClientDocument(Buffer.from(e.encrypted,'base64'),templateKey(id)).toString()):defaultTemplate(id);}
export async function getTemplate(id:TemplateId){return decodeTemplate(id,await readDataJson<Envelope|null>(templateKey(id),null));}
export async function saveTemplate(t:ContractTemplate,expected:number){const saved=await mutateDataJson<Envelope|null>(templateKey(t.id),null,e=>{const current=decodeTemplate(t.id,e);if(current.revision!==expected)throw Error('Шаблон уже изменён. Откройте его заново.');return {encrypted:encryptClientDocument(Buffer.from(JSON.stringify({...t,revision:current.revision+1})),templateKey(t.id)).toString('base64')};});return decodeTemplate(t.id,saved);}
export async function createContract(user:AuthUser,templateId:TemplateId,clientId:string,id:string){const k=key(id);const existing=await readDataJson<Envelope|null>(k,null);if(existing){const r=await getContract(user,id);await appendChunkedDataJson<Index>('contracts/index.json',{id:r.id,createdBy:r.createdBy,createdAt:r.createdAt});return r;}const client=await accessibleClient(user,clientId);const template=await getTemplate(templateId);const day=today();const allocation=await mutateDataJson<Record<string,number>>(`contracts/numbers/${day}.json`,{},current=>current[id]?current:{...current,[id]:Math.max(0,...Object.values(current))+1});const number=`${day.slice(8,10)}.${day.slice(5,7)}/${String(allocation[id]).padStart(2,'0')}`;const now=new Date().toISOString();const record:ContractRecord={id,revision:1,number,createdAt:now,updatedAt:now,createdBy:user.id,clientId,template,fields:{...initialFields(templateId),...(client?{fio:client.fio||'',phone:client.phone||'',deliveryCity:client.city||''}:{})},calculation:null,versions:[]};await mutateDataJson<Envelope|null>(k,null,current=>{if(current)throw Error('Договор уже создан. Откройте список документов.');return seal(record);});await appendChunkedDataJson<Index>('contracts/index.json',{id,createdBy:user.id,createdAt:now});return record;}
export async function updateContract(user:AuthUser,id:string,revision:number,update:(r:ContractRecord)=>ContractRecord){await getContract(user,id);const result=await mutateDataJson<Envelope|null>(key(id),null,current=>{if(!current)throw Error('Договор не найден.');const r=open(id,current);if(r.revision!==revision)throw Error('Договор изменён в другом окне. Откройте его заново, чтобы не затереть изменения.');const next=update(r);next.revision=r.revision+1;next.updatedAt=new Date().toISOString();return seal(next);});return open(id,result!);}

export function defaultTemplate(id:TemplateId):ContractTemplate{return structuredClone(defaults.find(t=>t.id===id)!) as ContractTemplate;}
