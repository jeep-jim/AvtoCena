import type {CustomerAccount} from './auth';
import {recordCrmActivity} from '../crm-activity';
import {notifyTeam} from '../crm-notification-store';
import {readCrmUsers} from '../crm-users';
import {isPlatformTeam} from '../platform-access';
export async function recordCustomerRegistration(account:CustomerAccount){
 const id=`customer_registered:${account.id}`;
 const event={id,createdAt:account.createdAt,type:'customer_registered',title:'Новая регистрация пользователя',entityType:'account',entityId:account.id,entityLabel:account.name,text:account.phone,href:'/crm/feed',visibility:'team' as const};
 await recordCrmActivity(null,event);
 const users=await readCrmUsers();
 await notifyTeam({id,createdAt:account.createdAt,recipientIds:users.filter(u=>u.status!=='disabled'&&isPlatformTeam(u)).map(u=>u.id),kind:'registration',title:event.title,text:`${account.name} · ${account.phone}`,href:'/crm/feed'});
}
