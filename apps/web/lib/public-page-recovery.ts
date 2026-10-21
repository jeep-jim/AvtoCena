/** One retry for a route/error within five minutes, also across a hard reload. */
export function claimPageRecovery(storage:Pick<Storage,'getItem'|'setItem'>,path:string,digest:string,now=Date.now()){
 const key='avtocena.page-recovery.v1';
 try{const old=JSON.parse(storage.getItem(key)||'null');if(old?.path===path&&old?.digest===digest&&now-old.at<300000)return false;storage.setItem(key,JSON.stringify({path,digest,at:now}));return true;}catch{return false;}
}
