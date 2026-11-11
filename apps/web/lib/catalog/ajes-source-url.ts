/** AJ System's ordinary detail response carries the original listing URL in STATUS.
 * Accept links only; never interpret an ID/status as a URL or execute supplier HTML.
 * Also applied to saved normalized lots, whose status was already retained.
 */
export function ajesOriginalListingUrl(value:unknown,table:string,lot?:unknown):string|undefined {
 if(typeof value!=='string'||value.length>2048)return;
 const allowed=table==='korea'?['encar.com','kcar.com','kbchachacha.com','bobaedream.co.kr']:table==='china'?['che168.com','autohome.com.cn','dongchedi.com','guazi.com']:[];
 if(!allowed.length)return;
 let raw=value.trim().replace(/&amp;/gi,'&');
 if(raw.includes('{LOT}')){if(typeof lot!=='string'&&typeof lot!=='number')return;const id=String(lot);if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))return;raw=raw.replaceAll('{LOT}',encodeURIComponent(id));}
 if(/[{}]/.test(raw))return;
 if(!/^https?:\/\//i.test(raw)||/[\u0000-\u0020\\]/.test(raw))return;
 try{
  const url=new URL(raw);
  if(url.username||url.password||url.port||!allowed.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))return;
  if([...url.searchParams.keys()].some(key=>/^(?:code|password|token|api[_-]?key|secret)$/i.test(key)))return;
  return url.href;
 }catch{return;}
}
