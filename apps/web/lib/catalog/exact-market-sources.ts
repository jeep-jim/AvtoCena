import type { CatalogSourceAdapter } from "./types";
import { che168DealerResilientSource } from "./che168-dealer-resilient-source";
import { che168ChinaExactSource } from "./che168-exact-source";
import { goonetJapanExactSource } from "./goonet-exact-source";
import { dubicarsUaeExactSource } from "./dubicars-exact-source";
import { otomotoEuropeCurrentSource } from "./otomoto-current-source";
import { guaziChinaExportSource } from "./guazi-export-source";

export const exactMarketSources: CatalogSourceAdapter[] = [
  guaziChinaExportSource,
  che168DealerResilientSource,
  che168ChinaExactSource,
  goonetJapanExactSource,
  dubicarsUaeExactSource,
  otomotoEuropeCurrentSource,
];

export const EXACT_MARKET_SOURCE_IDS = exactMarketSources.map((source) => source.sourceId);
