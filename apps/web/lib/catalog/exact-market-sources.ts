import type { CatalogSourceAdapter } from "./types";
import { che168ChinaExactSource } from "./che168-exact-source";
import { goonetJapanExactSource } from "./goonet-exact-source";
import { dubicarsUaeExactSource } from "./dubicars-exact-source";
import { otomotoEuropeExactSource } from "./otomoto-exact-source";

export const exactMarketSources: CatalogSourceAdapter[] = [
  che168ChinaExactSource,
  goonetJapanExactSource,
  dubicarsUaeExactSource,
  otomotoEuropeExactSource,
];

export const EXACT_MARKET_SOURCE_IDS = exactMarketSources.map((source) => source.sourceId);
