/** Only known internal conversation links can become reply destinations. Server APIs recheck access. */
export type NotificationReplyTarget = {kind:'notice';noticeId:string}|{kind:'chat';thread:string;messageId:string}|{kind:'discussion';type:'lead'|'client';id:string;messageId:string};
export function notificationReplyTarget(notice:{id:string;kind:string;href?:string;companyId?:string;entityType?:'lead'|'client';entityId?:string}):NotificationReplyTarget|undefined {
 const dealerPrefix=notice.companyId?`/dealer-cabinet/company/${encodeURIComponent(notice.companyId)}/`:'';
 const href=dealerPrefix&&notice.href?.startsWith(dealerPrefix)?notice.href.replace(dealerPrefix,'/crm/'):notice.href;
 if(!href?.startsWith('/crm/')||href.startsWith('//'))return;
 const url=new URL(href,'https://avtocena.internal');
 if(notice.kind==='staff'&&url.pathname==='/crm/chat'&&/^chat_[a-f0-9]{64}$/.test(notice.id)){
  const thread=url.searchParams.get('thread')||'';
  if(thread==='team_general'||/^team_[a-f0-9]{64}$/.test(thread))return {kind:'chat',thread,messageId:notice.id};
 }
 if(notice.kind==='comment'&&notice.entityType&&notice.entityId){
  const messageId=url.searchParams.get('message');
  const matches=notice.entityType==='lead'?url.pathname==='/crm/leads'&&url.searchParams.get('id')===notice.entityId:url.pathname===`/crm/clients/${encodeURIComponent(notice.entityId)}`;
  if(matches&&messageId&&notice.id===`comment_${notice.entityType}_${notice.entityId}_${messageId}`)return {kind:'discussion',type:notice.entityType,id:notice.entityId,messageId};
 }
}
