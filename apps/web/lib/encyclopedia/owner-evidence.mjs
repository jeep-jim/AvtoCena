// Owner assertions stay distinct from manufacturer certification.
export function isOwnerConfirmedEvidence(source) {
 return source?.type === 'owner_confirmed'
  && source.confirmedByOwner === true
  && /^[a-f0-9]{64}$/.test(source.attachmentSha256 || '')
  && Number.isInteger(source.tableRow) && source.tableRow > 0
  && typeof source.powerEvidenceDocument === 'string' && source.powerEvidenceDocument.length > 0
  && /^https:\/\/github\.com\/jeep-jim\/AvtoCena\/blob\/(?:main|[a-f0-9]{40})\/docs\/encyclopedia\/owner-references\//.test(source.url || '');
}
