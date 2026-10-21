import test from "node:test";
import assert from "node:assert/strict";
import {catalogMarketName} from "../apps/web/lib/catalog/presentation";
test("all six source market IDs have Russian public labels including Georgia",()=>{
 for(const [id,label] of Object.entries({japan:"Япония",china:"Китай",korea:"Корея",uae:"ОАЭ",europe:"Европа",georgia:"Грузия"}))assert.equal(catalogMarketName(id),label);
});
