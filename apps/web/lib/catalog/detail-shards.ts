import crypto from 'node:crypto';

export type DetailShard<T> = { items: T[]; children?: true };
export function detailHash(id: string) { return crypto.createHash('sha256').update(String(id || 'unknown')).digest('hex'); }
export function detailShardPath(generationId: string, prefix: string) {
  return prefix.length === 2 ? `catalog/public/offers/${prefix}.json`
    : `catalog/generations/${generationId}/current-offers/${prefix}.json`;
}

// Split only overflowing buckets. Child objects belong to an immutable
// generation, so normal generation cleanup also removes obsolete descendants.
export function boundedDetailShards<T extends {id: string}>(rows: T[], limit = 500) {
  const result = new Map<string, DetailShard<T>>();
  const roots = new Map<string, Array<{row:T; hash:string}>>();
  for (const row of rows) {
    const hash=detailHash(row.id), prefix=hash.slice(0,2);
    if (!roots.has(prefix)) roots.set(prefix,[]);
    roots.get(prefix)!.push({row,hash});
  }
  function split(prefix:string, entries:Array<{row:T;hash:string}>) {
    if (entries.length <= limit) { result.set(prefix,{items:entries.map(entry=>entry.row)}); return; }
    if (prefix.length >= 64) throw Error('detail_shard_duplicate_or_hash_collision');
    result.set(prefix,{items:[],children:true});
    const children=new Map<string,typeof entries>();
    for (const entry of entries) {
      const key=entry.hash.slice(0,prefix.length+1);
      if (!children.has(key)) children.set(key,[]);
      children.get(key)!.push(entry);
    }
    for (const [key,child] of children) split(key,child);
  }
  for (const [key,entries] of roots) split(key,entries);
  return result;
}
