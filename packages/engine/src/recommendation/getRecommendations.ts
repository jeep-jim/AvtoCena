import type { RecommendationInput, RecommendedCar } from "../types";

export function getRecommendations(input: RecommendationInput): RecommendedCar[] {
  return [
    {
      id: "audi-a3-china-2023",
      title: "Audi A3 Sportback",
      market: "Китай",
      year: 2023,
      fuel: "Бензин",
      powerHp: 150,
      estimatedPriceRub: 2560000
    },
    {
      id: "toyota-harrier-japan-2021",
      title: "Toyota Harrier",
      market: "Япония",
      year: 2021,
      fuel: "Гибрид",
      powerHp: 178,
      estimatedPriceRub: 3180000
    },
    {
      id: "kia-k5-korea-2022",
      title: "Kia K5",
      market: "Корея",
      year: 2022,
      fuel: "Бензин",
      powerHp: 180,
      estimatedPriceRub: 2850000
    }
  ].filter((car) => !input.budgetRub || car.estimatedPriceRub <= input.budgetRub * 1.15);
}
