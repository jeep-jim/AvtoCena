import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// The installed 22867 image was built with this exact index from release 83ff.
// Image build 44729399751 verified the digest but only registered the parent.
const inheritedIndex = {
  release: '22867cbcfaee27b2e8917b6bf880e44827f67b60',
  parent: '83ff17075e9188dcf227c8752dc064248d5f42e0',
  digest: 'bf2c72cb7a260ef093c0a43c2b0dad9c4c9094a4d6dc3811dd0d7f7626b0d72b',
};

/** Off-server warmup must use the same private immutable index as the live image. */
export async function restoreReleaseEncyclopedia(storage, root, release) {
  try { await fs.access(path.join(root, 'apps/web/lib/encyclopedia/calculation-index.ts')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const readBinding = sha => storage.readJson('knowledge/encyclopedia/calculation-releases/' + sha + '.json', null);
  let binding = await readBinding(release);
  let boundRelease = release;
  if (binding === null && release === inheritedIndex.release) {
    boundRelease = inheritedIndex.parent;
    binding = await readBinding(boundRelease);
  }
  if (!binding || binding.release !== boundRelease || !/^[a-f0-9]{64}$/.test(binding.digest || '') ||
      binding.key !== 'knowledge/encyclopedia/calculation-indexes/' + binding.digest + '.json' ||
      (release === inheritedIndex.release && binding.digest !== inheritedIndex.digest)) {
    throw Error('live_encyclopedia_binding_missing');
  }
  const index = await storage.readJson(binding.key, null);
  if (index?.version !== 1 || index.digest !== binding.digest || !index.models ||
      createHash('sha256').update(JSON.stringify(index.models)).digest('hex') !== binding.digest) {
    throw Error('live_encyclopedia_index_invalid');
  }
  const target = path.join(root, 'data/knowledge/encyclopedia/calculation-v1.json');
  await fs.mkdir(path.dirname(target), {recursive:true});
  await fs.writeFile(target, JSON.stringify(index));
  return index.digest;
}
