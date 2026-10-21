import 'server-only';
import crypto from 'node:crypto';
import {notifyLowRegcloudBalance} from './regcloud-balance-alert';
import {readDataJson,writeDataJson} from './data';
import {fetchRegcloudBalance,type RegcloudBalance} from './regcloud-balance-client';
const path='integrations/regcloud/balance.json';
function key(){const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!secret)throw Error('encryption_unavailable');return crypto.createHash('sha256').update('regcloud-balance:'+secret).digest();}
export function validRegcloudToken(value:unknown):value is string{return typeof value==='string'&&value.length>=16&&value.length<=2048&&/^[\x21-\x7e]+$/.test(value);}
async function token(){
 const config=await readDataJson<{encryptedToken:string}|null>(path,null);
 if(!config)return process.env.REGCLOUD_API_TOKEN;
 try{const [iv,tag,body]=config.encryptedToken.split('.').map(x=>Buffer.from(x,'base64'));const d=crypto.createDecipheriv('aes-256-gcm',key(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(body),d.final()]).toString('utf8');}catch{throw Error('configuration_unavailable');}
}
type Cache={fingerprint:string;value:RegcloudBalance|null;expires:number;pending:Promise<RegcloudBalance>|null};
let cache:Cache|null=null;
export async function readRegcloudBalance(){
 const credential=await token();if(!credential)return {configured:false as const};
 const fingerprint=crypto.createHash('sha256').update(credential).digest('hex');
 if(cache?.fingerprint!==fingerprint)cache={fingerprint,value:null,expires:0,pending:null};
 const current=cache;
 if(Date.now()<current.expires){if(!current.value)throw Error('balance_unavailable');await notifyLowRegcloudBalance(current.value).catch(()=>{});return {configured:true as const,...current.value};}
 if(!current.pending)current.pending=fetchRegcloudBalance(credential).then(value=>{current.value=value;current.expires=Date.now()+60000;return value;},()=>{current.value=null;current.expires=Date.now()+60000;throw Error('balance_unavailable');}).finally(()=>{current.pending=null;});
 const value=await current.pending;
 await notifyLowRegcloudBalance(value).catch(()=>{});
 return {configured:true as const,...value};
}
export async function connectRegcloudBalance(credential:string){
 if(!validRegcloudToken(credential))throw Error('invalid_token');
 const value=await fetchRegcloudBalance(credential);
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
 const body=Buffer.concat([cipher.update(credential,'utf8'),cipher.final()]);
 await writeDataJson(path,{encryptedToken:[iv,cipher.getAuthTag(),body].map(x=>x.toString('base64')).join('.'),updatedAt:new Date().toISOString()});
 cache=null; // In-flight reads can only update their detached cache.
 await notifyLowRegcloudBalance(value).catch(()=>{});
 return {configured:true as const,...value};
}
