import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const need = (value, code) => { if (!value) throw Error('readonly_invocation_' + code); };
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

/** Local, read-only Git verification. The caller owns the fixed marker path and
 * operation; neither comes from workflow inputs or marker-controlled code. */
export function verifyReadonlyInvocation({root, env = process.env, markerPath, operation,
  manualSourceSha = env.EXPECTED_CONTROLLER_SHA}) {
  need(env.GITHUB_REPOSITORY === 'jeep-jim/AvtoCena'
    && env.GITHUB_REPOSITORY_ID === '1289722938', 'repository');
  need(env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_RUN_ATTEMPT === '1', 'ref_or_attempt');
  need(['workflow_dispatch', 'push'].includes(env.GITHUB_EVENT_NAME), 'event');
  need(isSha(env.GITHUB_SHA), 'head_format');
  need(typeof markerPath === 'string' && /^\.github\/market-runs\/[a-z0-9-]+\.json$/.test(markerPath)
    && typeof operation === 'string' && /^[a-z0-9-]+$/.test(operation), 'fixed_profile');
  const git = args => {
    try {
      return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
        {cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'], maxBuffer:65536});
    } catch { throw Error('readonly_invocation_git_unverified'); }
  };
  const sourceSha = git(['rev-parse', '--verify', 'HEAD']).trim();
  need(sourceSha === env.GITHUB_SHA, 'head_mismatch');
  // Ignore unrelated untracked output receipts, but reject changes to any
  // tracked controller, marker, staged file or other tracked source.
  git(['diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    need(isSha(manualSourceSha) && manualSourceSha === sourceSha, 'manual_source');
    return {version:1, event:'workflow_dispatch', sourceSha, approvedSourceSha:sourceSha, markerPath:null};
  }

  const treeEntry = git(['ls-tree', '-z', 'HEAD', '--', markerPath]);
  need(treeEntry.startsWith('100644 blob ') && treeEntry.endsWith('\t' + markerPath + '\0')
    && treeEntry.split('\0').length === 2, 'marker_regular_file');
  let marker;
  try { marker = JSON.parse(git(['show', sourceSha + ':' + markerPath])); }
  catch { throw Error('readonly_invocation_marker_json'); }
  need(marker && typeof marker === 'object' && !Array.isArray(marker)
    && Object.keys(marker).sort().join(',') === 'approvedSourceSha,operation,version'
    && marker.version === 1 && marker.operation === operation && isSha(marker.approvedSourceSha), 'marker_contract');
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
  need(parents.length === 2 && parents[0] === sourceSha && parents[1] === marker.approvedSourceSha,
    'approved_parent');
  const changed = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z',
    marker.approvedSourceSha, sourceSha, '--']).split('\0');
  need(changed.length === 3 && ['A', 'M'].includes(changed[0]) && changed[1] === markerPath
    && changed[2] === '', 'marker_only_diff');

  // The accepted parent must already be the pre-push main tip. This excludes a
  // push that smuggles a new controller commit immediately before its marker.
  let event;
  try { event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')); }
  catch { throw Error('readonly_invocation_push_event_unverified'); }
  need(event?.before === marker.approvedSourceSha && event.after === sourceSha
    && event.ref === 'refs/heads/main' && event.created === false
    && event.deleted === false && event.forced === false, 'push_transition');
  return {version:1, event:'push', sourceSha, approvedSourceSha:marker.approvedSourceSha, markerPath};
}
