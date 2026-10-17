import { createHash } from "node:crypto";
import type { SourceSpecificationSnapshot } from "./source-specifications";

export const TRANSLATION_CACHE_PATH = "catalog-translations/ru/specifications-v1.json";
export type TranslationCache = Record<string, { source: string; text: string }>;
export const needsTranslation = (text: string) => /[\u3400-\u9fff\uac00-\ud7af]/u.test(text);
export const translationKey = (text: string) => createHash("sha256").update(text).digest("hex");

// Reject translations that change numbers, units or Latin model designations.
export function validTranslation(source: string, text: string) {
  const tokens = (value: string) => (value.match(/[A-Za-z0-9]+(?:[.,-][A-Za-z0-9]+)*/g) || []).sort().join("|");
  return Boolean(text.trim()) && !needsTranslation(text) && tokens(source) === tokens(text);
}

export function translateGroupsFromCache(groups: SourceSpecificationSnapshot["groups"], cache: TranslationCache) {
  const translate = (source: string) => {
    if (!needsTranslation(source)) return source;
    const entry = cache[translationKey(source)];
    return entry?.source === source && validTranslation(source, entry.text) ? entry.text : source;
  };
  return groups.map(group => ({ ...group, name: translate(group.name), items: group.items.map(item => ({ ...item, name: translate(item.name), value: translate(item.value) })) }));
}
