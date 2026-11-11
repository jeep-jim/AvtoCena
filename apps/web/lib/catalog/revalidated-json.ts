import type {JsonStorage} from '../data';

/** Retain one bounded parsed object between freshness checks. A matching ETag
 * avoids downloading and parsing unchanged mutable inputs; errors never serve
 * an unchecked stale copy. The caller owns the freshness interval/coalescing. */
export class RevalidatedJson<T> {
 private retained: {storage:JsonStorage;path:string;etag:string;value:T}|null=null;
 constructor(private readonly maxBytes:number) {}
 async read(storage:JsonStorage,path:string,fallback:T):Promise<T> {
  const previous=this.retained;
  if(previous?.storage===storage && previous.path===path && storage.readObjectMetadata){
   const metadata=await storage.readObjectMetadata(path);
   if(metadata.found && metadata.etag && metadata.etag===previous.etag)return previous.value;
   if(!metadata.found){this.retained=null;return fallback;}
  }
  const result=await storage.readJsonWithMeta<T>(path,fallback);
  this.retained=null;
  if(result.found && result.etag && Buffer.byteLength(JSON.stringify(result.value),'utf8')<=this.maxBytes){
   this.retained={storage,path,etag:result.etag,value:result.value};
  }
  return result.value;
 }
}
