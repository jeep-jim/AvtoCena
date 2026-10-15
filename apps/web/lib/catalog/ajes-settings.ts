import 'server-only';
import crypto from 'node:crypto';
import {readDataJson,writeDataJson} from '../data';
const path='integrations/ajes/config.json';
function key(){const secret=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!secret)throw Error('encryption_unavailable');return crypto.createHash('sha256').update('ajes:'+secret).digest();}
export async function ajesPassword():Promise<string|undefined>{
 const config=await readDataJson<{encryptedPassword:string}|null>(path,null);
 if(!config)return process.env.AJES_API_PASSWORD;
 try{const [iv,tag,body]=config.encryptedPassword.split('.').map(x=>Buffer.from(x,'base64'));const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}catch{throw Error('ajes_configuration_unavailable');}
}
export async function saveAjesPassword(password:string){
 if(!/^[A-Za-z0-9_-]{8,128}$/.test(password))throw Error('invalid_password');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
 const body=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);
 await writeDataJson(path,{encryptedPassword:[iv,cipher.getAuthTag(),body].map(x=>x.toString('base64')).join('.'),updatedAt:new Date().toISOString()});
}
