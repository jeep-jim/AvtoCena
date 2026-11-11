import {CatalogMarketFlag} from '@/components/catalog/CatalogMarketFlag';
import {DEALER_MARKETS,type DealerMarket} from '@/lib/dealers/catalog-markets';
import styles from './DealerMarketChips.module.css';

/** Shared delivery directions for the profile and both live previews. */
export function DealerMarketChips({markets}:{markets:DealerMarket[]}) {
 return <div className={styles.chips} data-dealer-market-chips>
  {DEALER_MARKETS.filter(m=>markets.includes(m.id)).map(m=><span key={m.id} className={styles.chip}><CatalogMarketFlag market={m.id}/>{m.label}</span>)}
 </div>;
}
