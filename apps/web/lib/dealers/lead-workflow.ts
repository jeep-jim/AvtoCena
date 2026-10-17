import {leadDealerId} from './lead-routing';
export const CONTACT_RESULTS=['contacted','no_answer','waiting','rejected'] as const;
export function dealerLeadView(l:any,companyId:string){
 if(leadDealerId(l)!==companyId||l.archivedAt)return null;
 const open=!!l.assignedManagerId&&!!l.platformTerms?.agreementDigest;
 // Allowlist: no free text, snapshots, names or nested attachments before disclosure.
 return {id:l.id,createdAt:l.createdAt,status:l.status||'new',assignedManagerId:l.assignedManagerId||'',contactResult:l.dealerContactResult||'',title:open?(l.offerTitle||l.car||'Подбор автомобиля'):'Заявка на автомобиль',open,...(open?{name:l.name||'Клиент',phone:l.phone||'',telegram:l.telegram||'',max:l.max||'',comment:l.comment||'',clientId:l.clientId||''}:{})};
}
export function hasContactResult(l:any){return !!l.assignedManagerId&&CONTACT_RESULTS.includes(l.dealerContactResult);}
