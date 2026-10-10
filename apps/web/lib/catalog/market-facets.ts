import {readCatalogFacets,type CatalogFacets} from './storage';
import type {CatalogSearchParams} from './types';

// The grouped page already reads individual market selectors. Share those reads
// instead of downloading the much larger all-market selector again for options.
export async function readGroupedCatalogFacets(params:CatalogSearchParams,markets:string[],read=readCatalogFacets):Promise<CatalogFacets>{
 const parts:CatalogFacets[]=[];let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,markets.length)},async()=>{
  while(cursor<markets.length){const index=cursor++;parts[index]=await read({...params,market:markets[index]});}
 }));
 const values=(key:'makes'|'markets'|'bodyTypes'|'fuels'|'transmissions'|'drives')=>[...new Set(parts.flatMap(part=>part[key]))].sort((a,b)=>a.localeCompare(b,'ru'));
 const models=[...new Map(parts.flatMap(part=>part.models).map(row=>[`${row.make}\0${row.model}`,row])).values()].sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,'ru'));
 return {generationId:parts[0]?.generationId||'',makes:values('makes'),models,markets:values('markets'),bodyTypes:values('bodyTypes'),fuels:values('fuels'),transmissions:values('transmissions'),drives:values('drives')};
}
