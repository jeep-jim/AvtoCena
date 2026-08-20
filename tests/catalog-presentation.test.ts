import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogOfferTitle,
  presentCatalogOffer,
  translateCatalogText,
} from "../apps/web/lib/catalog/presentation";
import { hasCredibleCatalogIdentity } from "../apps/web/lib/catalog/offer-quality";

const forbiddenSourceScript = /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff\uf900-\ufaff\uff61-\uff9f]/u;

test("public catalog text removes half-width Japanese Kana", () => {
  assert.equal(translateCatalogText("HONDA CIVIC ﾊｯﾁ Back"), "HONDA CIVIC Back");
  assert.equal(translateCatalogText("Nissan X Trail Eﾌﾞﾚ Key Package"), "Nissan X Trail E Key Package");
});

test("canonical Latin brand and model hyphens remain visible", () => {
  assert.equal(translateCatalogText("Mercedes-Benz V-Class"), "Mercedes-Benz V-Class");
  assert.equal(catalogOfferTitle({ market: "china", make: "Mercedes-Benz", model: "V-Class" }), "Mercedes-Benz V-Class");
  assert.equal(catalogOfferTitle({ market: "china", make: "Toyota", model: "HiAce" }), "Toyota HiAce");
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

test("unknown Kana, Hangul and Han fragments are removed from generic translated text without invented translations", () => {
  const text = translateCatalogText("Toyota 未知モデル テスト ㅌㅔㅅㅡㅌㅡ");
  assert.equal(text, "Toyota");
  assert.equal(forbiddenSourceScript.test(text), false);
});

test("Korean Inspiration trim is not corrupted by the shorter Ray model token", () => {
  assert.equal(translateCatalogText("인스퍼레이션"), "Inspiration");
  assert.equal(translateCatalogText("더 뉴 기아 레이 EV"), "Kia Ray EV");
});

test("Korea presentation preserves verified native model identity when no canonical translation exists", () => {
  const tasman = presentCatalogOffer({
    id: "korea-tasman",
    market: "korea",
    make: "기아",
    model: "타스만",
    trim: "2.5T 4WD",
    year: 2026,
    images: [],
  });
  assert.equal(tasman.makeLabel, "Kia");
  assert.equal(tasman.modelLabel, "타스만");
  assert.match(tasman.title, /^Kia 타스만/);

  const dolphin = presentCatalogOffer({
    id: "korea-byd-dolphin",
    market: "korea",
    make: "BYD",
    model: "돌핀",
    year: 2025,
    images: [],
  });
  assert.equal(dolphin.makeLabel, "BYD");
  assert.equal(dolphin.modelLabel, "돌핀");
  assert.equal(dolphin.title, "BYD 돌핀");
});

test("China presentation never exposes internal AutoHome series ids as model names", () => {
  const presented = presentCatalogOffer({
    id: "china-maxus-xingji",
    market: "china",
    make: "大通",
    model: "星际",
    sourceTitle: "星际 2027款 星际L 2.5T 柴油 自动四驱舒适版长箱",
    year: 2027,
    operational: { raw: { listing: { seriesId: "7312" } } },
    images: [],
  });
  assert.equal(presented.makeLabel, "Maxus");
  assert.equal(presented.modelLabel, "星际");
  assert.equal(presented.title, "Maxus 星际");
  assert.doesNotMatch(JSON.stringify(presented), /(?:серия|series)\s*7312/i);
});

test("China presentation keeps the source model suffix instead of collapsing it to the brand", () => {
  const exeed = presentCatalogOffer({
    id: "china-exeed-yaoguang",
    market: "china",
    make: "星途",
    model: "星途瑶光",
    sourceTitle: "星途瑶光 2027款 400T 曜夜版",
    year: 2027,
    operational: { raw: { listing: { seriesId: "6214" } } },
    images: [],
  });
  assert.equal(exeed.makeLabel, "Exeed");
  assert.equal(exeed.modelLabel, "瑶光");
  assert.equal(exeed.title, "Exeed 瑶光");

  const wuling = presentCatalogOffer({
    id: "china-wuling-xingchi",
    market: "china",
    make: "五菱汽车",
    model: "五菱星驰",
    sourceTitle: "五菱星驰 2026款",
    year: 2026,
    operational: { raw: { listing: { seriesId: "6178" } } },
    images: [],
  });
  assert.equal(wuling.makeLabel, "Wuling");
  assert.equal(wuling.modelLabel, "五菱星驰");
  assert.equal(wuling.title, "Wuling 五菱星驰");
});

test("China keeps the exact Chery QQ Ice Cream model instead of a make-only title", () => {
  const presented = presentCatalogOffer({
    id: "china-chery-qq-ice-cream",
    market: "china",
    make: "奇瑞QQ",
    model: "QQ冰淇淋",
    sourceTitle: "QQ冰淇淋 2026款 甜筒版",
    year: 2026,
    operational: { raw: { listing: { seriesId: "5758" } } },
    images: [],
  });
  assert.equal(presented.makeLabel, "Chery");
  assert.equal(presented.modelLabel, "QQ Ice Cream");
  assert.equal(presented.title, "Chery QQ Ice Cream");
});

test("generic source identity rejects observed Europe and collapsed Mercedes placeholders", () => {
  assert.equal(hasCredibleCatalogIdentity({ make: "Andere", model: "Andere" } as any), false);
  assert.equal(hasCredibleCatalogIdentity({ make: "Aixam", model: "Andere" } as any), false);
  assert.equal(hasCredibleCatalogIdentity({ make: "Mercedes-Benz", model: "Benz" } as any), false);
  assert.equal(hasCredibleCatalogIdentity({ make: "Mercedes-Benz", model: "Vito" } as any), true);
});

test("presentation never invents unknown make or model labels", () => {
  const presented = presentCatalogOffer({
    id: "broken-source-identity",
    market: "korea",
    make: "",
    model: "",
    year: 2020,
    images: [],
  });
  assert.equal(presented.makeLabel, "");
  assert.equal(presented.modelLabel, "");
  assert.doesNotMatch(JSON.stringify(presented), /Марка уточняется|Модель уточняется/i);
});
