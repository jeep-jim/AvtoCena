import type {PublicVehicleOffer} from '@/lib/catalog/types';

export type RelatedRecommendations = {
  kind: 'related';
  current: {id:string;market:string};
  make:string; familyModel:string; greenCurrent:boolean;
  modelTitle:string; marketLabel:string; marketTotal:number|null;
  stockModels:PublicVehicleOffer[]; sameModel:PublicVehicleOffer[];
  crossMarketGroups:{market:string;items:PublicVehicleOffer[]}[];
  marketRows:PublicVehicleOffer[];
  partial:boolean;
};
export type AlternativeRecommendations = {
  kind:'alternatives'; title:string; items:PublicVehicleOffer[]; partial:boolean;
};
export type OfferRecommendations = RelatedRecommendations | AlternativeRecommendations;
