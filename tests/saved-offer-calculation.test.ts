import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {getJsonStorage} from "../apps/web/lib/data";
import {cleanSavedDraft,matchingSavedCalculation,saveOfferCalculation,SavedCalculationConflict,getSavedOfferCalculation} from "../apps/web/lib/catalog/saved-offer-calculation";
import {unseenNewLeads,latestLeadIncomingAt} from "../apps/web/lib/crm-alert-state";

const draft={year:"2021",productionMonth:"11",fuel:"petrol",engineCc:"1998",powerHp:"150",powerKw:"110.3248125",deliveryCity:"Новокузнецк"};
test("saved employee calculation survives fresh reads and price updates, rejects lost updates and missing identity",async()=>{
 const offer:any={id:`test-saved-${randomUUID()}`,market:"korea",sourceId:"encar",sourceOfferId:"lot-1",make:"Hyundai",model:"Elantra"};
 const calculation:any={totalRub:2500000,breakdown:[{id:"car",amountRub:2000000}],currencyRate:{currency:"KRW",effectiveRate:.06}};
 try {
  const first=await saveOfferCalculation(offer,draft,calculation,"test-manager",null,"Тестовый сотрудник");
  assert.equal(first.savedByName,"Тестовый сотрудник");
  assert.equal((await getSavedOfferCalculation(offer))?.calculation.totalRub,2500000);
  assert.equal(matchingSavedCalculation(first,{...offer,sourcePrice:999999})?.draft.deliveryCity,"Новокузнецк");
  assert.equal(matchingSavedCalculation(first,null),null);
  assert.equal(matchingSavedCalculation(first,{...offer,id:"another"}),null);
  assert.equal(matchingSavedCalculation(first,{...offer,sourceOfferId:"different-lot"}),null);
  await assert.rejects(saveOfferCalculation(offer,draft,calculation,"other-manager",null),SavedCalculationConflict);
  const second=await saveOfferCalculation(offer,{...draft,powerHp:"160",powerKw:"117.6798"},calculation,"test-manager",first.version);
  assert.notEqual(second.version,first.version);
  assert.equal((await getSavedOfferCalculation(offer))?.draft.powerHp,"160");
  const {attachSavedCalculationPreviews}=await import("../apps/web/lib/catalog/saved-calculation-previews");
  const [preview]:any[]=await attachSavedCalculationPreviews([offer]);
  assert.equal(preview.savedCalculationPreview.version,second.version);
  assert.equal(preview.savedCalculationPreview.totalRub,2500000);
  assert.equal(Math.round(preview.savedCalculationPreview.parameters.powerHp),160);
 } finally {await getJsonStorage().deleteJson?.(`offer-calculations/${createHash("sha256").update(offer.id).digest("hex")}.json`);}
});
test("only allowed calculation fields persist; incomplete hybrid cannot be saved",()=>{
 const cleaned=cleanSavedDraft({...draft,totalRub:1,role:"owner",savedBy:"forged",unknown:"x"});
 assert.equal(cleaned.totalRub,undefined);assert.equal(cleaned.role,undefined);assert.equal(cleaned.savedBy,undefined);
 assert.throws(()=>cleanSavedDraft({...draft,fuel:"hybrid",hybridKind:"other_hybrid"}));
 assert.equal(cleanSavedDraft({...draft,fuel:"hybrid",hybridKind:"other_hybrid",power30MinKw:"45",icePowerKw:"100"}).power30MinKw,"45");
});
test("acknowledgement stops only seen new leads, later leads and offline arrivals remain pending",()=>{
 const leads=[{id:"a",status:"new",createdAt:"2026-09-20T10:00:00Z"},{id:"b",status:"new",createdAt:"2026-09-20T11:00:00Z"},{id:"c",status:"done",createdAt:"2026-09-20T12:00:00Z"}];
 assert.deepEqual(unseenNewLeads(leads,Date.parse("2026-09-20T10:00:00Z")).map(x=>x.id),["b"]);
 assert.equal(unseenNewLeads(leads,Date.parse("2026-09-20T11:00:00Z")).length,0);
});

test("a customer followup in an existing processed lead alerts again; manager edits do not",()=>{
 const lead={id:"existing",status:"in_progress",createdAt:"2026-09-20T10:00:00Z",followups:[{createdAt:"2026-09-20T11:00:00Z"}],updatedAt:"2026-09-20T12:00:00Z"};
 const incoming=latestLeadIncomingAt(lead);
 assert.equal(incoming,"2026-09-20T11:00:00Z");
 assert.equal(unseenNewLeads([{...lead,lastIncomingAt:incoming}],Date.parse(lead.createdAt)).length,1);
 assert.equal(unseenNewLeads([{...lead,lastIncomingAt:incoming}],Date.parse(incoming)).length,0);
});

test("saved previews use the same price and parameters across all markets without leaking manager identity",async()=>{
 const {savedPreviewEntry,attachSavedPreviewEntries}=await import('../apps/web/lib/catalog/saved-calculation-previews');
 const {savedOfferIdentity}=await import('../apps/web/lib/catalog/saved-offer-calculation');
 const {offerWithSavedPreview}=await import('../apps/web/lib/catalog/saved-calculation-preview');
 for(const market of ['japan','china','korea','uae','europe','georgia']){
  const offer:any={id:`saved-${market}`,market,sourceId:`source-${market}`,sourceOfferId:'1',engineCc:undefined,powerHp:undefined,catalogPricingMode:'seller',sellerPriceRub:500000,japanDeliveredPreview:{totalRub:1000000}};
  const record:any={offerId:offer.id,identity:savedOfferIdentity(offer),version:'v1',savedAt:'2026-09-22T12:00:00Z',savedBy:'private-id',savedByName:'Private manager',draft,calculation:{totalRub:2500000,currencyRate:{currency:'JPY',effectiveRate:.5}}};
  const entry=savedPreviewEntry(record,offer)!;assert.ok(entry);
  const projection:any={id:offer.id,market,sourceGroup:offer.sourceId};
  const [attached]:any[]=attachSavedPreviewEntries([projection],{version:1,entries:{[offer.id]:entry}});
  const shown=offerWithSavedPreview(attached);
  assert.equal(shown.totalRub,2500000);assert.equal(shown.engineCc,1998);assert.ok(Math.abs(shown.powerHp-150)<.01);
  assert.equal(shown.fuel,'petrol');assert.equal(shown.savedCalculationPreview.deliveryCity,'Новокузнецк');
  assert.equal(shown.japanDeliveredPreview,undefined);
  assert.ok(!JSON.stringify(attached).includes('private-id'));assert.ok(!JSON.stringify(attached).includes('Private manager'));
  const [mismatch]:any[]=attachSavedPreviewEntries([{...projection,sourceGroup:'different'}],{version:1,entries:{[offer.id]:entry}});
  assert.equal(mismatch.savedCalculationPreview,undefined);
 }
});

test("public saved preview endpoint bounds batches and exposes no index identity",async()=>{
 const {GET}=await import('../apps/web/app/api/catalog/saved-previews/route');
 assert.equal((await GET(new Request('http://localhost/api/catalog/saved-previews?ids='+Array.from({length:51},(_,i)=>'id-'+i).join(',')))).status,400);
 assert.equal((await GET(new Request('http://localhost/api/catalog/saved-previews?ids=../private'))).status,400);
 const response=await GET(new Request('http://localhost/api/catalog/saved-previews?ids=not-a-real-offer'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{previews:{'not-a-real-offer':null}});
});


test("saved preview never uses invalid totals",async()=>{
 const {savedCalculationPreviewRub}=await import('../apps/web/lib/catalog/saved-calculation-preview');
 for(const totalRub of [0,-1,Infinity,NaN])assert.equal(savedCalculationPreviewRub({totalRub} as any),0);
 assert.equal(savedCalculationPreviewRub({totalRub:2500000} as any),2500000);
});
