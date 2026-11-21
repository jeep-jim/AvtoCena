/** Exact paid mapper gallery policy: canonical DubiCars vehicle photo URLs only. */
export function isPaidDubicarsImageUrl(value:unknown):value is string {
 if(typeof value!=='string'||!value||value!==value.trim())return false;
 try{
  const image=new URL(value);
  return image.protocol==='https:'&&image.hostname==='www.dubicars.com'&&!image.port&&
   !image.username&&!image.password&&image.pathname.startsWith('/images/')&&
   /\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname)&&!image.search;
 }catch{return false;}
}

// The stage must independently attest that a local legacy/editorial key was
// carried from the same exact offer and accepted revision. This shape check is
// only a public-path boundary, not proof of ownership or existence.
const siteMedia=/^\/api\/site-media\/[a-f0-9]{64}$/;
const catalogImage=/^\/api\/catalog\/images\/[a-f0-9]{32}$/;
const localKey=/^catalog\/images\/uae\/([a-f0-9]{64})\.(?:jpe?g|png|webp|avif)$/i;
export function isPreparedUaeGalleryPath(value:unknown) {
 return typeof value==='string'&&(isPaidDubicarsImageUrl(value)||siteMedia.test(value)||catalogImage.test(value));
}
export function isPreparedUaeGallery(images:unknown):boolean {
 if(!Array.isArray(images)||images.length>30)return false;
 return images.every(image=>{
  if(!image||typeof image!=='object'||image.role==='auction_sheet'||!isPreparedUaeGalleryPath(image.url))return false;
  if(!image.objectKey)return !image.id||typeof image.id==='string';
  const sha=typeof image.objectKey==='string'?localKey.exec(image.objectKey)?.[1]:null;
  return !!sha&&image.checksum===sha&&image.id===sha.slice(0,32)&&image.url==='/api/catalog/images/'+image.id;
 });
}
