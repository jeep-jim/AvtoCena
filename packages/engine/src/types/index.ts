export type Market = "japan" | "china" | "korea" | "uae" | "europe";

export type RecommendationInput = {
  budgetRub?: number;
  brand?: string;
  model?: string;
  yearFrom?: number;
  market?: Market | "any";
};

export type RecommendedCar = {
  id: string;
  title: string;
  market: string;
  year: number;
  fuel: string;
  powerHp: number;
  estimatedPriceRub: number;
};
