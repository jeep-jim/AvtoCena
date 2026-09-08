import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSellerPricedOffer } from "../apps/web/lib/catalog/seller-price-contract";
import { catalogOfferVisibleRub } from "../apps/web/lib/catalog/public-priority";
import { searchProjectionFromOffer, projectionCanRenderCard, isCatalogProductionRefreshAllowed } from "../apps/web/lib/catalog/storage";
import { validateCustomerParameters } from "../apps/web/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParameters } from "../apps/web/lib/catalog/customs-pricing";
import { LocalJsonStorage } from "../apps/web/lib/data";
import { resetCatalogRateCache } from "../apps/web/lib/catalog/rates";

const seller=():any=>({id:"test:one",sourceId:"mobile_de_open",sourceOfferId:"one",market:"europe",make:"Toyota",model:"Corolla",year:2021,
 status:"active",totalRub:null,sourcePrice:10000,sourceCurrency:"EUR",catalogPricingMode:"seller",sellerPriceRub:950000,calculationStatus:"needs_data",
 images:[{url:"https://example.test/vehicle.jpg"}],calculationSnapshot:{currencyRate:{currency:"EUR",sourcePrice:10000,effectiveRate:95,rateSource:"cbr"}}});

test("source rubles survive the card projection but cannot become a delivered total or borrow another quote",()=>{
 const input=seller();assert.equal(isSellerPricedOffer(input),true);assert.equal(catalogOfferVisibleRub(input),0);
 const projected=searchProjectionFromOffer(input);projected.cardImageUrl="https://example.test/vehicle.jpg";
 assert.equal(projectionCanRenderCard(projected),true);assert.equal(projected.totalRub,null);
 for(const change of [{sourcePrice:20000},{sellerPriceRub:900000},{totalRub:950000},{sourceCurrency:"USD"},{catalogPricingMode:undefined}])assert.equal(isSellerPricedOffer({...input,...change}),false);
});

test("manual inputs require exact cc and separate certified power for electrified scenarios",()=>{
 const draft={year:"2021",fuel:"petrol",engineCc:"1598",powerHp:"150"};
 assert.equal(validateCustomerParameters(draft).engineCc,1598);
 assert.throws(()=>validateCustomerParameters({...draft,engineCc:"1.6"}));
 assert.throws(()=>validateCustomerParameters({...draft,fuel:"electric"}));
 assert.throws(()=>validateCustomerParameters({...draft,fuel:"hybrid",power30MinKw:60}));
 assert.equal(validateCustomerParameters({...draft,fuel:"electric",power30MinKw:60}).engineCc,undefined);
});

test("manual calculation uses the pricing engine without mutating the published offer",async()=>{
 const markets=JSON.parse(fs.readFileSync("data/markets/markets.json","utf8")),today=new Date().toISOString();
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED="true";resetCatalogRateCache();
 const read=mock.method(LocalJsonStorage.prototype,"readJsonWithMeta",async(key:string)=>({found:true,value:key==="fees/exchange-rates.json"?{updatedAt:today,EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:"cbr"}}:key==="markets/markets.json"?markets:{}}));
 try {
  const input=seller(),before=JSON.stringify(input);
  const result=await calculateOfferWithCustomerParameters(input,validateCustomerParameters({year:2021,engineCc:1598,powerHp:150,fuel:"petrol"}));
  assert.ok(result && result.totalRub>input.sellerPriceRub);
  assert.equal(JSON.stringify(input),before);assert.equal(catalogOfferVisibleRub(input),0);
 } finally {read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});

test("weekly inventory publication still requires both validation gates and preservation of five other markets",()=>{
 const previous=process.env.CATALOG_SELLER_INVENTORY;process.env.CATALOG_SELLER_INVENTORY="1";
 try {
 const options:any={productionRefreshMarket:"korea",preservePublicOffersByMarket:{japan:[],china:[],uae:[],europe:[],georgia:[]},beforePersistValidate(){},beforePublishValidate(){}};
 assert.equal(isCatalogProductionRefreshAllowed(options),true);
 assert.equal(isCatalogProductionRefreshAllowed({...options,beforePublishValidate:undefined}),false);
 assert.equal(isCatalogProductionRefreshAllowed({...options,preservePublicOffersByMarket:{china:[]}}),false);
 } finally {if(previous===undefined)delete process.env.CATALOG_SELLER_INVENTORY;else process.env.CATALOG_SELLER_INVENTORY=previous;}
});
