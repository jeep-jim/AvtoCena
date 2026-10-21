import {createHmac,timingSafeEqual} from 'node:crypto';
// Domain-separated signing key. Both existing worker and web environments have
// this storage credential; the credential itself never leaves either process.
function signature(url:string,timestamp:string,secret:string){
  const key=createHmac('sha256',secret).update('avtocena:source-bridge:v1').digest();
  const u=new URL(url);
  return createHmac('sha256',key).update(`GET\n${u.pathname}${u.search}\n${timestamp}`).digest('hex');
}
export function sourceBridgeHeaders(url:string,secret=process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,now=Date.now()){
  if(!secret)throw Error('source_bridge_signing_key_missing');
  const timestamp=String(Math.floor(now/1000));
  return {'x-avtocena-source-time':timestamp,'x-avtocena-source-signature':signature(url,timestamp,secret)};
}
export function sourceBridgeAuthorized(request:Request,secret=process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,now=Date.now()){
  if(!secret||request.method!=='GET')return false;
  const time=request.headers.get('x-avtocena-source-time')||'',signed=request.headers.get('x-avtocena-source-signature')||'';
  if(!/^\d{10}$/.test(time)||!/^[a-f0-9]{64}$/.test(signed)||Math.abs(now/1000-Number(time))>120)return false;
  return timingSafeEqual(Buffer.from(signed,'hex'),Buffer.from(signature(request.url,time,secret),'hex'));
}
