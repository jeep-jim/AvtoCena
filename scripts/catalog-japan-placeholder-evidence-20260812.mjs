import fs from 'node:fs/promises';
import path from 'node:path';
const { readAllOffersForMaintenance } = await import('../apps/web/lib/catalog/storage.ts');
const offers=(await readAllOffersForMaintenance()).filter((o)=>o?.status==='active'&&o.market==='japan');
const exactTotals=new Set([1020344,1074259,986370,1015420,1252198,1232804,1015420,1010344,1015420]);
const targetRe=/(?:CAST|AZ[- ]?OFFROAD|MIRA|TANTO|MOVE|WAGON R|WAGONR)/i;
const targets=offers.filter((o)=>targetRe.test(`${o.make||''} ${o.model||''}`)&&(exactTotals.has(Number(o.totalRub||0))||[2012,2017,2018,2019,2021,2022].includes(Number(o.year||0)))).slice(0,80);
await fs.mkdir('japan-placeholder-evidence',{recursive:true});
const manifest=[];
for(const offer of targets){
  const url=String(offer.images?.[0]?.url||'');
  if(!url) continue;
  const filename=`${offer.id}.img`;
  try{
    const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0'}});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!response.ok||!bytes.length) throw new Error(`http_${response.status}_${bytes.length}`);
    await fs.writeFile(path.join('japan-placeholder-evidence',filename),bytes);
    manifest.push({id:offer.id,make:offer.make,model:offer.model,year:offer.year,mileageKm:offer.mileageKm,totalRub:offer.totalRub,sourcePrice:offer.sourcePrice,sourceUrl:offer.operational?.sourceUrl,imageUrl:url,file:filename,contentType:response.headers.get('content-type'),bytes:bytes.length});
  }catch(error){manifest.push({id:offer.id,make:offer.make,model:offer.model,year:offer.year,mileageKm:offer.mileageKm,totalRub:offer.totalRub,sourcePrice:offer.sourcePrice,sourceUrl:offer.operational?.sourceUrl,imageUrl:url,error:String(error)});}
}
await fs.writeFile('japan-placeholder-evidence/manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
