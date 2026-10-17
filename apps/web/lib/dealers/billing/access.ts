import type {AuthUser} from '../../auth';
import {isPlatformOwner} from '../../platform-access';
import {validDealerId,findDealer} from '../showcase-store';
export async function billingDealer(user:AuthUser|null,id?:string){if(!user||user.status==='disabled')throw Error('Войдите в кабинет');const target=isPlatformOwner(user)?String(id||''):String(user.companyId||'');if(!validDealerId(target))throw Error('Выберите компанию');if(!isPlatformOwner(user)&&(user.role!=='dealer'||user.dealerApproved!==true||(id&&id!==target)))throw Error('Нет доступа');const d=await findDealer(target);if(!d||(!isPlatformOwner(user)&&!['verified','paused'].includes(d.status)))throw Error('Компания недоступна');return target;}
