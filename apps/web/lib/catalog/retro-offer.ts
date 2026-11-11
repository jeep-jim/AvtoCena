/** Display category requested by the owner; not a customs or legal classification. */
export function isRetroOffer(offer: {year?: unknown} | null | undefined): boolean {
  const year = Number(offer?.year);
  return Number.isInteger(year) && year >= 1886 && year < 1990;
}
