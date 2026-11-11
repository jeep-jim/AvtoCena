import test from "node:test";
import assert from "node:assert/strict";
import { translationKey, translateGroupsFromCache, validTranslation } from "../apps/web/lib/catalog/specification-translation";

test("translation is display-only and preserves model codes and numeric evidence", () => {
  const source = "M7 尊贵型 401KM 9 места";
  const groups = [{ name: "Комплектация", items: [{ name: "Модель", value: source }] }];
  const cache = { [translationKey(source)]: { source, text: "M7 Премиальная комплектация 401KM 9 места" } };
  assert.equal(translateGroupsFromCache(groups, cache)[0].items[0].value, cache[translationKey(source)].text);
  assert.equal(groups[0].items[0].value, source);
  assert.equal(validTranslation(source, "M7 Премиальная комплектация 500KM 9 места"), false);
  assert.equal(validTranslation("배기량 1998", "Рабочий объём 1998"), true);
});

test("missing, stale and still untranslated cache entries retain the original", () => {
  const source = "中大型";
  const groups = [{ name: "Класс", items: [{ name: "Класс", value: source }] }];
  for (const cache of [{}, { [translationKey(source)]: { source: "другой текст", text: "Большой" } }, { [translationKey(source)]: { source, text: source } }]) {
    assert.equal(translateGroupsFromCache(groups, cache)[0].items[0].value, source);
  }
});
