export type CustomerNotice={id:string;title:string;text:string;at:string;href:string};
export function customerNotices(clients:any[]):CustomerNotice[]{return clients.flatMap(c=>[
 ...c.leads.filter((l:any)=>!c.messages.some((m:any)=>m.system&&m.leadId===l.id&&m.eventKind==='status')).map((l:any)=>({id:'lead:'+l.id+':'+l.updatedAt+':'+l.status,title:l.title,text:l.status,at:l.updatedAt,href:'/account'})),
 ...c.leads.filter((l:any)=>l.canReview).map((l:any)=>({id:'review:'+l.id+':'+(l.reviewAvailableAt||l.updatedAt),title:'Можно оставить отзыв',text:'Подписанный договор подтверждён. Оцените работу дилера.',at:l.reviewAvailableAt||l.updatedAt,href:'/account?tab=reviews'})),
 ...c.documents.filter((d:any)=>!c.messages.some((m:any)=>m.documentId===d.id&&m.eventKind==='document')).map((d:any)=>({id:'document:'+d.id,title:'Добавлен документ',text:d.name,at:d.createdAt,href:'/account?tab=documents'})),
 ...c.messages.filter((m:any)=>!m.mine).map((m:any)=>({id:'message:'+m.id,title:m.author,text:m.text,at:m.createdAt,href:'/account?tab=chat'}))
 ]).filter(n=>n.at&&Number.isFinite(Date.parse(n.at))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,50);}
