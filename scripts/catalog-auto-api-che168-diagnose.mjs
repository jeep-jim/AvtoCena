import {autoApiChe168Client, autoApiPage} from './lib/auto-api-che168-client.mjs';
import {autoApiChe168RejectionReason} from '../apps/web/lib/catalog/auto-api-che168.ts';

// Read-only bounded inspection. Never log the response body, contacts or credentials.
const request=autoApiChe168Client({apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+12*60000});
let pages=0,rows=0,rejected=0,page=1;
const reasons={};
while(page!==null && pages<250 && rejected<10){
 const result=autoApiPage(await request('offers',{page,year_from:2020}),page);
 for(const row of result.items){
  rows++;const reason=autoApiChe168RejectionReason(row);if(!reason)continue;
  rejected++;reasons[reason]=(reasons[reason]||0)+1;
  const safeId=/^\d+$/.test(String(row?.inner_id))?String(row.inner_id):null;
  let sourcePath=null;try{const u=new URL(row?.data?.url);if(u.hostname==='www.che168.com')sourcePath=u.pathname.replace(/[^a-zA-Z0-9/._-]/g,'').slice(0,180);}catch{}
  console.log(JSON.stringify({reason,innerId:safeId,sourcePath,hasMake:!!row?.data?.mark,hasModel:!!row?.data?.model,year:typeof row?.data?.year==='number'?row.data.year:null,hasPositivePrice:Number(row?.data?.price)>0}));
 }
 pages++;page=result.next;
}
console.log(JSON.stringify({diagnosticComplete:true,pages,rows,rejected,reasons,productionWrites:false}));
