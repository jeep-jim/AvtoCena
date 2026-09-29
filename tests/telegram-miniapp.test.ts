import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {miniAppBootstrap, miniAppPathAllowed, miniAppCatalogButton, MINI_APP_URL} from "../apps/web/lib/telegram-miniapp";
function boot(pathname:string,search="",saved?:string){const memory=new Map(saved?[["avtocena_mini",saved]]:[]);const document={documentElement:{dataset:{} as Record<string,string>}};vm.runInNewContext(miniAppBootstrap,{URLSearchParams,location:{pathname,search},document,sessionStorage:{getItem:(k:string)=>memory.get(k),setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});return {mode:document.documentElement.dataset.miniapp,saved:memory.get("avtocena_mini")};}
test("mini presentation persists in its tab and leaves normal visits and staff screens unchanged",()=>{
 assert.equal(boot("/mini").mode,"true");assert.equal(boot("/cars/offer/car","","1").mode,"true");assert.equal(boot("/cars").mode,undefined);
 for(const path of ["/crm","/admin","/login","/api/crm","/partner","/cars-malicious"]){assert.equal(boot(path,"","1").mode,undefined);assert.equal(miniAppPathAllowed(path),false);}
 assert.deepEqual(boot("/cars","?mini=0","1"),{mode:undefined,saved:undefined});
 assert.equal(boot("/privacy","","1").mode,"true");
});
test("inline mini app button only uses web_app for private chat IDs",()=>{
 assert.deepEqual(miniAppCatalogButton("123").web_app,{url:MINI_APP_URL});
 assert.equal(miniAppCatalogButton("-123").url,MINI_APP_URL);assert.equal(miniAppCatalogButton().url,MINI_APP_URL);
});
