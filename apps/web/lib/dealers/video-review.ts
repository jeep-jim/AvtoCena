export type VideoReview={url:string;source:string;embed?:string;direct?:boolean};
export function videoReview(value:unknown):VideoReview|null {
 if(typeof value!=='string')return null;
 const candidate=value.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;]+$/,'');
 if(!candidate)return null;
 try {
  const url=new URL(candidate),host=url.hostname.replace(/^www\./,'');
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(host==='max.ru'&&/^\/c\/[-\w]+\/[\w-]+\/?$/.test(url.pathname))return {url:url.href,source:'MAX'};
  if(host==='youtube.com'||host==='youtu.be'){
   const id=host==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1];
   if(id&&/^[\w-]{11}$/.test(id))return {url:url.href,source:'YouTube',embed:`https://www.youtube-nocookie.com/embed/${id}`};
  }
  const rutube=host==='rutube.ru'&&url.pathname.match(/^\/(?:video|play\/embed)\/([a-f0-9]{32})\/?$/i);
  if(rutube)return {url:url.href,source:'RUTUBE',embed:`https://rutube.ru/play/embed/${rutube[1]}/${url.searchParams.has('p')?'?p='+encodeURIComponent(url.searchParams.get('p')!):''}`};
  if(/\.(mp4|webm)$/i.test(url.pathname))return {url:url.href,source:host,direct:true};
  return null;
 }catch{return null;}
}
export function videoReviews(...texts:unknown[]):VideoReview[]{const reviews=texts.flatMap(value=>typeof value==='string'?(value.match(/https?:\/\/[^\s<>"']+/gi)||[]).map(videoReview).filter((x):x is VideoReview=>!!x):[]);return reviews.filter((r,i)=>reviews.findIndex(x=>x.url===r.url)===i).slice(0,6);}
export function withoutVideoLinks(value:string){return value.replace(/https?:\/\/[^\s<>"']+/gi,url=>videoReview(url)?'':url).replace(/^\s*Видео\s*обзор\s*(?:ссылка\s*на\s*)?(?:MAX|YouTube|RUTUBE)?\s*:\s*$/gim,'').trim();}
