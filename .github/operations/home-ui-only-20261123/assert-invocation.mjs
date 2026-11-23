import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../../../scripts/lib/readonly-marker-invocation.mjs';

try {
  if (process.argv.length !== 2) throw Error('readonly_invocation_arguments_not_allowed');
  const receipt = verifyReadonlyInvocation({root:fileURLToPath(new URL('../../../', import.meta.url)),
    markerPath:'.github/market-runs/home-ui-runtime-inventory.json',
    operation:'read-home-ui-runtime-20261123'});
  console.log(JSON.stringify(receipt));
} catch (error) { console.error(error.message); process.exitCode = 1; }
