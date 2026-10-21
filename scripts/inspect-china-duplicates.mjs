import crypto from 'node:crypto';
const {getOfferFromCurrentShard}=await import('../apps/web/lib/catalog/storage.ts');
const ids=['184ea9867c33ca2b4095419f','06fcd029497476db3dbb82a7','39c1b3d1260fdf7f0948e795','48361d3deeccac1d8612ae42','079eac8d7d05d7c53f2be510','7b9eab94a5ce453dd42f64d0','6cd56bd5ed6df56a99624939'];
for(const id of ids){
 const o=await getOfferFromCurrentShard(id);if(!o){console.log(JSON.stringify({id,missing:true}));continue;}
 const raw=o.operational?.raw||{};
 const vin=String(o.vin||raw.detail?.vincode||raw.vincode||'').trim().toUpperCase();
 console.log(JSON.stringify({id,sourceId:o.sourceId,sourceOfferId:o.sourceOfferId,url:o.operational?.sourceUrl,make:o.make,model:o.model,trim:o.trim,year:o.year,mileage:o.mileageKm,price:o.sourcePrice,currency:o.sourceCurrency,vinHash:vin?crypto.createHash('sha256').update(vin).digest('hex'):null,vinComplete:/^[A-HJ-NPR-Z0-9]{17}$/.test(vin),rawKeys:Object.keys(raw),detailKeys:Object.keys(raw.detail||{}),images:o.images.slice(0,4).map(x=>({url:x.url,checksum:x.checksum})),photoVerified:o.operational?.photoIdentityVerified}));
}
