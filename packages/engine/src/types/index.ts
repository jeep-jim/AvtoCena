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

export type BusinessAmountType = "fixed" | "percent" | "calculated" | "manual";

export type MarketBusinessConfig = {
  id?: string;
  version?: number;
  effectiveFrom?: string;
  currency?: string;
  topAvtoCommissionRub?: number | null;
  securityDepositRub?: number | null;
  contractInitialPaymentRub?: number | null;
  exchangeRateReservePercent?: number | null;
  exportExpensesRub?: number | null;
  logisticsRub?: number | null;
  brokerRub?: number | null;
  svhRub?: number | null;
  laboratoryRub?: number | null;
  sbktsRub?: number | null;
  eptsRub?: number | null;
  rfDeliveryRub?: number | null;
  otherFixedExpensesRub?: number | null;
  percentExpenses?: { id: string; title: string; percent: number; base?: "source" | "subtotal" | "total" }[];
};

export type BusinessCalculationInput = {
  marketId: Market;
  marketConfig: MarketBusinessConfig;
  sourcePriceRub?: number;
  carPriceRub?: number;
  customsRub?: number;
  cityDeliveryRub?: number;
  deliveryCity?: string;
  manualAdjustmentRub?: number;
  manualAdjustmentReason?: string;
};

export type BusinessCalculationLine = {
  id: string;
  title: string;
  amountRub: number;
  kind: "car" | "deposit" | "commission" | "logistics" | "customs" | "service" | "reserve" | "adjustment" | "other";
  amountType: BusinessAmountType;
  source: "market_config" | "vehicle" | "manager" | "calculated";
  note?: string;
};

export type BusinessCalculationResult = {
  marketId: Market;
  configVersion: string;
  effectiveFrom?: string;
  deliveryCity?: string;
  totalRub: number;
  breakdown: BusinessCalculationLine[];
  snapshot: {
    configVersion: string;
    effectiveFrom?: string;
    marketConfig: MarketBusinessConfig;
    breakdown: BusinessCalculationLine[];
  };
};
