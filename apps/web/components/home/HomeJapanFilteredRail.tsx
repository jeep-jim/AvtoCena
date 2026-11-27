'use client';
import {useEffect,useState} from 'react';
import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {CatalogCard} from '@/components/catalog/CatalogCard';
import {CatalogSectionLoading} from '@/components/catalog/CatalogLoading';
import {JapanRailFrame,japanRailHref,japanSavedPreviewText,type JapanRailParams} from '@/components/catalog/JapanRailFrame';
import {MarketResultCount} from '@/components/catalog/MarketResultCount';
import {MARKET_RAIL_CLASS} from '@/components/catalog/market-rail-layout';
import {ajesCountText,exactAjesCount,type AjesCountSummary} from '@/lib/catalog/ajes-count-display';

type Preview={disabled:boolean;items:any[];count:AjesCountSummary|null;stale:boolean;partial:boolean;hasMore:boolean;observedAt?:string};

/** One user-requested preview; the catalogue link owns normal continuation. */
export async function readHomeJapanPreview(params:JapanRailParams,signal:AbortSignal):Promise<Preview> {
 const query=new URLSearchParams(Object.entries(params).flatMap(([key,value])=>value?[[key,Array.isArray(value)?value[0]:value]]:[]));
 query.set('market','japan');query.set('page','1');query.set('pageSize','24');
 query.delete('after');query.delete('source');query.delete('countOnly');
 const response=await fetch('/api/catalog/search?'+query.toString(),{cache:'no-store',signal});
 const result=await response.json().catch(()=>null);
 if(response.status===503&&result?.ok===false&&result.error==='japan_search_unavailable'&&result.reason==='source_disabled')return {disabled:true,items:[],count:null,stale:false,partial:false,hasMore:false};
 if(!response.ok)throw Error('japan_preview_unavailable');
 if(result?.ok!==true||!Array.isArray(result.items))throw Error('japan_preview_invalid');
 return {disabled:false,items:result.items.slice(0,6),count:result.countSummary??null,stale:Boolean(result.stale),partial:Boolean(result.partial),hasMore:Boolean(result.hasMore),observedAt:typeof result.observedAt==='string'?result.observedAt:undefined};
}

export function HomeJapanFilteredRail({params}:{params:JapanRailParams}) {
 const queryKey=JSON.stringify(params);
 const [loaded,setLoaded]=useState<(Preview&{key:string})|null>(null);
 const [status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  setStatus('loading');
  readHomeJapanPreview(JSON.parse(queryKey),controller.signal).then(value=>{
   if(controller.signal.aborted)return;
   setLoaded({...value,key:queryKey});setStatus('ready');
  }).catch(()=>{if(!controller.signal.aborted)setStatus('error');});
  return ()=>controller.abort();
 },[queryKey,attempt]);
 const current=loaded?.key===queryKey;
 const count=current?loaded.count:null;
 const pending=status==='loading'||(!current&&status!=='error');
 const href=japanRailHref(params);
 if(current&&loaded.disabled)return null;
 return <JapanRailFrame params={params} busy={pending} status={pending?'loading':status==='error'?'unavailable':loaded?.items.length?'ready':'empty'} count={<MarketResultCount total={exactAjesCount(count)}>{ajesCountText(count)}</MarketResultCount>}>
  {pending?<CatalogSectionLoading active/>:null}
  {loaded&&!current?<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">Пока показана предыдущая подборка. Новые условия ещё не применены.</p>:null}
  {status==='error'?<p role="status" className="mb-3 rounded-xl border border-[var(--ac-border)] p-4 text-sm">Не удалось обновить автомобили. <button type="button" className="underline" onClick={()=>setAttempt(value=>value+1)}>Повторить</button> · <Link href={href} className="underline">Открыть каталог</Link></p>:null}
  {current&&(loaded.stale||loaded.partial)?<p role="status" className="mb-3 text-sm text-[var(--ac-muted)]">{loaded.stale?japanSavedPreviewText(loaded.observedAt):'Показана доступная часть подборки.'}</p>:null}
  {loaded?.items.length?<div className={MARKET_RAIL_CLASS}>{loaded.items.map(offer=><div key={offer.id} className="min-w-0"><CatalogCard offer={offer} compact dense/></div>)}</div>:status==='ready'?<p role="status" className="text-sm text-[var(--ac-muted)]">{loaded?.partial||loaded?.stale||loaded?.hasMore?'В загруженной подборке совпадений нет.':exactAjesCount(count)===0?'По выбранным параметрам автомобили не найдены.':'В этой подборке автомобили пока не отображаются.'} <Link href={href} className="underline">Продолжить поиск</Link></p>:null}
 </JapanRailFrame>;
}
