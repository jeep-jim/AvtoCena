import test from "node:test";
import assert from "node:assert/strict";
import {validateCustomerParameters} from "../apps/web/lib/catalog/customer-parameters";
import {confirmedProductionMonth} from "../apps/web/lib/catalog/production-month";
const draft={year:"2021",productionMonth:"11",fuel:"petrol",engineCc:"1998",powerHp:"150"};
test("manufacturing month enters calculation without inventing a day",()=>{
 assert.equal(validateCustomerParameters(draft).productionDate,"2021-11");
 assert.equal(validateCustomerParameters({...draft,productionMonth:""}).productionDate,undefined);
 for(const productionMonth of ["0","13","1.5","NaN"])assert.throws(()=>validateCustomerParameters({...draft,productionMonth}));
});
test("changing one parameter preserves the other values",()=>{
 const result=validateCustomerParameters({...draft,powerHp:"160"});
 assert.equal(result.engineCc,1998);assert.equal(result.year,2021);assert.equal(result.fuel,"petrol");assert.equal(result.powerHp,160);assert.equal(result.productionDate,"2021-11");
});
test("hybrid and EV cannot calculate using peak power as 30 minute power",()=>{
 assert.throws(()=>validateCustomerParameters({...draft,fuel:"electric"}));
 assert.throws(()=>validateCustomerParameters({...draft,fuel:"hybrid",hybridKind:"series_hybrid",icePowerKw:"100"}));
 assert.equal(validateCustomerParameters({...draft,fuel:"electric",power30MinKw:"50"}).engineCc,undefined);
});
test("registration and ambiguous legacy production dates do not populate month",()=>{
 assert.equal(confirmedProductionMonth({year:2021,productionDate:"2021-11",registrationDate:"2021-11"}),"");
 assert.equal(confirmedProductionMonth({year:2021,operational:{raw:{manufacturedate:"2021-11"}}}),"11");
 assert.equal(confirmedProductionMonth({year:2021,operational:{raw:{manufacturedate:"2020-11"}}}),"");
});
