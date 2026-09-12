import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recyclingPowerInfo } from "../apps/web/lib/catalog/recycling-power";
import { validateCustomerParameters } from "../apps/web/lib/catalog/customer-parameters";
import { synchronizeCombustionPower } from "../apps/web/lib/catalog/combustion-power-consistency";
import { utilizationCoefficient2026 } from "../packages/engine/src/calculation/russiaCustoms";
const ice = {fuel:"petrol",powertrainKind:"combustion",vehicleCategory:"M1",powerHp:160};
const draft = {year:"2026",fuel:"petrol",vehicleCategory:"M1",powerHp:"160",powerKw:"118",engineCc:"1498"};

test("118 source kW is paired with 160 display hp; no rounded threshold comparison", () => {
  const result = recyclingPowerInfo({...ice,powerKw:118});
  assert.ok(result?.borderline); assert.equal(result.kwLabel,"118 кВт");
  assert.equal(result.hpLabel,"160 л.с."); assert.ok(result.reason.includes("117,68"));
});
test("exact boundaries stay aligned with the tariff engine", () => {
  for (const [kw, expected] of [[117.68,false],[117.69,true],[118,true],[117.68001,true]] as const) {
    assert.equal(recyclingPowerInfo({...ice,powerKw:kw})?.aboveLimit,expected);
    assert.equal(utilizationCoefficient2026({powertrainKind:"combustion",utilizationPowerKw:kw,engineCc:1498,ageBand:"up_to_3_years",personalUseEligible:true}),expected?45:0.17);
  }
});
test("150 hp/110 kW is unchanged and hp-only is never presented as source kW", () => {
  assert.equal(recyclingPowerInfo({...ice,powerHp:150,powerKw:110})?.borderline,false);
  assert.equal(recyclingPowerInfo(ice),null);
  for (const powerKw of [null,undefined,"",0,-1,NaN,Infinity,"unknown",true]) assert.equal(recyclingPowerInfo({...ice,powerKw}),null);
});
test("do not apply the M1 combustion warning to N1, EVs or hybrids", () => {
  for (const patch of [{vehicleCategory:"N1"},{vehicleCategory:"unknown"},{tnVedCode:"8704219100"},{powertrainKind:"electric"},{powertrainKind:"series_hybrid"},{powertrainKind:"other_hybrid"},{fuel:"hybrid"},{fuel:"electric"}]) {
    assert.equal(recyclingPowerInfo({...ice,powerKw:118,...patch}),null);
  }
});
test("presentation never mutates source specifications", () => {
  const input = Object.freeze({...ice,powerKw:118}); recyclingPowerInfo(input);
  assert.equal(input.powerHp,160); assert.equal(input.powerKw,118);
});
test("unrelated year and engine edits preserve entered 118 kW through validation and synchronization", () => {
  for (const patch of [{},{year:"2025"},{engineCc:"1998"}]) {
    const parameters = validateCustomerParameters({...draft,...patch});
    assert.equal(parameters.powerKw,118); assert.ok(Number(parameters.powerHp)>160);
    const synchronized = synchronizeCombustionPower({...parameters,powerDataSource:"customer_input"});
    assert.equal(synchronized.powerKw,118); assert.equal(synchronized.icePowerKw,118); assert.equal(synchronized.utilizationPowerKw,118);
  }
});
test("explicit customer kW retains precision on either side of the threshold", () => {
  for (const kw of [117.68,117.69,117.680001,118]) {
    const p = validateCustomerParameters({...draft,powerKw:String(kw)});
    const synchronized = synchronizeCombustionPower({...p,powerDataSource:"customer_input"});
    assert.equal(synchronized.utilizationPowerKw,kw);
  }
});
test("hp-only customer calculation still works; invalid explicit kW is rejected", () => {
  assert.equal(validateCustomerParameters({...draft,powerKw:"",powerHp:"150"}).powerKw,150*0.73549875);
  for (const kw of ["not-a-number",-1,0,Infinity,2001]) assert.throws(()=>validateCustomerParameters({...draft,powerKw:kw}));
});
test("wiring: both views, reset path and price explanation use existing layout containers", () => {
  const card=readFileSync("apps/web/components/catalog/CatalogCard.tsx","utf8");
  const inline=readFileSync("apps/web/components/catalog/InlineOfferParameters.tsx","utf8");
  const page=readFileSync("apps/web/app/(public)/cars/offer/[id]/page.tsx","utf8");
  assert.match(card,/data-recycling-power-chip/); assert.match(card,/RecyclingPowerLabel/);
  assert.match(inline,/valueNode=\{pairedPower/); assert.match(inline,/key==="powerHp"\?\{powerKw:""\}/);
  assert.match(inline,/setDraft\(initial\)/); assert.match(page,/powerKw:powerScenario\?"":String\(recyclingPowerInfo\(raw\)\?\.kw/);
  assert.match(page,/RecyclingFeeHelp info=\{powerInfo\}/);
});
