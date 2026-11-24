import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSelectionProvider} from '../../apps/web/components/catalog/CatalogSelectionContext';
import {catalogRouteParams} from '../../apps/web/lib/catalog/catalog-routes';

const root = createRoot(document.getElementById('root')!);
const facets = {makes: ['Toyota', 'BMW'], models: [{make: 'Toyota', model: 'Corolla'}], bodyTypes: ['sedan', 'suv'],
  transmissions: ['automatic', 'manual'], fuels: ['petrol', 'electric'], drives: ['fwd', 'awd']};
function initialForHref(href: string): Record<string, string> {
  const url = new URL(href, location.href);
  // The real market/make/model pages merge authoritative path values after
  // the query. A canonical /cars/china URL no longer has ?market=china.
  return {...Object.fromEntries(url.searchParams), ...(catalogRouteParams(url.pathname) || {})};
}
const initialQuery = initialForHref(location.href);
const auctionResults = initialQuery.fixtureAuction === '1';
delete initialQuery.fixtureAuction;

function Fixture() {
  const [initial, setInitial] = useState(initialQuery);
  useEffect(() => {
    const fixture = {
      calls: [] as Array<{href: string; at: number; options: unknown}>,
      keydowns: [] as Array<{key: string; at: number}>,
      autoAcknowledge: true,
      acknowledge: (href: string) => setInitial(initialForHref(href)),
      navigate(href: string, options: unknown) {
        fixture.calls.push({href, options, at: performance.now()});
        history.pushState(null, '', href);
        if (fixture.autoAcknowledge) queueMicrotask(() => fixture.acknowledge(href));
      },
      unmount: () => root.unmount(),
    };
    (window as any).__filterFixture = fixture;
    const back = () => fixture.acknowledge(location.href);
    const keydown = (event: KeyboardEvent) => {
      if ((event.key === 'Tab' || event.key === 'Enter') && event.target instanceof HTMLInputElement && event.target.closest('.ac-range-card'))
        fixture.keydowns.push({key: event.key, at: performance.now()});
    };
    window.addEventListener('popstate', back);
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('popstate', back); window.removeEventListener('keydown', keydown, true); };
  }, []);
  return <CatalogSelectionProvider><CatalogFilters initial={initial} facets={facets} resultCount={24} auctionResults={auctionResults}/><div aria-hidden="true" style={{height: 1600}}/></CatalogSelectionProvider>;
}

root.render(<Fixture/>);
