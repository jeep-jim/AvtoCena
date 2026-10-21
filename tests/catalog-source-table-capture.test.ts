import test from "node:test";
import assert from "node:assert/strict";
import { namedTechnicalGroups, captureSourceTable } from "../apps/web/lib/catalog/source-table-capture";
import { htmlTechnicalGroups } from "../apps/web/lib/catalog/source-html-specifications";
import { offerSpecificationGroups } from "../apps/web/lib/catalog/offer-specification-groups";
import { sourceListingSnapshot } from "../apps/web/lib/catalog/source-listing-snapshot";
import { fullGallery } from "../apps/web/lib/catalog/full-gallery-wrapper";

test("full tables retain hundreds of fields, source units, zero and unknown without flattening other vehicles",()=>{
 const rows=Array.from({length:240},(_,i)=>({name:`Option ${i}`,value:i%2===0}));
 const groups=namedTechnicalGroups([{name:"Engine",items:[{name:"Displacement mL",value:1485},{name:"Displacement L",value:1.5},{name:"Power PS",value:99},{name:"Unknown",value:null},...rows,{name:"sellerPhone",value:"PRIVATE"}]}]);
 assert.equal(groups[0].items.length,244);
 assert.equal(groups[0].items[3].value,"—");
 assert.equal(groups[0].items[4].value,"true");
 const offer:any={sourceId:"test",sourceOfferId:"one",year:2024,operational:{sourceUrl:"https://example.test/one"}};
 captureSourceTable(offer,groups);
 const snapshot=sourceListingSnapshot(offer,"detail");
 assert.deepEqual(snapshot.offer.operational.sourceSpecifications.groups,groups);
 assert.ok(offerSpecificationGroups(offer).some(group=>group.items.length===244));
 offer.sourceOfferId="other";
 assert.ok(!offerSpecificationGroups(offer).some(group=>group.items.length===244));
});

test("HTML key/value tables preserve units and omit VIN, seller contacts and multi-car comparisons",()=>{
 const groups=htmlTechnicalGroups('<table><caption>Engine</caption><tr><th>Capacity mL</th><td>1485</td></tr><tr><td>VIN</td><td>PRIVATE</td></tr><tr><td>Power</td><td>99</td><td>120</td></tr></table><dl><dt>Torque N·m</dt><dd>143</dd><dt>Option</dt><dd></dd></dl>');
 assert.deepEqual(groups.flatMap(g=>g.items),[{name:"Capacity mL",value:"1485"},{name:"Torque N·m",value:"143"},{name:"Option",value:""}]);
});

test("full gallery collection requests technical detail even when thirty pictures already exist and reports failures",async()=>{
 const previous=process.env.CATALOG_SOURCE_INVENTORY_MODE;process.env.CATALOG_SOURCE_INVENTORY_MODE="1";
 try {
  let calls=0;
  const source:any=fullGallery({sourceId:"test",fetchImages:async()=>{calls++;throw Error("detail_http_403");}} as any);
  const offer:any={operational:{sourceUrl:"https://example.test/one",raw:{images:Array.from({length:30},(_,i)=>`https://example.test/vehicle/${i}.jpg`)}}};
  await assert.rejects(source.fetchImages(offer),/detail_http_403/);assert.equal(calls,1);
 } finally {if(previous===undefined)delete process.env.CATALOG_SOURCE_INVENTORY_MODE;else process.env.CATALOG_SOURCE_INVENTORY_MODE=previous;}
});
