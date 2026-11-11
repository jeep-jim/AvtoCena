export const LEAD_COLUMNS = [
 {id:'new',title:'Новые заявки',statuses:['new','assigned']},
 {id:'work',title:'В работе',statuses:['contacted','qualified','selection','offer_sent','negotiation','contract_sent']},
 {id:'deferred',title:'Отложенный спрос',statuses:['deferred']},
 {id:'signed',title:'Договор и доставка',statuses:['contract_signed','paid','in_progress']},
 {id:'done',title:'Завершены',statuses:['delivered','completed']},
 {id:'closed',title:'Отказ / спам / дубль',statuses:['rejected','spam','duplicate']},
];
export function leadColumn(status?:string){return LEAD_COLUMNS.find(c=>c.statuses.includes(status||'new'))?.id||'new';}
