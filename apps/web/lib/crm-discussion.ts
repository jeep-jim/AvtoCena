export type DiscussionType = 'lead'|'client';
export type DiscussionMessage = {id:string;text:string;createdAt:string;createdByUserId?:string;createdByName?:string;avatarUrl?:string;replyTo?:string};
export const discussionAnchor=(type:DiscussionType,id:string)=>`discussion-${type}-${id}`;
export function discussionHref(type:DiscussionType,id:string,messageId?:string){
 const query=new URLSearchParams(type==='lead'?{id}:{ });
 if(messageId)query.set('message',messageId);
 const path=type==='lead'?'/crm/leads':`/crm/clients/${encodeURIComponent(id)}`;
 return `${path}${query.size?'?'+query:''}#${encodeURIComponent(discussionAnchor(type,id))}`;
}
export function discussionLabel(type:DiscussionType,entity:any){
 const name=entity.fio||entity.name||'Без имени';
 const car=entity.offerTitle||entity.selectedOffers?.[0]?.title||entity.car;
 return `${type==='lead'?'Заявка':'Клиент'}: ${name}${type==='lead'&&car?` · ${car}`:''}`;
}
export function discussionMessages(entity:any):DiscussionMessage[]{
 return (Array.isArray(entity.internalNotes)?entity.internalNotes:[]).filter((n:any)=>typeof n.text==='string').map((n:any,i:number)=>({id:String(n.id||`legacy-${i}`),text:n.text,createdAt:String(n.createdAt||''),createdByUserId:n.createdByUserId,createdByName:n.createdByName||'Сотрудник',replyTo:n.replyTo}));
}
