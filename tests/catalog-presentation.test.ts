import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogOfferTitle,
  presentCatalogOffer,
  translateCatalogText,
} from "../apps/web/lib/catalog/presentation";

const forbiddenSourceScript = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff\uf900-\ufaff\uff61-\uff9f]/u;

test("public catalog text removes half-width Japanese Kana", () => {
  assert.equal(translateCatalogText("HONDA CIVIC ﾊｯﾁ Back"), "HONDA CIVIC Back");
  assert.equal(translateCatalogText("Nissan X Trail Eﾌﾞﾚ Key Package"), "Nissan X Trail E Key Package");
});

test("public offer title and labels never expose raw Japanese source script", () => {
  const offer = {
    id: "jp-halfwidth-kana",
    market: "japan",
    make: "HONDA",
    model: "CIVIC ﾊｯﾁ Back",
    trim: "20X Eﾌﾞﾚ Key Package",
    year: 2020,
    images: [],
  };

  const title = catalogOfferTitle(offer);
  const presented = presentCatalogOffer(offer);

  assert.equal(title, "HONDA CIVIC Back 20X E Key Package");
  assert.equal(forbiddenSourceScript.test(title), false);
  assert.equal(forbiddenSourceScript.test(presented.modelLabel), false);
  assert.equal(forbiddenSourceScript.test(presented.trimLabel), false);
});

test("unknown Kana, Hangul and Han fragments are removed without invented translations", () => {
  const text = translateCatalogText("Toyota 未知モデル テスト ㅌㅔㅅㅡㅌㅡ");
  assert.equal(text, "Toyota");
  assert.equal(forbiddenSourceScript.test(text), false);
});
