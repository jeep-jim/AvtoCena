export type PrestigePlanModelEntry<TModel> = {
  model: TModel;
  modelIndex: number;
};

export type PrestigePlanMakeEntry<TMake, TModel> = {
  make: TMake;
  makeIndex: number;
  models: PrestigePlanModelEntry<TModel>[];
};

export type PrestigePlanCandidate<TMake, TModel> = PrestigePlanModelEntry<TModel> & {
  make: TMake;
  makeIndex: number;
};

/**
 * Traverse every make in round-robin order while treating the daily start as
 * a circular offset per make. An offset such as 99 must not skip a make that
 * only has 20 models; it starts at 19 and still visits all 20 exactly once.
 */
export function rotatedPrestigePlanCandidates<TMake, TModel>(
  entries: PrestigePlanMakeEntry<TMake, TModel>[],
  startModelIndex: number,
): PrestigePlanCandidate<TMake, TModel>[] {
  const normalizedStart = Math.max(0, Math.trunc(Number(startModelIndex) || 0));
  const longestList = entries.reduce((max, entry) => Math.max(max, entry.models.length), 0);
  const candidates: PrestigePlanCandidate<TMake, TModel>[] = [];

  for (let step = 0; step < longestList; step++) {
    for (const entry of entries) {
      const length = entry.models.length;
      if (!length || step >= length) continue;
      const candidate = entry.models[(normalizedStart % length + step) % length];
      candidates.push({
        make: entry.make,
        makeIndex: entry.makeIndex,
        model: candidate.model,
        modelIndex: candidate.modelIndex,
      });
    }
  }

  return candidates;
}

export async function mapWithConcurrency<T, R>(
  rows: T[],
  concurrency: number,
  worker: (row: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(rows.length || 1, Math.trunc(Number(concurrency) || 1)));
  const output = new Array<R>(rows.length);
  let cursor = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index], index);
    }
  }));

  return output;
}
