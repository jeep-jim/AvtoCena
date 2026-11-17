import assert from 'node:assert/strict';
import {verifyPaidPublicContribution,verifyPaidInternalContribution} from './catalog-paid-encar-contributions.mjs';
import {verifyChe168PublicContribution,verifyChe168InternalContribution} from './catalog-che168-contributions.mjs';

/** Only closed, audited source instances may replace dependencies. The
 * generic factory is not a registration mechanism for trusted producers. */
export async function verifyIndependentPublicContribution(options) {
  const market=options.market??options.intake?.market;
  if(market==='korea')return verifyPaidPublicContribution({...options,market});
  if(market==='china')return verifyChe168PublicContribution({...options,market});
  assert.fail('source_contribution_public_authority');
}
export async function assertIndependentPublicContribution(options) {
  return (await verifyIndependentPublicContribution(options)).reference;
}

export async function verifyIndependentInternalContribution(options) {
  const market=options.market??options.intake?.market;
  if(market==='korea')return verifyPaidInternalContribution({...options,market});
  if(market==='china')return verifyChe168InternalContribution({...options,market});
  assert.fail('source_contribution_internal_authority');
}
