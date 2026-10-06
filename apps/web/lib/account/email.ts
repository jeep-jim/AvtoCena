import {randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import nodemailer from 'nodemailer';
import {hash,type CustomerAccount} from './auth';
import {mutateDataJson} from '../data';
export function normalizeAccountEmail(value:unknown){const email=String(value||'').trim().toLowerCase();if(email.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email))throw Error('Введите корректный адрес электронной почты.');return email;}
export function accountMailConfigured(){return !!(process.env.ACCOUNT_SMTP_HOST&&process.env.ACCOUNT_SMTP_USER&&process.env.ACCOUNT_SMTP_PASSWORD&&process.env.ACCOUNT_MAIL_FROM);}
export type EmailChallenge={tokenHash:string;codeHash:string;accountId:string;email:string;kind:'bind'|'reset';version:number;expires:number;attempts:number;used?:boolean};
const path=(token:string)=>{if(!/^[a-f0-9]{48}$/.test(token))throw Error('Код недействителен или истёк.');return `accounts/email-challenges/${hash(token).slice(0,3)}.json`;};
const active=(rows:EmailChallenge[])=>rows.filter(x=>x.expires>Date.now()&&!x.used).slice(-99);
export function emailChallengeMatches(c:EmailChallenge,token:string,code:string,kind:EmailChallenge['kind'],now=Date.now()){
 if(c.used||c.expires<=now||c.attempts>=5||c.kind!==kind||c.tokenHash!==hash(token)||!/^\d{6}$/.test(code))return false;
 return timingSafeEqual(Buffer.from(c.codeHash,'hex'),Buffer.from(hash(token+':'+code),'hex'));
}
export async function createEmailChallenge(account:CustomerAccount|null,email:string,kind:EmailChallenge['kind']){
 if(!accountMailConfigured())throw Error('Отправка писем пока не подключена. Обратитесь к вашему менеджеру.');
 const token=randomBytes(24).toString('hex');
 // The response does not reveal whether a phone/email belongs to an account.
 if(!account||account.disabled||(kind==='reset'&&(!account.emailVerifiedAt||account.email!==email)))return token;
 const code=String(randomInt(0,1000000)).padStart(6,'0');
 const c:EmailChallenge={tokenHash:hash(token),codeHash:hash(token+':'+code),accountId:account.id,email,kind,version:account.sessionVersion,expires:Date.now()+600000,attempts:0};
 await mutateDataJson<EmailChallenge[]>(path(token),[],rows=>[...active(rows),c]);
 const port=Number(process.env.ACCOUNT_SMTP_PORT||465);
 const transport=nodemailer.createTransport({host:process.env.ACCOUNT_SMTP_HOST,port,secure:port===465,requireTLS:port!==465,auth:{user:process.env.ACCOUNT_SMTP_USER,pass:process.env.ACCOUNT_SMTP_PASSWORD},connectionTimeout:10000,socketTimeout:15000});
 try{await transport.sendMail({from:process.env.ACCOUNT_MAIL_FROM,to:email,subject:'Код подтверждения АвтоЦены',text:`Ваш код: ${code}. Он действует 10 минут. Никому не сообщайте код. Если вы не запрашивали подтверждение, проигнорируйте письмо.`});}catch{throw Error('Не удалось отправить письмо. Попробуйте позже.');}finally{transport.close();}
 return token;
}
export async function consumeEmailChallenge(token:string,code:string,kind:EmailChallenge['kind'],accountId?:string){
 let found:EmailChallenge|undefined;
 await mutateDataJson<EmailChallenge[]>(path(token),[],rows=>{found=undefined;return active(rows).map(c=>{if(c.tokenHash!==hash(token)||c.kind!==kind||accountId&&c.accountId!==accountId)return c;if(emailChallengeMatches(c,token,code,kind)){found=c;return {...c,used:true};}return {...c,attempts:c.attempts+1};});});
 if(!found)throw Error('Код неверный, истёк или уже использован. Запросите новый код.');return found;
}
