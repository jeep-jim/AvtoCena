/** Public recommendation payload. It contains no provider configuration or raw records. */
export type RelatedOffersPayload = {
  current: {market:string; greenCurrent:boolean; liveStock:boolean};
  make:string;
  familyModel:string;
  modelTitle:string;
  marketLabel:string;
  marketTotal:number|null;
  stockModels:any[];
  sameModel:any[];
  crossMarketGroups:Array<{market:string; items:any[]}>;
  marketRows:any[];
  partial:boolean;
};
