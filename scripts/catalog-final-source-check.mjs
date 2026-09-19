import {getOffer} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
const storage=getJsonStorage();for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[key]=async()=>{throw Error('read_only_probe');};
for(const id of ['c96d8ddee23bcaa040e9cc6a','d6417c1b1ceef14566969d3d','84f3bb33a613ba35bb4d4005','be5212a27f0126aa0a416b2a']){
 const offer=await getOffer(id);if(!offer){console.log(JSON.stringify({id,missing:true}));continue;}
 if(offer.sourceId==='kcar_korea_open'){
 const url=`https://api.kcar.com/bc/car-info-detail-of-ng?i_sCarCd=${encodeURIComponent(offer.sourceOfferId)}&i_sPassYn=N`;
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 const body=await response.json();const data=body.data?.data||body.data;const rvo=data?.rvo||{};
 const allowed=['carCd','mnuftrNm','modelNm','grdNm','grdDtlNm','regModelyr','mfgDt','engdispmnt','hrspow','fuelType','fuelTypeNm','salprc'];
 console.log(JSON.stringify({id,sourceId:offer.sourceId,status:response.status,sourceReportsSold:/판매완료/.test(data?.message||''),technical:Object.fromEntries(allowed.filter(k=>rvo[k]!==undefined).map(k=>[k,rvo[k]])),stored:{engineCc:offer.engineCc,powerHp:offer.powerHp,powerKw:offer.powerKw,powerDataSource:offer.powerDataSource}}));
 }else if(offer.sourceId==='mobile_de_open'){
 const url=offer.images?.[0]?.url;const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='img.classistatic.de')throw Error('unexpected_photo_host');
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'});console.log(JSON.stringify({id,sourceId:offer.sourceId,status:response.status,contentType:response.headers.get('content-type'),request:'normal GET without Range'}));await response.body?.cancel();
 }
}
