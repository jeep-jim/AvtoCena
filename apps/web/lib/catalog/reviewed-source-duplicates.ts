/** Reviewed duplicate advertisements, not a same-model/photo heuristic.
 * 2026-10-01: GlobalChe168 dealer 559088, spec 74339, white Roewe i5,
 * 100 km, USD 8750; the first four gallery images show the same scene.
 * 59903118 and 59896726 have identical decoded pixels; 59895611 is a
 * recompressed copy. VIN is absent: this is evidence of duplicate ads only.
 * Keep the newest source advertisement. Original records/detail URLs remain.
 * Different colours (59866429 / 59872639) and AutoHome specifications are NOT aliases.
 */
export const REVIEWED_DUPLICATE_POLICY = '2026-10-01-che168-i5';
export const REVIEWED_SOURCE_DUPLICATES = [
 {id:'48361d3deeccac1d8612ae42',sourceOfferId:'59895611',canonicalId:'39c1b3d1260fdf7f0948e795'},
 {id:'079eac8d7d05d7c53f2be510',sourceOfferId:'59896726',canonicalId:'39c1b3d1260fdf7f0948e795'},
] as const;
export function reviewedSourceDuplicate(offer:{id?:unknown;market?:unknown;sourceId?:unknown;sourceGroup?:unknown;sourceOfferId?:unknown}) {
 if(offer.market!=='china')return undefined;
 return REVIEWED_SOURCE_DUPLICATES.find(row=>row.id===offer.id);
}
export function isReviewedSourceDuplicate(offer:Parameters<typeof reviewedSourceDuplicate>[0]){return Boolean(reviewedSourceDuplicate(offer));}
