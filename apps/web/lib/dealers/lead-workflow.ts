import {leadDealerId} from './lead-routing';
const publicOffer=(o:any)=>({id:o?.id,title:o?.title,image:o?.image,href:o?.href,marketLabel:o?.marketLabel,year:o?.year,totalRub:o?.totalRub});
export const CONTACT_RESULTS=['contacted','no_answer','waiting','rejected'] as const;
export function dealerLeadView(l:any,companyId:string,includeArchived=false){
 if(leadDealerId(l)!==companyId||(l.archivedAt&&!includeArchived))return null;
 const open=!!l.assignedManagerId&&!!l.platformTerms?.agreementDigest;
 // Allowlist: no free text, snapshots, names or nested attachments before disclosure.
 return {id:l.id,createdAt:l.createdAt,status:l.status||'new',assignedManagerId:l.assignedManagerId||'',contactResult:l.dealerContactResult||'',title:open?(l.offerTitle||l.car||'Подбор автомобиля'):'Заявка на автомобиль',open,...(open?{name:l.name||'Клиент',phone:l.phone||'',telegram:l.telegram||'',max:l.max||'',comment:l.comment||'',clientId:l.clientId||'',car:l.car||l.offerTitle||'',offerId:l.offerId,offerTitle:l.offerTitle,offerImageUrl:l.offerImageUrl,offerUrl:l.offerUrl,selectedOffers:(l.selectedOffers?.length?l.selectedOffers:l.offerSnapshot?[l.offerSnapshot]:[]).map(publicOffer),city:l.city,totalRub:l.totalRub,budgetRub:l.budgetRub,internalNotes:l.dealerInternalNotes||[],clientNotes:l.dealerClientNotes||'',vehicleNotes:l.dealerVehicleNotes||'',statusHistory:(l.dealerWorkflowHistory||[]).filter((h:any)=>h.status).map((h:any)=>({status:h.status,changedAt:h.at,changedByName:'Сотрудник компании',note:h.note})),archivedAt:l.archivedAt,archiveReason:l.archiveReason}:{})};
}
export function hasContactResult(l:any){return !!l.assignedManagerId&&CONTACT_RESULTS.includes(l.dealerContactResult);}
