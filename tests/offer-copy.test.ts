import test from "node:test";
import assert from "node:assert/strict";
import { canCopyOffer, formatOfferCopy, offerCopySetting } from "../apps/web/lib/offer-copy";

test("copy text matches the six requested lines, retaining current values", () => {
  const car = {title:"Mazda CX-30 XD Pro Active",year:"2021",engineCc:"1800",powerHp:"131",mileageKm:73000,totalRub:1613000};
  assert.equal(formatOfferCopy(car), "Mazda CX-30 XD Pro Active\n2021 г\n1800 см3\n131 лс\n73.000 км\n1 613 000 ₽");
  assert.equal(formatOfferCopy({...car,powerHp:"132.5",totalRub:1733000}).split("\n").slice(3).join("\n"), "132,5 лс\n73.000 км\n1 733 000 ₽");
  assert.match(formatOfferCopy({...car,mileageKm:0,engineCc:"",powerHp:""}), /— см3\n— лс\n0 км/);
  assert.match(formatOfferCopy({...car,mileageKm:undefined}), /— км/);
  for(const totalRub of [0,null,undefined,NaN,Infinity,-1]) assert.throws(()=>formatOfferCopy({...car,totalRub}),/Дождитесь/);
});

test("legacy access is enabled, guests and disabled accounts are excluded, explicit switches win", () => {
  assert.equal(canCopyOffer(null),false);
  assert.equal(canCopyOffer({}),true);
  assert.equal(canCopyOffer({offerCopyEnabled:false}),false);
  assert.equal(canCopyOffer({offerCopyEnabled:true}),true);
  assert.equal(canCopyOffer({status:"disabled",offerCopyEnabled:true}),false);
});

test("only owner can change flower access; omitted field preserves settings", () => {
  const form=new FormData();
  assert.equal(offerCopySetting({role:"admin"},form),undefined);
  form.set("offerCopyPresent","1");
  for(const role of ["admin","manager","partner"] as const) assert.throws(()=>offerCopySetting({role},form),/только владелец/);
  assert.equal(offerCopySetting({role:"owner"},form),false);
  form.set("offerCopyEnabled","on");
  assert.equal(offerCopySetting({role:"owner"},form),true);
});
