/** One listing has at most 30 photos, independently of its source or gallery. */
export const MAX_OFFER_PHOTOS = 30;
export function offerImageKey(value:string){
 try {
  const u=new URL(value);u.hash='';
  // Auto.ru serves the same picture in several sizes and on several CDN hosts.
  if(/\/(?:get-autoru|autoru)\//.test(u.pathname))return u.pathname.replace(/\/[^/]+\/?$/,'');
  for(const key of ['w','h','width','height','quality','q','fit','resize'])u.searchParams.delete(key);
  u.searchParams.sort();return u.href;
 }catch{return value;}
}
export function offerImages(values:readonly string[],limit=MAX_OFFER_PHOTOS){
 const seen=new Set<string>();return values.filter(value=>{if(!value)return false;const key=offerImageKey(value);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
}
