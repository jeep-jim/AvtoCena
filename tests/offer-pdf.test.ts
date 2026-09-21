import test from "node:test";
import assert from "node:assert/strict";
import { offerPdfData, renderOfferPdf } from "../apps/web/lib/catalog/offer-pdf";
const offer:any={id:"test-car",market:"uae",make:"Mitsubishi",model:"Eclipse Cross",trim:"4WD",sourcePrice:21950,sourceCurrency:"AED",sellerPriceRub:1729660,mileageKm:27000};
const draft={year:"2022",engineCc:"1499",fuel:"petrol",powerHp:"150",deliveryCity:"Новокузнецк"};
const calculation:any={totalRub:2786060,currencyRate:{currency:"AED",effectiveRate:78.8,rateDate:"2026-04-29"},paymentPlan:{securityDepositRub:110000},breakdown:[{id:"car",amountRub:1729660},{id:"logistics",amountRub:236400},{id:"rf-delivery",title:"Доставка / перегруз по РФ",amountRub:65000},{id:"customs",title:"Таможенные платежи",amountRub:540000},{id:"broker",title:"Брокер, СВХ, ЭПТС, СБКТС",amountRub:125000},{id:"topavto-commission",amountRub:90000}]};
test("PDF uses current draft, engine totals and a separate deposit, not the template amounts",()=>{
 const data=offerPdfData(offer,{...draft,year:"2023",deliveryCity:"Кемерово"},calculation);
 assert.match(data.specs,/2023/);assert.equal(data.city,"Кемерово");assert.match(data.rate,/78,8/);
 assert.equal(data.total,"2 786 060 ₽");assert.equal(data.deposit,"110 000 ₽");
 assert.equal(data.sections[0].rows.at(-1)?.value,"1 966 060 ₽");
 assert.equal(data.sections[1].rows.at(-1)?.value,"2 696 060 ₽");
});
test("incomplete draft still has an export without fabricated total or customs",async()=>{
 const data=offerPdfData(offer,{year:"2022"},null,"Нужна мощность");
 assert.equal(data.total,"Требует уточнения");assert.equal(data.sections[0].rows[0].value,"1 729 660 ₽");assert.equal(data.sections[1].rows[1].value,"Требует уточнения");
 const pdf=await renderOfferPdf(data);assert.equal(pdf.subarray(0,5).toString(),"%PDF-");assert.ok(pdf.length>10000);
 assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g)||[]).length,1,"compact PDF must not create blank footer pages");
});
test("zero commission is a valid completed calculation",()=>{
 const data=offerPdfData(offer,draft,{...calculation,breakdown:calculation.breakdown.filter((l:any)=>l.id!=="topavto-commission")});
 assert.equal(data.sections[2].rows[0].value,"0 ₽");
});

test("PDF rate movement and calculation date are factual, with neutral unknown history",()=>{
 const down=offerPdfData(offer,draft,{...calculation,currencyRate:{currency:"AED",effectiveRate:20,previousEffectiveRate:21}},undefined,"2026-08-12T10:00:00Z");
 assert.equal(down.rateDirection,"down");assert.equal(down.valuationDate,"12.08.2026");assert.equal(down.rateChange,"-4,76%");
 assert.equal(offerPdfData(offer,draft,{...calculation,currencyRate:{effectiveRate:22,previousEffectiveRate:21}}).rateDirection,"up");
 assert.equal(offerPdfData(offer,draft,calculation).rateDirection,"flat");
});
