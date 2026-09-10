import test from "node:test";
import assert from "node:assert/strict";
import {encryptConfig,decryptConfig} from "../apps/web/lib/browser-pilot/config";
import {browserResearchPrompt} from "../apps/web/lib/browser-pilot/prompt";
const secret="test-secret-not-for-production-0123456789";
test("runtime envelope hides credentials and rejects a wrong key or tampering",()=>{
 const value={enabled:true,url:"https://192.0.2.1:8443/v1",key:"worker-secret-".repeat(5),ca:"test-cert",expiresAt:Date.now()+10000,instanceId:"vm-test",releaseSha:"test"};
 const envelope=encryptConfig(value,secret);assert.ok(!JSON.stringify(envelope).includes(value.key));assert.deepEqual(decryptConfig(envelope,secret),value);
 assert.throws(()=>decryptConfig(envelope,secret+"x"));assert.throws(()=>decryptConfig({...envelope,tag:Buffer.alloc(16).toString("base64")},secret));
});
test("real car context includes canonical AvtoCena card without suggested horsepower",()=>{
 const prompt=browserResearchPrompt("test-car",{make:"Mazda",model:"Flair Wagon",year:2024,trim:"XG",chassisCode:"MM94S",market:"japan"});
 assert.match(prompt,/https:\/\/avtocena.com\/cars\/offer\/test-car/);assert.match(prompt,/Mazda Flair Wagon 2024 XG MM94S рынок Японии/);assert.match(prompt,/Не придумывай мощность/);assert.throws(()=>browserResearchPrompt("../bad?token=x",{}));
});
