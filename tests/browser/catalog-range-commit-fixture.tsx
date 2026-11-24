import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {CatalogSelectionProvider} from '../../apps/web/components/catalog/CatalogSelectionContext';

const root = createRoot(document.getElementById('root')!);
const facets = {makes: ['Toyota', 'BMW'], models: [{make: 'Toyota', model: 'Corolla'}], bodyTypes: ['sedan', 'suv'],
  transmissions: ['automatic', 'manual'], fuels: ['petrol', 'electric'], drives: ['fwd', 'awd']};
const initialQuery = Object.fromEntries(new URLSearchParams(location.search));
const auctionResults = initialQuery.fixtureAuction === '1';
delete initialQuery.fixtureAuction;

function Fixture() {
  const [initial, setInitial] = useState(initialQuery);
  useEffect(() => {
    const fixture = {
      calls: [] as Array<{href: string; at: number; options: unknown}>,
      keydowns: [] as Array<{key: string; at: number}>,
      autoAcknowledge: true,
      acknowledge: (href: string) => setInitial(Object.fromEntries(new URL(href, location.href).searchParams)),
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
  return <CatalogSelectionProvider><CatalogFilters initial={initial} facets={facets} resultCount={24} auctionResults={auctionResults}/></CatalogSelectionProvider>;
}

root.render(<Fixture/>);
