"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { loadMoreCatalog } from "./catalog-load-more-action";
import type { CatalogSearchParams } from "@/lib/catalog/types";

type Batch = {page: number; cards: ReactNode; count: number};
type Saved = {batches: Batch[]; total: number; scrollY: number; savedAt: number};
// React nodes remain in this tab, never serialized into cookies or sent back to
// the server. Returning from a detail page restores already fetched batches.
const visits = new Map<string, Saved>();
const TTL = 30 * 60_000;

export function CatalogLoadMore({query, initialPage, initialTotal, initialCount, initialCards}: {
  query: CatalogSearchParams; initialPage: number; initialTotal: number; initialCount: number; initialCards: ReactNode;
}) {
  const key = JSON.stringify([Object.entries(query).sort(([a],[b])=>a.localeCompare(b)), initialPage]);
  const [batches, setBatches] = useState<Batch[]>([{page: initialPage, cards: initialCards, count: initialCount}]);
  const [total, setTotal] = useState(initialTotal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const count = batches.reduce((sum, batch) => sum + batch.count, 0);
  const page = batches[batches.length - 1].page;
  fallbackQuery.set("page", String(page + 1));
  const pageCount = Math.ceil(total / 24);
  const windowStart = Math.max(1, Math.min(page - 3, pageCount - 7));
  const numberedPages = [...new Set([1, ...Array.from({length:8},(_,i)=>windowStart+i), pageCount])].filter(n => n >= 1 && n <= pageCount).sort((a,b)=>a-b);
  function pageHref(target: number) {
    const params = new URLSearchParams(fallbackQuery);
    params.set("page", String(target));
    return `/cars?${params}`;
  }
  const more = page * 24 < total && batches[batches.length - 1].count > 0;
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await loadMoreCatalog(query, page + 1);
      if (!mounted.current) return;
      setBatches(current => [...current, {page: result.page, cards: result.cards, count: result.ids.length}]);
      setTotal(result.total);
    } catch {
      if (mounted.current) setError("Не удалось загрузить автомобили. Попробуйте ещё раз — список сохранён.");
    } finally {lock.current = false; if (mounted.current) setBusy(false);}
  }
  return <div ref={list}>
    {batches.map(batch => <div key={batch.page} data-catalog-batch={batch.page} className="mb-2.5 grid min-w-0 grid-cols-2 gap-2.5 sm:mb-3 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">{batch.cards}</div>)}
    <div className="mx-auto mt-7 flex w-full flex-col items-center gap-3 md:w-[calc((100%_-_24px)/3*2_+_12px)] xl:w-[calc((100%_-_12px)/2)]">
      <p role="status" aria-live="polite" className="text-xs font-bold text-[var(--ac-muted)]">Показано {count.toLocaleString("ru-RU")} из {total.toLocaleString("ru-RU")}</p>
      {pageCount > 1 ? <nav aria-label="Страницы каталога" className="ac-pagination">
        {page > 1 ? <a href={pageHref(page-1)} aria-label="Предыдущая страница"><ChevronLeft size={20}/></a> : <span aria-disabled="true"><ChevronLeft size={20}/></span>}
        {numberedPages.map((number,index)=><Fragment key={number}>
          {index > 0 && number-numberedPages[index-1]>1 ? <span aria-hidden="true">…</span> : null}
          <a href={pageHref(number)} aria-label={`Страница ${number}`} aria-current={number===page?"page":undefined} className={number!==1 && number!==pageCount && Math.abs(number-page)>1 ? "ac-page-extra" : undefined}>{number}</a>
        </Fragment>)}
        {page < pageCount ? <a href={pageHref(page+1)} aria-label="Следующая страница"><ChevronRight size={20}/></a> : <span aria-disabled="true"><ChevronRight size={20}/></span>}
      </nav> : null}
      {more ? <a href={`/cars?${fallbackQuery}`} data-no-route-loader="true" role="button" aria-disabled={busy} onClick={event => {if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); void load();}} onKeyDown={event => {if (event.key === " ") {event.preventDefault(); void load();}}} className={`min-h-12 w-full rounded-2xl bg-red-500 px-8 py-3 text-center text-sm font-black text-white transition hover:bg-red-600 ${busy ? "cursor-wait opacity-70" : ""}`} style={{color:"#fff"}}>{busy ? "Загружаем автомобили…" : "Показать ещё"}</a> : <p className="text-sm text-[var(--ac-muted)]">Вы посмотрели все предложения</p>}
      {error ? <p role="alert" className="max-w-md text-center text-sm text-[var(--ac-text)]">{error}</p> : null}
    </div>
  </div>;
}
