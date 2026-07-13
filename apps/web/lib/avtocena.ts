import { readDataJson } from "./data";
import { searchVehicleOffers, toAvtocenaCase } from "./catalog";

export type MoneyLine = {
  id: string;
  title: string;
  amountRub: number;
  kind?: "car" | "logistics" | "customs" | "service" | "commission" | "deposit";
  note?: string;
};

export type AvtocenaCase = {
  id: string;
  brand: string;
  model: string;
  title: string;
  market: "china" | "japan" | "korea" | "uae" | "europe";
  marketName: string;
  year: number;
  body: string;
  bodyName: string;
  fuel: string;
  transmission: string;
  drive: string;
  powerHp: number;
  engineVolumeCc?: number;
  mileageKm?: number;
  city: string;
  deliveryDays: string;
  totalRub?: number;
  currency?: string;
  exchangeRate?: number;
  sourcePrice?: number;
  sourcePriceLocal?: number;
  sourceCurrency?: string;
  calculationComplete?: boolean;
  calculationStatus?: string;
  tags: string[];
  lines: MoneyLine[];
  process: string[];
  recommendation: string;
  offer?: import("./catalog/types").VehicleOffer;
};

export type AvtocenaSearchInput = {
  budgetRub?: number;
  brand?: string;
  model?: string;
  yearFrom?: number;
  market?: string;
  body?: string;
  fuel?: string;
  transmission?: string;
  drive?: string;
  powerFrom?: number;
  mileageTo?: number;
};

export function parseRub(value?: string | string[] | null) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const num = Number(String(raw).replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export function one(value?: string | string[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

export function money(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function getAvtocenaCases() {
  return readDataJson<AvtocenaCase[]>("examples/avtocena-cases.json", []);
}

export function getAvtocenaResults(input: AvtocenaSearchInput) {
  const cases = searchVehicleOffers(input).map(toAvtocenaCase);
  const brand = input.brand?.trim().toLowerCase();
  const model = input.model?.trim().toLowerCase();
  const budget = input.budgetRub;

  return cases
    .filter((item) => {
      if (brand && !item.brand.toLowerCase().includes(brand) && !item.title.toLowerCase().includes(brand)) return false;
      if (model && !item.model.toLowerCase().includes(model) && !item.title.toLowerCase().includes(model)) return false;
      if (input.yearFrom && item.year < input.yearFrom) return false;
      if (input.market && input.market !== "any" && item.market !== input.market) return false;
      if (input.body && input.body !== "any" && item.body !== input.body) return false;
      if (budget && (!item.calculationComplete || !item.totalRub || item.totalRub > budget * 1.18)) return false;
      return true;
    })
    .map((item) => ({
      ...item,
      score: budget && item.calculationComplete && item.totalRub ? Math.abs(item.totalRub - budget) : Number.MAX_SAFE_INTEGER,
      budgetDeltaRub: budget && item.calculationComplete && item.totalRub ? budget - item.totalRub : undefined,
      isInBudget: budget ? Boolean(item.calculationComplete && item.totalRub && item.totalRub <= budget) : Boolean(item.calculationComplete)
    }))
    .sort((a, b) => {
      if (a.isInBudget !== b.isInBudget) return a.isInBudget ? -1 : 1;
      return a.score - b.score;
    });
}

export function getSearchInputFromParams(searchParams: Record<string, string | string[] | undefined>) {
  return {
    budgetRub: parseRub(searchParams.budget),
    brand: one(searchParams.brand),
    model: one(searchParams.model),
    yearFrom: parseRub(searchParams.yearFrom),
    market: one(searchParams.market) || "any",
    body: one(searchParams.body) || "any",
    fuel: one(searchParams.fuel),
    transmission: one(searchParams.transmission),
    drive: one(searchParams.drive),
    powerFrom: parseRub(searchParams.powerFrom),
    mileageTo: parseRub(searchParams.mileageTo)
  } satisfies AvtocenaSearchInput;
}

export function buildQueryFromInput(input: AvtocenaSearchInput) {
  const params = new URLSearchParams();
  if (input.budgetRub) params.set("budget", String(input.budgetRub));
  if (input.brand) params.set("brand", input.brand);
  if (input.model) params.set("model", input.model);
  if (input.yearFrom) params.set("yearFrom", String(input.yearFrom));
  if (input.market) params.set("market", input.market);
  if (input.body) params.set("body", input.body);
  return params.toString();
}
