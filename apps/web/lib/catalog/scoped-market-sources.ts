import { ScopedSourceAdapter } from "./scoped-source-core";
import type { CatalogSourceAdapter } from "./types";

const gooMakes = ["TOYOTA", "NISSAN", "HONDA", "MAZDA", "MITSUBISHI", "SUBARU", "SUZUKI", "DAIHATSU", "LEXUS", "BMW", "MERCEDES_BENZ", "VOLKSWAGEN"];

export const scopedMarketSources: CatalogSourceAdapter[] = [
  new ScopedSourceAdapter({
    sourceId: "goonet_japan",
    market: "japan",
    label: "Goo-net Exchange Japan",
    baseUrl: "https://www.goo-net-exchange.com",
    currency: "USD",
    detailPattern: /\/usedcars\/(?:detail\/|[^?#]*\d{6,})/i,
    referer: "https://www.goo-net-exchange.com/usedcars/",
    listUrls: (page) => {
      const make = gooMakes[(page - 1) % gooMakes.length];
      const makePage = Math.floor((page - 1) / gooMakes.length) + 1;
      return [
        `https://www.goo-net-exchange.com/usedcars/${make}/index-${makePage}.html`,
        `https://www.goo-net-exchange.com/usedcars/${make}/?page=${makePage}`,
      ];
    },
  }),
  new ScopedSourceAdapter({
    sourceId: "che168_clean",
    market: "china",
    label: "Che168 China",
    baseUrl: "https://www.che168.com",
    currency: "CNY",
    forcedCharset: "gb18030",
    detailPattern: /\/(?:dealer|ershouche|usedcar|car|detail|spec)\/|\/\d{6,}\.html/i,
    referer: "https://www.che168.com/china/",
    listUrls: (page) => [
      `https://www.che168.com/china/a0_0msdgscncgpi1ltocsp${page}exx0/`,
      `https://www.che168.com/china/list/?page=${page}`,
    ],
  }),
  new ScopedSourceAdapter({
    sourceId: "dubicars_clean",
    market: "uae",
    label: "DubiCars UAE",
    baseUrl: "https://www.dubicars.com",
    currency: "USD",
    detailPattern: /\/[^/?#]+-\d{5,}\.html$/i,
    referer: "https://www.dubicars.com/uae/used",
    listUrls: (page) => [`https://www.dubicars.com/uae/used?page=${page}`],
  }),
  new ScopedSourceAdapter({
    sourceId: "autouncle_europe",
    market: "europe",
    label: "AutoScout24 Europe",
    baseUrl: "https://www.autoscout24.com",
    currency: "EUR",
    detailPattern: /\/offers\//i,
    referer: "https://www.autoscout24.com/lst",
    listUrls: (page) => [
      `https://www.autoscout24.com/lst?atype=C&cy=D&damaged_listing=exclude&desc=0&page=${page}&sort=standard&ustate=N%2CU`,
    ],
  }),
];

export const SCOPED_MARKET_SOURCE_IDS = scopedMarketSources.map((source) => source.sourceId);
