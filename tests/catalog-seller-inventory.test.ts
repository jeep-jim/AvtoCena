import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSellerPricedOffer } from "../apps/web/lib/catalog/seller-price-contract";
import { catalogOfferVisibleRub } from "../apps/web/lib/catalog/public-priority";
import { searchProjectionFromOffer, projectionCanRenderCard, isCatalogProductionRefreshAllowed } from "../apps/web/lib/catalog/storage";
import { validateCustomerParameters } from "../apps/web/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParameters, calculateOfferWithCustomerParametersDetailed } from "../apps/web/lib/catalog/customs-pricing";
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
  for (const vehicleCategory of [undefined, "N1"] as const) {
   const pickup={...input,make:"Isuzu",model:"TAGA H",bodyType:"Пикап",vehicleCategory};
   const original=JSON.stringify(pickup);
   const blocked=await calculateOfferWithCustomerParametersDetailed(pickup,validateCustomerParameters({year:2021,productionMonth:5,engineCc:1598,powerHp:200,fuel:"diesel"}));
   assert.equal(blocked.ok,false);
   if (!blocked.ok) {
    assert.ok(blocked.missing.includes(vehicleCategory ? "gross_vehicle_weight_kg" : "vehicle_category"));
    assert.match(blocked.error,vehicleCategory ? /масс/ : /Выберите категорию/);
   }
   assert.equal(JSON.stringify(pickup),original);
   assert.equal(await calculateOfferWithCustomerParameters(pickup,validateCustomerParameters({year:2021,engineCc:1598,powerHp:200,fuel:"diesel"})),null);
  }

  const pickup={...input,make:"Isuzu",model:"TAGA H",bodyType:"Пикап"};
  const pickupBefore=JSON.stringify(pickup);
  const calculated=await calculateOfferWithCustomerParametersDetailed(pickup,validateCustomerParameters({year:2021,productionMonth:5,productionDay:12,engineCc:1598,powerHp:143,fuel:"diesel",vehicleCategory:"N1",grossVehicleWeightKg:3200,transportToBorderRub:50000,customsCalculationDate:"2026-09-09"}));
  assert.equal(calculated.ok,true);
  if(calculated.ok) {
   assert.equal(calculated.calculation.customs.vehicleCategory,"N1");
   assert.equal(calculated.calculation.customs.customsValueRub,1000000);
   assert.equal(calculated.calculation.customs.productionReferenceDate,"2021-05-12");
   assert.equal(calculated.calculation.breakdown.find((line:any)=>line.id==="logistics")?.amountRub,50000);
   assert.equal(calculated.calculation.breakdown.reduce((sum:number,line:any)=>sum+line.amountRub,0),calculated.calculation.totalRub);
  }
  assert.equal(JSON.stringify(pickup),pickupBefore);

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
