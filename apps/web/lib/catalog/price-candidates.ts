/** Evaluate only the candidate prefix needed by a small recommendation rail. */
export async function priceCandidatesUntil<T>(
  candidates: T[],
  price: (rows: T[]) => Promise<T[]>,
  renderable: (row: T) => boolean,
  enough: (rows: T[]) => boolean,
  batchSize = 4,
): Promise<T[]> {
  const accepted: T[] = [];
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    accepted.push(...(await price(candidates.slice(offset, offset + batchSize))).filter(renderable));
    if (enough(accepted)) break;
  }
  return accepted;
}
