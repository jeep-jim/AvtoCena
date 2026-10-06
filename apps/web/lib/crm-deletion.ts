import {createHash} from 'node:crypto';
import type {AuthUser} from './auth';
import {hasCrmPermission} from './crm-permissions';
import {canSeeLead} from './crm-visibility';
import {readChunkedDataJson,deleteChunkedDataJson} from './data';
import {hasStoredContractForClient} from './contracts/store';
import {recordCrmActivity} from './crm-activity';
export type DeletionKind='client'|'lead';
const pathFor=(kind:DeletionKind)=>kind==='client'?'clients/clients.json':'leads/leads.json';
export const deletionRevision=(record:unknown)=>createHash('sha256').update(JSON.stringify(record)).digest('hex');
export async function deletionPreview(actor:AuthUser,kind:DeletionKind,id:string){
 if(!hasCrmPermission(actor,'deleteRecords'))throw Error('delete_forbidden');
 const record=(await readChunkedDataJson<any>(pathFor(kind),[])).find(r=>r.id===id);
 if(!record)throw Error('delete_not_found');
 if(!canSeeLead(actor,record))throw Error('delete_forbidden');
 const clientId=kind==='client'?id:record.clientId;
 const [leads,contracts,deals,accruals]=await Promise.all([
  readChunkedDataJson<any>('leads/leads.json',[]),hasStoredContractForClient(clientId||''),
  readChunkedDataJson<any>('deals/deals.json',[]),readChunkedDataJson<any>('partners/accruals.json',[]),
 ]);
 const blockers:string[]=[];
 if(record.source==='privacy_request')blockers.push('Это обращение по персональным данным. Сначала рассмотрите требование; для завершённых обращений используйте архив.');
 if(kind==='client'&&leads.some(l=>l.clientId===id))blockers.push('У клиента есть заявки. Сначала удалите ненужные заявки отдельно.');
 if(kind==='client'&&record.documents?.length)blockers.push('У клиента есть документы, в том числе в архиве. Сначала разберите документы.');
 if(contracts)blockers.push('С клиентом связан договор. Удаление заблокировано, пока договор хранится в CRM.');
 if(deals.some(r=>kind==='lead'?r.leadId===id:r.clientId===id)||accruals.some(r=>kind==='lead'?r.leadId===id:r.clientId===id)
)blockers.push('Есть сделка, подписанный договор или финансовое начисление. Используйте архив.');
 const requiresTestConfirmation=kind==='lead'&&[record.status,...(record.statusHistory||[]).map((h:any)=>h.status)].some(s=>['contract_signed','paid'].includes(s));
 return {requiresTestConfirmation,id,label:kind==='client'?record.fio||record.phone||'Клиент':record.name||record.car||'Заявка',revision:deletionRevision(record),blockers};
}
export async function deleteCrmRecord(actor:AuthUser,kind:DeletionKind,id:string,revision:string,confirmTestRecord=false){
 const preview=await deletionPreview(actor,kind,id);
 if(preview.blockers.length||(preview.requiresTestConfirmation&&!confirmTestRecord))throw Error('delete_linked');
 if(preview.revision!==revision)throw Error('delete_conflict');
 const deleted=await deleteChunkedDataJson<any>(pathFor(kind),id,record=>{
  if(!canSeeLead(actor,record))throw Error('delete_forbidden');
  if(deletionRevision(record)!==revision)throw Error('delete_conflict');
 });
 if(!deleted)throw Error('delete_not_found');
 await recordCrmActivity(actor,{id:`${kind}_deleted_${id}`,type:`${kind}_deleted`,title:kind==='client'?'Удалён клиент':confirmTestRecord?'Удалена тестовая заявка':'Удалена заявка',entityType:kind,entityId:id,entityLabel:`№ ${id}`,href:kind==='client'?'/crm/clients':'/crm/leads',visibility:'management'});
 return {ok:true};
}
