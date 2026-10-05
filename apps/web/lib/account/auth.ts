import {customerAvatar} from './avatars';
import {randomBytes,createHash,createHmac,timingSafeEqual,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
import {cookies} from 'next/headers';
import {getJsonStorage,mutateDataJson,readDataJson} from '../data';
const scrypt=promisify(scryptCallback);
export const ACCOUNT_COOKIE='avtocena_customer';
export type CustomerAccount={id:string;phone:string;name:string;passwordHash:string;createdAt:string;sessionVersion:number;telegramId?:string;phoneVerifiedAt?:string;disabled?:boolean;avatarId?:string;gender?:'unspecified'|'male'|'female';avatarVersion?:string};
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function normalizeAccountPhone(input:unknown){let s=String(input||'').replace(/[^\d]/g,'');if(s.length===11&&s[0]==='8')s='7'+s.slice(1);if(!/^[1-9]\d{9,14}$/.test(s))throw Error('Введите телефон с кодом страны.');return '+'+s;}
export const accountPath=(id:string)=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Нет доступа.');return `accounts/users/${id}.json`;};
export function phoneAccountId(phone:string){const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!secret)throw Error('Вход временно недоступен.');return createHmac('sha256',secret).update('customer-phone:'+phone).digest('hex');}
export async function passwordDigest(password:string,salt=randomBytes(16).toString('hex')){if(password.length<10||password.length>128)throw Error('Пароль должен содержать от 10 до 128 символов.');const key=await scrypt(password,salt,64) as Buffer;return salt+':'+key.toString('hex');}
export async function passwordMatches(password:string,encoded:string){if(password.length>128)return false;const [salt,key]=encoded.split(':');if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(key||''))return false;const actual=await scrypt(password,salt,64) as Buffer;return timingSafeEqual(actual,Buffer.from(key,'hex'));}
function secret(){const s=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!s)throw Error('Вход временно недоступен.');return s;}
export function accountSession(account:CustomerAccount){const body=Buffer.from(JSON.stringify({id:account.id,v:account.sessionVersion,exp:Date.now()+14*86400000})).toString('base64url');return body+'.'+createHmac('sha256',secret()).update('customer:'+body).digest('base64url');}
export function parseAccountSession(raw:string){try{const [body,sig,...extra]=raw.split('.');const expected=createHmac('sha256',secret()).update('customer:'+body).digest('base64url');if(extra.length||sig?.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const p=JSON.parse(Buffer.from(body,'base64url').toString());return /^[a-f0-9]{64}$/.test(p.id)&&p.exp>Date.now()?p:null;}catch{return null;}}
export async function currentAccount(){const p=parseAccountSession((await cookies()).get(ACCOUNT_COOKIE)?.value||'');if(!p)return null;const a=await readDataJson<CustomerAccount|null>(accountPath(p.id),null);return a&&!a.disabled&&a.sessionVersion===p.v?a:null;}
export const publicAccount=(a:CustomerAccount)=>({id:a.id,name:a.name,phone:a.phone,telegramConnected:!!a.telegramId,phoneVerified:!!a.phoneVerifiedAt,avatarId:a.avatarId||'',gender:a.gender||'unspecified',avatarUrl:a.avatarVersion?`/api/account/avatar?v=${a.avatarVersion}`:customerAvatar(a.id,a.avatarId)});
// Bounded fixed buckets: unauthenticated rate limiting cannot create an
// unbounded collection in Object Storage by varying phone numbers or IPs.
export async function accountRateLimit(identity:string,limit=12,windowMs=900000){const bucket=hash(identity).slice(0,3);let ok=false;await mutateDataJson(`accounts/rate/${bucket}.json`,{at:0,count:0},r=>{const value=Date.now()-r.at>windowMs?{at:Date.now(),count:0}:r;ok=value.count<limit;return {...value,count:Math.min(1000,value.count+1)};});return ok;}
export async function registerAccount(phone:string,password:string,name:string){const id=phoneAccountId(phone),passwordHash=await passwordDigest(password);const a:CustomerAccount={id,phone,name:name.trim().slice(0,80)||'Покупатель',passwordHash,createdAt:new Date().toISOString(),sessionVersion:0};try{await getJsonStorage().writeJson(accountPath(id),a,{ifNoneMatch:'*'});}catch{throw Error('Не удалось создать кабинет. Попробуйте войти или восстановить доступ.');}return a;}
