import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [out]=process.argv.slice(2);assert.ok(out&&process.argv.length===3);
const sha=b=>createHash('sha256').update(b).digest('hex');
const objects={},updatedAt=new Date().toISOString(),generationId='gen_'+Date.now()+'_brandfixture';
const countries=['china','georgia'],brands=['Toyota','Suzuki'];
const fx={china:'CNY',georgia:'USD'},items={};
const photos='/api/site-media/'+'1'.repeat(64);
function put(k,v){const body=Buffer.from(JSON.stringify(v));objects[k]={body:body.toString('base64'),sha256:sha(body)};}
for(const market of countries)items[market]=brands.map((make,i)=>{
 const model=i?'Swift':'RAV4',id=sha(market+':'+make).slice(0,24),currency=fx[market],sourcePrice=40000+i,rate=22;
 return {id,market,make,model,year:2023,bodyType:'suv',fuel:'petrol',status:'active',offerType:'fixed',priceMode:'fixed',
  sourceGroup:market==='china'?'autohome_used_china_open':'myauto_georgia_list',firstSeenAt:updatedAt,updatedAt,inventorySourceDate:updatedAt,
  calculationStatus:'needs_data',catalogPricingMode:'seller',sourcePrice,sourceCurrency:currency,sellerPriceRub:Math.round(sourcePrice*rate),
  totalRub:null,cardProjectionVersion:3,cardImageUrl:photos,calculationSnapshot:{currencyRate:{currency,sourcePrice,effectiveRate:rate,
   rateSource:'cbr',rateDate:updatedAt.slice(0,10),cbrRate:rate,nominal:1,sourcePriceRub:Math.round(sourcePrice*rate)}}};
});
const facets={generationId,makes:brands,models:[{make:'Toyota',model:'RAV4'},{make:'Suzuki',model:'Swift'}],
 markets:countries,bodyTypes:['suv'],fuels:['petrol'],transmissions:[],drives:[]};
put('catalog/manifest.json',{version:2,generationId,updatedAt,markets:Object.fromEntries(countries.map(k=>[k,{count:2,chunks:['chunk-0001'],updatedAt}]))});
put('catalog/public/facets.json',facets);put(`catalog/generations/${generationId}/indexes/facets.json`,facets);
for(const market of [...countries,'all']){
 const selected=market==='all'?countries.flatMap(k=>items[k]):items[market];
 put(`catalog/public/projection/${market}.json`,{generationId,items:selected});
 put(`catalog/generations/${generationId}/indexes/projection/${market}.json`,{generationId,items:selected});
}
const raw=Buffer.from(JSON.stringify({kind:'uae-browser-mock-storage-v1',objects}));
writeFileSync(join(out,'objects.json'),raw,{mode:0o600,flag:'wx'});
writeFileSync(join(out,'objects.sha256'),sha(raw)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(join(out,'expected.json'),JSON.stringify(Object.fromEntries(countries.map(k=>[k,items[k].map(r=>[r.make,r.id])]))),{mode:0o600,flag:'wx'});
