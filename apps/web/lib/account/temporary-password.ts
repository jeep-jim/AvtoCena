import {createHmac,randomBytes} from 'node:crypto';
import {accountPath,passwordDigest,type CustomerAccount} from './auth';
import {mutateDataJson} from '../data';
// Stable for a verified challenge: retrying delivery never creates a different password.
export function recoveryPassword(proof:string){const key=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!key)throw Error('Восстановление временно недоступно.');return createHmac('sha256',key).update('customer-recovery-password:'+proof).digest('base64url').slice(0,18);}
export async function issueTemporaryPassword(accountId:string,expectedVersion:number,proof=randomBytes(32).toString('hex')){
 const password=recoveryPassword(proof),passwordHash=await passwordDigest(password);let expires=0;
 await mutateDataJson<CustomerAccount|null>(accountPath(accountId),null,a=>{if(!a||a.disabled)throw Error('Кабинет недоступен.');if(a.passwordRecoveryProof===proof){expires=a.passwordTemporaryUntil||0;if(expires<=Date.now()||a.passwordTemporaryUsed)throw Error('Временный пароль уже использован или истёк. Начните восстановление снова.');return a;}if(a.sessionVersion!==expectedVersion)throw Error('Данные доступа изменились. Начните восстановление снова.');expires=Date.now()+600000;return {...a,passwordHash,passwordRecoveryProof:proof,passwordTemporaryUntil:expires,passwordTemporaryUsed:false,sessionVersion:a.sessionVersion+1};});
 return {password,expires};
}
