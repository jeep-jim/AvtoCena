import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {miniAppBootstrap, miniAppPathAllowed, miniAppCatalogButton, MINI_APP_URL,miniAppOfferShareUrl,miniAppLaunchPath} from "../apps/web/lib/telegram-miniapp";
function boot(pathname:string,search="",saved?:string,host:"browser"|"native"|"windows"|"web"|"other-frame"="browser",blocked=false){
 const memory=new Map(saved?[["avtocena_mini",saved]]:[]);
 const document={referrer:host==="web"?"https://web.telegram.org/k/":host==="other-frame"?"https://example.com/":"",documentElement:{dataset:{miniapp:"true"} as Record<string,string>,style:{removeProperty:()=>{}}}};
 const window:any={external:host==="windows"?{notify:()=>{}}:{},Telegram:{WebApp:{platform:"tdesktop"}}};window.parent=["web","other-frame"].includes(host)?{}:window;
 if(host==="native")window.TelegramWebviewProxy={postEvent:()=>{}};
 vm.runInNewContext(miniAppBootstrap,{URL,URLSearchParams,window,location:{pathname,search},document,sessionStorage:{getItem:(k:string)=>{if(blocked)throw Error('blocked');return memory.get(k)},setItem:(k:string,v:string)=>{if(blocked)throw Error('blocked');memory.set(k,v)},removeItem:(k:string)=>{if(blocked)throw Error('blocked');memory.delete(k)}}});
 return {mode:document.documentElement.dataset.miniapp,saved:memory.get("avtocena_mini")};
}
test("ordinary browsers clear stale mini state; URL and SDK alone never activate mini presentation",()=>{
 for(const path of ["/mini","/cars","/cars/offer/car","/favorites","/privacy"]){
  for(const query of ["","?mini=1","?tgWebAppPlatform=tdesktop&tgWebAppVersion=9.0"]){
   assert.deepEqual(boot(path,query,"1"),{mode:undefined,saved:undefined});
   assert.equal(boot(path,query,"1","browser",true).mode,undefined);
  }
 }
 assert.equal(boot("/mini","","1","other-frame").mode,undefined);
});
test("Telegram native, desktop and web hosts retain mini presentation and explicit exit",()=>{
 for(const host of ["native","windows","web"] as const){
  for(const path of ["/mini","/cars/offer/car","/privacy","/","/nvkz/topavto","/dealers/dealer_topavto"]){assert.equal(boot(path,"",undefined,host).mode,"true");assert.equal(boot(path,"",undefined,host,true).mode,"true");}
  assert.equal(boot("/cars","?mini=0","1",host).mode,undefined);
  for(const path of ["/crm","/admin","/login","/api/crm","/partner","/cars-malicious"]){assert.equal(boot(path,"","1",host).mode,undefined);assert.equal(miniAppPathAllowed(path),false);}
 }
});
test("inline mini app button only uses web_app for private chat IDs",()=>{
 assert.deepEqual(miniAppCatalogButton("123").web_app,{url:MINI_APP_URL});
 assert.equal(miniAppCatalogButton("-123").url,MINI_APP_URL);assert.equal(miniAppCatalogButton().url,MINI_APP_URL);
});

test("car launch links preserve identity and saved calculation, rejecting routes and malformed payloads",()=>{
 const url=miniAppOfferShareUrl("auction_abc-123","saved-v1")!;
 const start=new URL(url).searchParams.get("startapp")!;
 assert.match(start,/^[A-Za-z0-9_-]{1,512}$/);
 assert.equal(miniAppLaunchPath(start),"/cars/offer/auction_abc-123?mini=1&calculation=saved-v1");
 assert.equal(miniAppOfferShareUrl("../crm"),null);
 for(const value of ["topavto","car_!",null,"car_"+"a".repeat(513),"car_"+btoa(JSON.stringify(["../crm",""])),"car_"+btoa(JSON.stringify(["car","x&admin=1"]))]) assert.equal(miniAppLaunchPath(value),null);
});
