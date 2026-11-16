import {readRawCoordinationPolicy} from '../../apps/web/lib/catalog/raw-coordination-gate.mjs';
import {snapshotBinding} from './che168-snapshot.mjs';
import {commitRawPointer} from './catalog-raw-session.mjs';

export const CHE168_RAW_CONFIG_KEY = 'catalog/raw-feed-config/v1/che168-snapshot.json';

/** The repo config itself cannot participate in an S3 CAS. A producer first
 * claims its selected root, then records this exact file's immutable binding
 * in the common pointer registry before consuming or archiving any raw bytes. */
export async function commitChe168RawConfig({storage, config, owner}) {
  if (!await readRawCoordinationPolicy(storage)) return {status: 'disabled'};
  const binding = snapshotBinding(config);
  return commitRawPointer({storage, id: 'che168_snapshot_config', key: CHE168_RAW_CONFIG_KEY,
    value: {version: 1, binding, config}, references: [{kind: 'che168-snapshot', root: `catalog/provider-snapshots/che168/${binding}`}],
    complete: true, owner, operationId: `che168-config-${owner.runId}-${owner.attempt}`});
}
