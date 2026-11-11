import {createHash} from 'node:crypto';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Private immutable checkpoints; never publish a partial calculation index. */
export async function prepareWithCheckpoints({storage, rows, context, compile, batchSize = 50, concurrency = 6, progress = () => {}}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 250 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 6) throw Error('invalid_preparation_bounds');
  const batches = Array.from({length: Math.ceil(rows.length / batchSize)}, (_, i) => rows.slice(i * batchSize, (i + 1) * batchSize));
  const output = new Array(batches.length);
  let cursor = 0, stopped = false, completed = 0, reused = 0;
  const workers = await Promise.allSettled(Array.from({length: concurrency}, async () => {
    while (!stopped) {
      const position = cursor++;
      if (position >= batches.length) return;
      const batch = batches[position];
      const identity = batch.map(row => [row.id, row.revision, row.key]);
      const fingerprint = digest({context, identity});
      const key = `knowledge/encyclopedia/preparation-v1/${fingerprint}.json`;
      const validate = value => {
        if (value?.version !== 1 || value.fingerprint !== fingerprint || !Array.isArray(value.items) || value.items.length !== batch.length || value.digest !== digest(value.items)) throw Error('encyclopedia_checkpoint_invalid');
        return value.items;
      };
      try {
        const saved = await storage.readJson(key, null);
        if (saved) { output[position] = validate(saved); reused += batch.length; }
        else {
          const items = [];
          for (const row of batch) items.push(await compile(row));
          const value = {version: 1, fingerprint, digest: digest(items), items};
          try { await storage.writeJson(key, value, {ifNoneMatch: '*'}); }
          catch (error) {
            // Another release can finish this exact immutable batch concurrently.
            if (!/^object_storage_PUT_(409|412):/.test(String(error?.message))) throw error;
          }
          const readback = await storage.readJson(key, null);
          output[position] = validate(readback);
          if (readback.digest !== value.digest) throw Error('encyclopedia_checkpoint_conflict');
        }
        completed += batch.length;
        progress({modelsCompleted: completed, modelsReused: reused, totalModels: rows.length});
      } catch (error) { stopped = true; throw error; }
    }
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  if (completed !== rows.length) throw Error('encyclopedia_preparation_incomplete');
  return output.flat();
}
