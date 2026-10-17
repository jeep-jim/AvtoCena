import {catalogSearchMetadata} from '@/lib/catalog/search-metadata';
import {CatalogContent} from '@/components/catalog/CatalogContent';
import {DealerBrowsingProvider} from '@/components/dealers/DealerBrowsingContext';
import {resolveDealerBrowsingContext} from '@/lib/dealers/resolve-browsing-context';
export async function generateMetadata({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}){return catalogSearchMetadata(await searchParams||{});}
export const dynamic='force-dynamic';
export const revalidate=0;
function first(value?:string|string[]){return Array.isArray(value)?value[0]:value||'';}
export default async function CarsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
 const params=(await searchParams)||{};
 const dealer=await resolveDealerBrowsingContext(first(params.dealer),first(params.preview)==='1');
 return <DealerBrowsingProvider dealer={dealer}><CatalogContent params={params} dealer={dealer}/></DealerBrowsingProvider>;
}
