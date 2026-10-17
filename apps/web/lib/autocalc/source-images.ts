import {offerImages} from '../catalog/offer-images';
/** Read JSON only; never execute page scripts. Scope galleries to the current offer. */
export function sourceImages(html:string,url:string,structured:unknown[]=[]){
 const result:string[]=[];
 const add=(v:unknown)=>{if(typeof v!=='string')return;try{const u=new URL(v.replace(/&amp;/g,'&'),url);if(u.protocol==='https:'&&!u.username&&!u.password)result.push(u.href);}catch{}};
 const gallery=(v:any,depth=0)=>{if(!v||depth>8)return;if(typeof v==='string'){add(v);return;}if(Array.isArray(v)){v.slice(0,200).forEach(x=>gallery(x,depth+1));return;}if(typeof v==='object'){// Prefer originals before resized alternatives.
  for(const k of ['original','orig','full','large','origUrl','originalUrl','contentUrl','url','src','image','images','photos','sizes'])if(v[k])gallery(v[k],depth+1);
 }};
 structured.forEach(x=>gallery(x));
 const page=new URL(url),id=page.pathname.match(/\/(\d{6,}(?:-[a-z0-9]+)?)\/?$/i)?.[1];
 let visited=0;
 const visit=(v:any,depth=0)=>{if(!v||typeof v!=='object'||depth>16||++visited>15000)return;
  const sameUrl=[v.url,v.canonicalUrl,v.link].some(x=>{try{return typeof x==='string'&&new URL(x,url).pathname===page.pathname;}catch{return false;}});
  const sameId=id&&[v.id,v.offerId,v.offer_id].some(x=>String(x)===id);
  if(sameUrl||sameId){for(const k of ['images','photos','gallery','image','media'])if(v[k])gallery(v[k]);}
  for(const child of Object.values(v))if(child&&typeof child==='object')visit(child,depth+1);
 };
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/ld\+json/i.test(match[1]))continue;
  const raw=match[2].trim();let json=raw;
  if(!/^[\[{]/.test(raw)){const assignment=raw.match(/^(?:window\.)?__(?:INITIAL_STATE|initialState|NEXT_DATA|PRELOADED_STATE)__\s*=\s*([\s\S]*?);?$/);if(!assignment)continue;json=assignment[1].replace(/;\s*$/,'');}
  try{visit(JSON.parse(json));}catch{}
 }
 return offerImages(result);
}
