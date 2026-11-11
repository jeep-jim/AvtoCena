/** Foundation for client accounts. Inputs must be loaded by the server, never
 * taken from a review submission. No public review-writing endpoint exists yet. */
export type ReviewClientLink = {userId:string;clientId:string;verifiedAt:string};
export type ReviewLead = {id:string;clientId:string;dealerId:string;source:'avtocena';archived?:boolean};
export type ReviewContractConfirmation = {contractId:string;leadId:string;clientId:string;dealerId:string;confirmedBy:string;confirmedAt:string;revokedAt?:string};
export type DealerReview = {id:string;userId:string;dealerId:string;leadId:string;contractId:string;rating:number;text:string;createdAt:string;status:'pending'|'published'|'hidden'};
export function canReviewDealer(userId:string,dealerId:string,link:ReviewClientLink|null,lead:ReviewLead|null,confirmation:ReviewContractConfirmation|null,existing:DealerReview[]) {
 if(!userId||!dealerId||!link||link.userId!==userId||!link.clientId||!Number.isFinite(Date.parse(link.verifiedAt)))return false;
 if(!lead?.id||lead.source!=='avtocena'||lead.archived||lead.clientId!==link.clientId||lead.dealerId!==dealerId)return false;
 if(!confirmation?.contractId||confirmation.leadId!==lead.id||confirmation.clientId!==link.clientId||confirmation.dealerId!==dealerId||!confirmation.confirmedBy||!Number.isFinite(Date.parse(confirmation.confirmedAt))||confirmation.revokedAt)return false;
 // A hidden or pending review still owns the same confirmed application.
 return !existing.some(r=>r.leadId===lead.id);
}
export function normalizeReviewInput(rating:unknown,text:unknown){
 if(typeof rating!=='number'||!Number.isFinite(rating)||!Number.isInteger(rating*10)||rating<1||rating>5)throw Error('Выберите оценку от 1 до 5');
 if(typeof text!=='string'||text.trim().length<10||text.trim().length>3000)throw Error('Отзыв должен содержать от 10 до 3000 символов');
 return {rating,text:text.trim()};
}
export function dealerReviewSummary(reviews:DealerReview[],dealerId:string){
 const published=reviews.filter(r=>r.dealerId===dealerId&&r.status==='published'&&Number.isFinite(r.rating)&&Number.isInteger(r.rating*10)&&r.rating>=1&&r.rating<=5);
 return {count:published.length,rating:published.length?Math.round(published.reduce((sum,r)=>sum+r.rating,0)/published.length*10)/10:null};
}
