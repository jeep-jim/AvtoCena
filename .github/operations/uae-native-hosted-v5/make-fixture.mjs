import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [out]=process.argv.slice(2);
assert.ok(out&&process.argv.length===3);
const sha=data=>createHash('sha256').update(data).digest('hex');
const objects=Object.create(null),generationId='gen_1795233600000_uaestage',runId='fixture-uae-hosted-v1';
const scope='catalog/private-market-stage-v1/uae/'+runId+'/';
const photo='https://www.dubicars.com/images/fixtures/qa-kia-sportage.jpg';
const readyHorizon=Date.UTC(2030,0,1),legacy='gen_1795233600000_legacyfixture';
function put(key,value){const data=Buffer.from(JSON.stringify(value)),sha256=sha(data);assert.ok(!objects[key]);objects[key]={body:data.toString('base64'),sha256};return sha256;}
const rows=Array.from({length:53},(_,i)=>{
 const id=sha('uae-fixture-'+i).slice(0,24),seller=i%3!==0,sourcePrice=seller?50000+i:null;
 return {id,market:'uae',sourceGroup:'dubicars_uae_exact',make:'Kia',model:'Sportage',
  fuel:'petrol',powertrainKind:'combustion',bodyType:'suv',transmission:'automatic',drive:'awd',
  year:i%2?2023:2022,cardProjectionVersion:3,calculationStatus:'needs_data',catalogPricingMode:seller?'seller':undefined,
  sourcePrice,sourceCurrency:'AED',sellerPriceRub:seller?sourcePrice*22:null,totalRub:null,cardImageUrl:i%2?photo:undefined,
  firstSeenAt:new Date(Date.UTC(2026,10,20,1,i)).toISOString(),updatedAt:new Date(Date.UTC(2026,10,20,1,i)).toISOString(),
  ...(seller?{calculationSnapshot:{currencyRate:{currency:'AED',sourcePrice,sourcePriceRub:sourcePrice*22,effectiveRate:22,cbrRate:22,nominal:1,rateDate:'2026-11-20',rateSource:'cbr'}}}:{}),
 };
});
const admitted={seller:35,onRequest:18,retainedDelivered:0},shards=new Map();
for(const row of rows){
 const shard=sha(row.id).slice(0,2),items=shards.get(shard)??[];
 const photo=row.cardImageUrl?{id:'',objectKey:'',checksum:'',size:0,url:row.cardImageUrl,mimeType:'image/jpeg'}:null;
 const sourceOfferId=String(120000+items.length+rows.indexOf(row));
 items.push({...row,sourceOfferId,sourceId:'dubicars_uae_exact',status:'active',offerType:'fixed',priceMode:'fixed',
  images:photo?[photo]:[],operational:{provider:'auto-api.com'}});
 shards.set(shard,items);
}
const detailShards=Object.fromEntries([...shards].map(([shard,items])=>[shard,{rows:items.length,
 sha256:put(scope+'details/'+shard+'.json',{version:1,market:'uae',generationId,shard,items})}]));
const blocks=[rows.slice(0,16),rows.slice(16,35),rows.slice(35)].map((items,ordinal)=>({rows:items.length,
 sha256:put(scope+'projection/'+ordinal+'.json',{version:1,market:'uae',generationId,ordinal,items})}));
const sourceReceiptSha256=sha('fixture source'),priceReceiptSha256=sha('fixture price');
const publicDirectorySha256=put(scope+'public-directory.json',{version:1,kind:'uae-public-directory-v1',market:'uae',generationId,
 sourceReceiptSha256,priceReceiptSha256,admitted,blocks,detailShards});
const readySha256=put(scope+'READY.json',{version:1,kind:'uae-private-runtime-ready-v1',market:'uae',runId,generationId,
 sourceReceiptSha256,priceReceiptSha256,retainedDetailReceiptSha256:sha('fixture no retained delivered'),
 editorialReceiptSha256:sha('fixture no editorial entries'),publicDirectorySha256,admitted,legalValidUntil:readyHorizon});
put('catalog/independent-market-public-v1/uae/control.json',{version:1,market:'uae',revision:1,active:{runId,generationId,readySha256},previous:null});
const oldUae={...rows[1],id:sha('legacy-uae').slice(0,24),make:'Legacy',model:'Fixture'};
const georgia={...rows[1],id:sha('neighbor-georgia').slice(0,24),market:'georgia',make:'Toyota',model:'Camry',sourceGroup:'myauto_georgia_list',
 cardImageUrl:'https://example.invalid/qa-georgia.jpg'};
put('catalog/manifest.json',{version:1,generationId:legacy,fullProjection:true,markets:{uae:{count:1},georgia:{count:1}}});
put('catalog/public/projection/all.json',{generationId:legacy,items:[oldUae,georgia]});
put('catalog/public/projection/uae.json',{generationId:legacy,items:[oldUae]});
put('catalog/public/projection/georgia.json',{generationId:legacy,items:[georgia]});
const expected={generationId,total:53,seller:{id:rows[49].id,href:'/cars/offer/'+rows[49].id+'/kia-sportage-2023',rub:1101078,photo},
 onRequest:{id:rows[3].id,href:'/cars/offer/'+rows[3].id+'/kia-sportage-2023'},
 filter:{make:'Kia',model:'Sportage',count:26,params:{yearFrom:'2023'}}};
const raw=Buffer.from(JSON.stringify({kind:'uae-browser-mock-storage-v1',objects}));
writeFileSync(join(out,'objects.json'),raw,{mode:0o600,flag:'wx'});
writeFileSync(join(out,'expected.json'),JSON.stringify(expected),{mode:0o600,flag:'wx'});
writeFileSync(join(out,'objects.sha256'),sha(raw)+'\n',{mode:0o600,flag:'wx'});
