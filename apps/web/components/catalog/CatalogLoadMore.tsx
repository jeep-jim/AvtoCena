"use client";
import Link from 'next/link';
import {useDealerBrowsing} from "@/components/dealers/DealerBrowsingContext";
import {dealerBrowsingHref} from "@/lib/dealers/browsing-context";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {useCatalogResultCount} from './CatalogSelectionContext';
import {CatalogPagination} from "./CatalogPagination";

import { loadMoreGreenCorner } from "./green-corner-load-more-action";
import { loadMoreCatalog } from "./catalog-load-more-action";
import type { CatalogSearchParams } from "@/lib/catalog/types";

type Batch = {incomplete?:boolean;cursor?:string; nextCursor?:string|null;hasMore?:boolean;page: number; cards: ReactNode; count: number};
type Saved = {batches: Batch[]; total: number|null; scrollY: number; savedAt: number};
// React nodes remain in this tab, never serialized into cookies or sent back to
// the server. Returning from a detail page restores already fetched batches.
const visits = new Map<string, Saved>();
const TTL = 30 * 60_000;

export function CatalogLoadMore({query, initialPage, initialTotal, initialCount, initialCards, greenQuery, initialHasMore, initialNextCursor, resultCountLabel, resultQueryKey, initialIncomplete=false}: {
  resultQueryKey?:string; resultCountLabel?:string; initialIncomplete?:boolean;
  initialNextCursor?:string|null; initialHasMore?:boolean; greenQuery?: Record<string,string|undefined>; query: CatalogSearchParams; initialPage: number; initialTotal: number|null; initialCount: number; initialCards: ReactNode;
}) {
  const dealer=useDealerBrowsing();
  const streamedCount=useCatalogResultCount();
  const green = greenQuery !== undefined;
  const basePath = green ? "/cars/green" : "/cars";
  const key = JSON.stringify([dealer?.id,basePath, greenQuery, Object.entries(query).sort(([a],[b])=>a.localeCompare(b)), initialPage]);
  const [batches, setBatches] = useState<Batch[]>([{incomplete:initialIncomplete,page: initialPage, cards: initialCards, count: initialCount, hasMore:initialHasMore, cursor:query.after, nextCursor:initialNextCursor}]);
  const [total, setTotal] = useState(initialTotal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prepared = useRef<{key:string;page:number;at:number;promise:ReturnType<typeof loadMoreCatalog> | ReturnType<typeof loadMoreGreenCorner>} | null>(null);
  const activeKey = useRef(key);
  activeKey.current = key;
  const lock = useRef(false);
  const mounted = useRef(true);
  const list = useRef<HTMLDivElement>(null);
  const live = useRef({batches, total});
  live.current = {batches, total};

  useLayoutEffect(() => {
    mounted.current = true;
    const saved = visits.get(key);
    if (saved && Date.now() - saved.savedAt < TTL && saved.total === initialTotal) {
      setBatches(saved.batches); setTotal(saved.total);
      // Two frames allow the restored cards to establish their layout first.
      let second = 0;
      const frame = requestAnimationFrame(() => {second = requestAnimationFrame(() => window.scrollTo({top: saved.scrollY, behavior: "instant"}));});
      return () => {cancelAnimationFrame(frame); cancelAnimationFrame(second); mounted.current = false;};
    }
    return () => {mounted.current = false;};
  }, [key, initialTotal]);

  useEffect(() => {
    const save = () => {
      visits.delete(key);
      visits.set(key, {...live.current, scrollY: window.scrollY, savedAt: Date.now()});
      while (visits.size > 6) visits.delete(visits.keys().next().value!);
    };
    // Save before navigation, so a later effect cleanup cannot capture the
    // detail page's reset scroll position instead of the catalog position.
    const click = (event: MouseEvent) => {
      if ((event.target as Element)?.closest?.('a[href*="/cars/offer/"]')) save();
    };
    document.addEventListener("click", click, true);
    window.addEventListener("pagehide", save);
    return () => {document.removeEventListener("click", click, true); window.removeEventListener("pagehide", save);};
  }, [key]);

  const fallbackQuery = new URLSearchParams(Object.entries(query).filter(([,value]) => value != null && value !== "").map(([key,value])=>[key,String(value)]));
  if (green) { fallbackQuery.delete("market"); for(const [key,value] of Object.entries(greenQuery)) if(value) fallbackQuery.set(key,value); }
  const count = batches.reduce((sum, batch) => sum + batch.count, 0);
  const page = batches[batches.length - 1].page;
  const cursorPaging=initialNextCursor!==undefined;
  const nextCursor=batches.at(-1)!.nextCursor;
  fallbackQuery.delete("after");
  if(cursorPaging&&nextCursor)fallbackQuery.set("after",nextCursor);
  fallbackQuery.set("page", String(page + 1));
  // The header's delayed aggregate belongs to this exact query, never a previous filter.
  const sharedTotal=resultQueryKey&&streamedCount?.queryKey===resultQueryKey?streamedCount.total:undefined;
  const knownTotal=total??(typeof sharedTotal==='number'&&Number.isSafeInteger(sharedTotal)&&sharedTotal>=0?sharedTotal:null);
  const pageCount = knownTotal===null ? page+((batches.at(-1)!.hasMore??(batches.at(-1)!.count===24))?1:0) : Math.ceil(knownTotal / 24);
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4));
  const numberedPages = [...new Set(cursorPaging?[1,...batches.map(batch=>batch.page).filter(n=>Math.abs(n-page)<=2),...(nextCursor?[page+1]:[])]:[1, ...Array.from({length:5},(_,i)=>windowStart+i), pageCount])].filter(n => n >= 1 && n <= pageCount).sort((a,b)=>a-b);
  function pageHref(target: number) {
    const params = new URLSearchParams(fallbackQuery);
    params.set("page", String(target));
    if(cursorPaging){
      params.delete("after");
      const cursor=target===page+1?nextCursor:batches.find(batch=>batch.page===target)?.cursor;
      if(cursor)params.set("after",cursor);
    }
    return dealerBrowsingHref(`${basePath}?${params}`,dealer);
  }
  const incomplete=Boolean(batches.at(-1)!.incomplete);
  const more = batches.at(-1)!.hasMore ?? (knownTotal===null ? page<pageCount : page * 24 < knownTotal && batches[batches.length - 1].count > 0);
  function prepareNext() {
    if (prepared.current?.key === key && prepared.current.page === page + 1 && Date.now()-prepared.current.at<60_000) return prepared.current.promise;
    const promise = green ? loadMoreGreenCorner(greenQuery, page + 1) : loadMoreCatalog(query, page + 1, nextCursor);
    const entry = {key,page:page+1,at:Date.now(),promise};
    prepared.current = entry;
    void promise.catch(()=>{if(prepared.current===entry)prepared.current=null;});
    return promise;
  }
  useEffect(()=>{
    if(!more||query.market==='japan'||query.market==='china'||query.market==='korea')return;
    // Prepare one batch while the visitor reads the visible cars. Do not
    // recursively prefetch the catalogue, or append until explicitly asked.
    const connection=(navigator as Navigator & {connection?:{saveData?:boolean;effectiveType?:string}}).connection;
    if(connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType||""))return;
    const timer=window.setTimeout(()=>{void prepareNext().catch(()=>{});},350);
    return ()=>window.clearTimeout(timer);
  },[key,page,more]);
  async function load(retry=false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const last=batches.at(-1)!;
      const result = retry ? await loadMoreCatalog(query,last.page,last.cursor) : await prepareNext();
      if (!mounted.current || activeKey.current !== key) return;
      if(retry&&"incomplete" in result&&result.incomplete&&!result.ids.length)throw Error("incomplete_empty_retry");
      setBatches(current => [...(retry?current.slice(0,-1):current), {incomplete:"incomplete" in result&&Boolean(result.incomplete),cursor:retry?last.cursor:nextCursor??undefined, nextCursor:"nextCursor" in result && typeof result.nextCursor === "string" ? result.nextCursor : "nextCursor" in result && result.nextCursor === null ? null : undefined, page: result.page, cards: result.cards, count: result.ids.length, hasMore:"hasMore" in result && typeof result.hasMore === "boolean" ? result.hasMore : undefined}]);
      setTotal(result.total);
    } catch {
      if (mounted.current && activeKey.current===key) setError("Не удалось загрузить автомобили. Попробуйте ещё раз — список сохранён.");
    } finally {lock.current = false; if (mounted.current && activeKey.current===key) setBusy(false);}
  }
  return <div ref={list}>
    {batches.map(batch => <div key={batch.page} data-catalog-batch={batch.page} className="mb-2.5 grid min-w-0 grid-cols-2 gap-2.5 sm:mb-3 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{batch.cards}</div>)}
    <div className="mx-auto mt-7 flex w-full flex-col items-center gap-3">
      <p role="status" aria-live="polite" className="text-xs font-bold text-[var(--ac-muted)]">Показано {count.toLocaleString("ru-RU")} {knownTotal!==null?`из ${knownTotal.toLocaleString("ru-RU")}`:""}</p>
      {knownTotal===null&&resultCountLabel&&<p className="text-xs font-bold text-[var(--ac-muted)]">{resultCountLabel}</p>}
      {pageCount > 1 ? <CatalogPagination page={page} pageCount={pageCount} links={numberedPages.map(number=>({page:number,href:pageHref(number)}))} previousHref={page>1&&(!cursorPaging||page===2||batches.some(batch=>batch.page===page-1))?pageHref(page-1):undefined} nextHref={page<pageCount?pageHref(page+1):undefined}/> : null}
      {more ? <a href={pageHref(page+1)} data-no-route-loader="true" role="button" aria-disabled={busy} aria-busy={busy} aria-label={busy ? "Загружаем варианты" : "Показать ещё"} onClick={event => {if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void load();}} onKeyDown={event => {if (event.key === " ") {event.preventDefault(); void load();}}} className={`ac-catalog-more ${green ? "ac-green-button" : ""} min-h-12 w-full md:w-[calc((100%_-_24px)/3*2_+_12px)] xl:w-[calc((100%_-_12px)/2)] rounded-2xl bg-red-500 px-8 py-3 text-center text-sm font-black text-white transition hover:bg-red-600 ${busy ? "cursor-wait" : ""}`} style={{color:"#fff"}}>{busy ? <><span className="ac-catalog-more__candy" aria-hidden="true"/><span className="ac-catalog-more__label">Загружаем варианты</span></> : "Показать ещё"}</a> : incomplete ? <div className="max-w-md text-center text-sm text-[var(--ac-muted)]"><p role="status">Показаны сохранённые автомобили. Полный список пока недоступен.</p><button type="button" data-no-route-loader="true" disabled={busy} aria-busy={busy} onClick={()=>void load(true)} className="ac-catalog-more relative mt-3 rounded-2xl bg-red-500 px-8 py-3 font-black text-white">{busy?<><span className="ac-catalog-more__candy" aria-hidden="true"/><span className="ac-catalog-more__label">Обновляем список</span></>:"Повторить"}</button></div> : <p className="text-sm text-[var(--ac-muted)]">{"Вы посмотрели все доступные предложения"}</p>}
      {error ? <p role="alert" className="max-w-md text-center text-sm text-[var(--ac-text)]">{error}</p> : null}
    </div>
  </div>;
}
