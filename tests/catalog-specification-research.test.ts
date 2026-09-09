import test from "node:test";
import assert from "node:assert/strict";
import { parseResearchAnswer, researchFieldValue, researchSourceUrl, searchSpecificationSuggestions } from "../apps/web/lib/catalog/specification-research";
const offer:any={make:"Kia",model:"Morning",year:2023,market:"korea"};
const url="https://www.kia.com/specification";
function answer(fields:any[]=[{key:"engineCc",value:998,sourceUrl:url}],identity={}) {
 return {sources:[{url,title:"Kia",used:true}],message:{content:JSON.stringify({candidates:[{...offer,...identity,label:"Morning 1.0",fields}]})}};
}
test("only source-linked values for the matching market, model and year survive",()=>{
 assert.equal(parseResearchAnswer(answer(),offer)[0].fields[0].value,"998");
 for(const identity of [{year:2022},{market:"china"},{model:"Rio"}])assert.deepEqual(parseResearchAnswer(answer(undefined,identity),offer),[]);
 const unused=answer();unused.sources[0].used=false;
 assert.deepEqual(parseResearchAnswer(unused,offer),[]);
 assert.deepEqual(parseResearchAnswer(answer([{key:"engineCc",value:998,sourceUrl:"https://example.com"}]),offer),[]);
});
test("conflicting duplicates, unsupported units and executable links are rejected",()=>{
 assert.deepEqual(parseResearchAnswer(answer([{key:"powerHp",value:76,sourceUrl:url},{key:"powerHp",value:100,sourceUrl:url}]),offer),[]);
 assert.equal(researchFieldValue("engineCc",998.2),null);
 assert.equal(researchFieldValue("powerHp","76 кВт"),null);
 assert.equal(researchFieldValue("__proto__","x"),null);
 for(const link of ["javascript:alert(1)","http://example.com","https://localhost/a","https://user:pass@example.com"])assert.equal(researchSourceUrl(link),null);
});
test("peak power never fills a missing 30-minute value",()=>{
 const result=parseResearchAnswer(answer([{key:"powerHp",value:200,sourceUrl:url}]),offer);
 assert.deepEqual(result[0].fields.map(f=>f.key),["powerHp"]);
});
test("rejected or malformed answers do not become card data",()=>{
 assert.deepEqual(parseResearchAnswer({...answer(),problematicAnswer:true},offer),[]);
 assert.deepEqual(parseResearchAnswer({sources:answer().sources,message:{content:"not JSON"}},offer),[]);
 assert.deepEqual(parseResearchAnswer(answer([null]),offer),[]);
});
test("unconfigured provider performs no network request",async()=>{
 const original=process.env.YANDEX_SEARCH_API_KEY;
 delete process.env.YANDEX_SEARCH_API_KEY;
 try{assert.equal((await searchSpecificationSuggestions(offer)).searchStatus,"not_configured");}
 finally{if(original!==undefined)process.env.YANDEX_SEARCH_API_KEY=original;}
});
test("configured search uses the fixed endpoint and excludes private identity",async()=>{
 const originalFetch=globalThis.fetch;
 const key=process.env.YANDEX_SEARCH_API_KEY,folder=process.env.YANDEX_SEARCH_FOLDER_ID;
 process.env.YANDEX_SEARCH_API_KEY="test-only";process.env.YANDEX_SEARCH_FOLDER_ID="test-folder";
 let calls=0;
 globalThis.fetch=(async(input:any,init:any)=>{
  calls++;
  assert.equal(input,"https://searchapi.api.cloud.yandex.net/v2/gen/search");
  const body=JSON.parse(init.body);
  assert.equal(body.folderId,"test-folder");
  assert.equal(body.messages[0].role,"ROLE_USER");
  assert.ok(!init.body.includes("PRIVATE-VIN"));
  assert.ok(!init.body.includes("PRIVATE-CONTACT"));
  return new Response(JSON.stringify(answer()),{status:200});
 }) as typeof fetch;
 try {
  const result=await searchSpecificationSuggestions({...offer,vin:"PRIVATE-VIN",sellerPhone:"PRIVATE-CONTACT"});
  assert.equal(calls,1);assert.equal(result.searchStatus,"available");
  globalThis.fetch=(async()=>new Response("provider internal error",{status:500})) as typeof fetch;
  assert.deepEqual(await searchSpecificationSuggestions(offer),{candidates:[],searchStatus:"unavailable"});
 }finally{
  globalThis.fetch=originalFetch;
  if(key===undefined)delete process.env.YANDEX_SEARCH_API_KEY;else process.env.YANDEX_SEARCH_API_KEY=key;
  if(folder===undefined)delete process.env.YANDEX_SEARCH_FOLDER_ID;else process.env.YANDEX_SEARCH_FOLDER_ID=folder;
 }
});
