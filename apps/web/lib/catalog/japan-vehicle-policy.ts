/** Explicit Japan catalog exclusions requested by the owner on 22.10.2026.
 * Independent of logo availability: do not remove passenger makes for a missing asset.
 */
const excluded=['FRUEHAUF','GM','HINO','HITACHI','KOMATSU','OTHERS','SUMITOMO','TADANO','TCM','TRAILER'];
export const japanExcludedMake=(make:unknown)=>excluded.includes(String(make||'').normalize('NFKC').trim().toUpperCase());
export const japanMakeSqlExclusion=()=>`marka_name not in (${excluded.map(v=>"'"+v+"'").join(',')})`;
