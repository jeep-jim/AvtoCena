"use client";

import {useEffect, useMemo, useRef, useState} from 'react';
import {useDealerBrowsing} from '@/components/dealers/DealerBrowsingContext';
import type {RelatedOffersPayload} from '@/lib/catalog/related-offer-types';

// The recommendations bundle and its data are requested only near the section.
// Opening an offer (including its server render or prefetch) does no related search.
type LoadedRelatedOffers = {
  Content: typeof import('./RelatedOffersContent')['default'];
  data: RelatedOffersPayload;
};

export function RelatedOffersPlaceholder() {
  return <div aria-label="Загружаем похожие предложения" role="status">
    <div className="h-9 w-52 animate-pulse rounded-xl bg-white/[0.08]" />
    <div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {Array.from({length:4}, (_, index) => <div key={index} className="min-h-64 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />)}
    </div>
  </div>;
}

export function LazyRelatedOffers({id, catalogHref}:{id:string;catalogHref:string}) {
  const dealer = useDealerBrowsing();
  const section = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedRelatedOffers|null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const endpoint = useMemo(() => {
    const query = new URLSearchParams({id});
    if (dealer?.id) query.set('dealer', dealer.id);
    if (dealer?.preview) query.set('preview', '1');
    return '/api/catalog/related?' + query;
  }, [id, dealer?.id, dealer?.preview]);

  useEffect(() => {
    const element = section.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setVisible(true);
      }
    }, {rootMargin:'240px 0px'});
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {setLoaded(null);setFailed(false);}, [endpoint]);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let active = true;
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        reject(new Error('related_offers_unavailable'));
      }, 35_000);
    });
    setLoading(true);
    setFailed(false);
    const load = async ():Promise<LoadedRelatedOffers> => {
      const response = await fetch(endpoint, {signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw new Error('related_offers_unavailable');
      const data = await response.json() as RelatedOffersPayload;
      if (!active || controller.signal.aborted) throw new Error('related_offers_unavailable');
      // Keep chunk failures in this local catch. Calling import for each manual
      // attempt lets the bundler retry a failed fetch without caching rejection
      // in React.lazy or replacing the offer page and its form.
      const {default:Content} = await import('./RelatedOffersContent');
      return {Content,data};
    };
    // The same deadline covers both data and the deferred bundle. Late module
    // resolution after a timeout must not overwrite the local retry state.
    void Promise.race([load(),timeout])
      .then(value => {if (active) setLoaded(value);})
      .catch(() => {if (active) setFailed(true);})
      .finally(() => {clearTimeout(deadline);if (active) setLoading(false);});
    return () => {active=false;clearTimeout(deadline);controller.abort();};
  }, [endpoint, visible, attempt]);

  const data = loaded?.data;
  const retry = () => {setVisible(true);setAttempt(value => value + 1);};
  return <div ref={section} className="mt-10 md:mt-14" data-related-offers-deferred aria-busy={loading || undefined}>
    {loaded ? <loaded.Content data={loaded.data} />
      : failed ? <p className="text-[var(--ac-muted)]">Не удалось загрузить похожие автомобили. Попробуйте ещё раз.</p>
      : <RelatedOffersPlaceholder />}
    {(failed || data?.partial || !visible) && <div className="mt-4 flex flex-wrap items-center gap-4">
      {data?.partial && <p className="text-sm text-[var(--ac-muted)]">Часть предложений сейчас недоступна.</p>}
      <button type="button" onClick={retry} disabled={loading} className="ac-market-all-link text-sm font-bold">
        {loading ? 'Загружаем…' : visible ? 'Повторить загрузку' : 'Показать похожие автомобили'}
      </button>
    </div>}
    <noscript><a href={catalogHref}>Посмотреть другие автомобили</a></noscript>
  </div>;
}
