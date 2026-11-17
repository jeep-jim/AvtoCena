/** Keep a selected, published paid Korea source until its owner changes the source switch.
 * paidEncarInput is set only after the publisher validates the complete paid snapshot.
 * Call under the publication lease and again at every manifest-commit checkpoint.
 */
export async function assertPaidKoreaPublicationSource({market, paidEncarInput, readManifest, readControls}) {
  if (market !== 'korea' || paidEncarInput === true) return;
  // These callbacks must read storage directly: a preparation-time snapshot or
  // the public five-second CRM cache cannot authorize a later source replacement.
  const [manifest, controls] = await Promise.all([readManifest(), readControls()]);
  if (manifest?.markets?.korea?.provider === 'auto_api_encar'
      && controls?.sources?.encar_feed?.enabled === true) {
    throw Error('catalog_paid_korea_source_guard_protected');
  }
}
