/** Owner retired this charge on 2026-09-19. Old stored settings cannot revive it. */
export function activeMarketCosts<T extends Record<string, any>>(input: T): Omit<T, 'exportExpensesRub'> {
  const {exportExpensesRub: retired, ...active} = input;
  return active;
}
