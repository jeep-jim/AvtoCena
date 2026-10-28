import test from "node:test";
import assert from "node:assert/strict";
import {parameterErrorText} from "../apps/web/lib/catalog/parameter-error-text.ts";
test("Camry missing ICE points to hybrid section, without asking for ICE in electric 30-minute field",()=>{
 const draft={fuel:"hybrid",powerHp:"197",power30MinKw:"58",icePowerKw:""};
 const before={...draft};
 assert.equal(parameterErrorText(new Error("Проверьте поле icePowerKw"),draft),"Для расчёта под ключ заполните мощность ДВС в разделе «Мощность гибрида».");
 assert.deepEqual(draft,before);
});
test("electric and hybrid 30-minute errors identify their actual section",()=>{
 assert.match(parameterErrorText(new Error("Проверьте поле power30MinKw"),{fuel:"electric"}),/30-минутную мощность в разделе «30-минутная мощность»/);
 assert.match(parameterErrorText(new Error("Проверьте поле power30MinKw"),{fuel:"hybrid"}),/30-минутную мощность в разделе «Мощность гибрида»/);
});
test("invalid filled power is not presented as missing and unrelated errors remain intact",()=>{
 assert.equal(parameterErrorText(new Error("Проверьте поле icePowerKw"),{fuel:"hybrid",icePowerKw:"-1"}),"Проверьте мощность ДВС в разделе «Мощность гибрида».");
 assert.equal(parameterErrorText(new Error("Укажите тип гибрида"),{}),"Укажите тип гибрида");
 assert.equal(parameterErrorText(new Error("Проверьте поле year"),{}),"Для расчёта под ключ заполните год выпуска в разделе «Дата выпуска».");
});
