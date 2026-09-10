import test from "node:test";
import assert from "node:assert/strict";
import {selectCatalogPowerMix,catalogPowerBand} from "../apps/web/lib/catalog/power-mix";
const row=(id:string,powerHp?:number,market="europe")=>({id,market,powerHp}) as any;
test("public selection enforces 80 percent and keeps input reserve intact",()=>{
 const rows=[...Array.from({length:8},(_,i)=>row("low"+i,150)),...Array.from({length:20},(_,i)=>row("high"+i,300))];
 const result=selectCatalogPowerMix(rows);
 assert.equal(result.rows.length,10);assert.equal(result.removed.length,18);assert.equal(rows.length,28);
 assert.equal(result.rows.filter(r=>catalogPowerBand(r)==="low").length,8);
});
test("unknown power uses the 20 percent allowance and each market is independent",()=>{
 const rows=[row("l1",100),row("l2",120),row("l3",130),row("l4",160),row("unknown"),row("high",300),...Array.from({length:4},(_,i)=>row("k"+i,140,"korea")),row("kh",250,"korea")];
 const result=selectCatalogPowerMix(rows);
 assert.equal(result.rows.length,10);assert.equal(result.removed[0].id,"high");
 assert.equal(catalogPowerBand(row("x")), "unknown");
 assert.equal(catalogPowerBand(row("ev",150)),"low");
});
test("Drom manual inventory is explicitly unqualified, never counted as low power",()=>{
 const result=selectCatalogPowerMix([row("drom",undefined,"japan")]);
 assert.equal(result.rows.length,1);assert.equal((result.report.japan as any).targetMet,false);
 assert.throws(()=>selectCatalogPowerMix([row("high",300)]),/no_qualified_low_power/);
});
