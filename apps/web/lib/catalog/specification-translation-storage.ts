import { readDataJson } from "../data";
import type { SourceSpecificationSnapshot } from "./source-specifications";
import { needsTranslation, TRANSLATION_CACHE_PATH, translateGroupsFromCache, type TranslationCache } from "./specification-translation";

let cached: { until: number; promise: Promise<TranslationCache> } | undefined;
export async function translatedSpecificationGroups(groups: SourceSpecificationSnapshot["groups"]) {
  if (!groups.some(group => needsTranslation(group.name) || group.items.some(item => needsTranslation(item.name) || needsTranslation(item.value)))) return groups;
  if (!cached || cached.until < Date.now()) {
    cached = { until: Date.now() + 60_000, promise: readDataJson<TranslationCache>(TRANSLATION_CACHE_PATH, {}).catch(() => ({})) };
  }
  return translateGroupsFromCache(groups, await cached.promise);
}
