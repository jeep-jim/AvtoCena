import {notFound} from 'next/navigation';
import {decodeCatalogPathParams} from '@/lib/catalog/catalog-routes';
import {catalogSearchMetadata} from '@/lib/catalog/search-metadata';
import CarsPage from "../../page";
async function catalogParams(props: any) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams]);
  const route = decodeCatalogPathParams(params);
  if (!route) notFound();
  return {...searchParams, ...route};
}
export async function generateMetadata(props: any) {
  return catalogSearchMetadata(await catalogParams(props));
}
export default async function Page(props: any) {
  return CarsPage({searchParams: catalogParams(props)});
}
