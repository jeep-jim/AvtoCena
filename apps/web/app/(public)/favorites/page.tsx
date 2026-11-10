import FavoritesContent from '@/components/catalog/FavoritesContent';
import {DealerBrowsingProvider} from '@/components/dealers/DealerBrowsingContext';
import {resolveDealerBrowsingContext} from '@/lib/dealers/resolve-browsing-context';

export default async function FavoritesPage({searchParams}: {
  searchParams: Promise<{dealer?: string; preview?: string}>;
}) {
  const query = await searchParams;
  const dealer = await resolveDealerBrowsingContext(query.dealer || '', query.preview === '1');
  return <DealerBrowsingProvider dealer={dealer}><FavoritesContent/></DealerBrowsingProvider>;
}
