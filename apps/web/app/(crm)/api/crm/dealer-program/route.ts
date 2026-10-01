import {parseDealerMail} from '@/lib/dealer-mail';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readDataJson,mutateDataJson,readChunkedDataJson,updateChunkedDataJson} from '@/lib/data';
import {readDealerProgram,saveDealerProgram,readMembership,grantDealerPeriod,startDealerTrial} from '@/lib/dealers/program-store';
import {findDealer,validDealerId} from '@/lib/dealers/showcase-store';
import {recordCrmActivity} from '@/lib/crm-activity';
export const runtime='nodejs';
export async function POST(req:Request){
 const actor=await getCurrentUser();if(!actor||!isPlatformOwner(actor)||!isCalculationOriginAllowed(req))return Response.json({error:'Доступ только владельцу платформы'},{status:403});
 try{
  const raw=await req.text();if(raw.length>30000)return Response.json({error:'Слишком много данных'},{status:413});const b=JSON.parse(raw);let result:unknown={ok:true};
  if(b.action==='program')result=await saveDealerProgram(b.value);
  else if(b.action==='create'){
   const name=String(b.name||'').trim().slice(0,120),city=String(b.city||'').trim().slice(0,120);if(!name||!city)throw Error('Укажите название и город');
   const id=`dealer_${crypto.randomUUID()}`;await mutateDataJson<any[]>('dealers/dealers.json',[],rows=>[...(rows.length?rows:[{id:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',status:'verified',pilot:true}]),{id,name,city,status:'active',markets:[],createdAt:new Date().toISOString(),createdBy:actor.id}]);result={id};
  }else if(b.action==='application'){
   if(!['new','contacted','approved','rejected'].includes(b.status))throw Error('Неверный статус');const updated=await updateChunkedDataJson<any>('dealers/applications.json',String(b.id),row=>({...row,status:b.status,note:String(b.note||'').slice(0,1000),updatedAt:new Date().toISOString(),updatedBy:actor.id}));if(!updated)throw Error('Заявка не найдена');result=updated;
  }else{
   const id=String(b.dealerId||'');if(!validDealerId(id)||!await findDealer(id))throw Error('Компания не найдена');
   if(b.action==='membership')result=await grantDealerPeriod(id,b,actor.id);
   else if(b.action==='trial'){await startDealerTrial(id);result=await readMembership(id);}
   else if(b.action==='company'){
    if(!['active','verified','paused'].includes(b.status))throw Error('Неверный статус');if(id==='dealer_topavto'&&b.status!=='verified')throw Error('ТопАвто — компания платформы');
    const mailForm=new FormData();if(b.mail){mailForm.set('mailEmail',String(b.mail.email||''));mailForm.set('mailProvider',String(b.mail.provider||''));if(b.mail.ready===true)mailForm.set('mailReady','on');}const mail=parseDealerMail(mailForm);
    await mutateDataJson<any[]>('dealers/dealers.json',[],rows=>(rows.length?rows:[{id:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',status:'verified',pilot:true}]).map(d=>d.id===id?{...d,status:b.status,telegramChannel:String(b.telegramChannel||'').trim().slice(0,100),...(mail?{mail}:{}),updatedAt:new Date().toISOString()}:d));
    if(b.status==='verified')await startDealerTrial(id);result={membership:await readMembership(id)};
   }else if(b.action==='sale'){
    const leads=await readChunkedDataJson<any>('leads/leads.json',[]),lead=leads.find(l=>l.id===b.leadId&&!l.archivedAt&&l.status==='completed'&&(l.requestedDealerId===id||l.dealerId===id));
    if(!lead)throw Error('Укажите завершённую заявку АвтоЦены, относящуюся к этому дилеру');
    const amount=Number(b.amountRub);if(!Number.isFinite(amount)||amount<=0||amount>1e9)throw Error('Укажите подтверждённую сумму сделки');
    const p=await readDealerProgram();await mutateDataJson<any[]>('dealers/sales.json',[],rows=>{if(rows.some(r=>r.leadId===b.leadId))throw Error('Комиссия по этой заявке уже учтена');return [...rows,{id:crypto.randomUUID(),dealerId:id,leadId:b.leadId,amountRub:amount,basis:p.commissionBasis,percent:p.commissionPercent,commissionRub:Math.round(amount*p.commissionPercent/100),status:'accrued',createdAt:new Date().toISOString(),createdBy:actor.id}];});
   }else if(b.action==='settle'){
    await mutateDataJson<any[]>('dealers/sales.json',[],rows=>rows.map(r=>r.id===b.saleId&&r.dealerId===id?{...r,status:'paid',paidAt:new Date().toISOString(),paidBy:actor.id}:r));
   }else throw Error('Неизвестное действие');
  }
  await recordCrmActivity(actor,{type:'dealer_updated',title:'Изменены настройки дилерской программы',visibility:'management',entityType:'dealer',entityId:b.dealerId||'',href:'/crm/dealers',text:String(b.action)});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить'},{status:400});}
}
